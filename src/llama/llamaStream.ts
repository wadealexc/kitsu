import { type Response } from 'node-fetch';
import { PassThrough } from 'stream';

import * as proto from '../protocol.js';
import { Router } from 'express';

type LlamaStreamEvents = {
    response: (response: Response) => void,
    data: () => void,
    readable: () => void,
    stop: (result: proto.Result<proto.CompletionResponse, Error>) => void,
};

export default class LlamaStream extends PassThrough {

    private chunks: Buffer<any>[] = [];

    constructor(stream: NodeJS.ReadableStream, contentType: string, signal: AbortSignal) {
        super({ signal: signal });

        super.on('data', chunk => this.chunks.push(Buffer.from(chunk)));

        super.once('error', (err: any) => {
            this.emit('stop', {
                ok: false,
                value: err
            });
        });

        super.once('end', () => {
            const responseString = Buffer.concat(this.chunks).toString('utf8');

            // Handle streamed vs static response
            const result: proto.Result<proto.CompletionResponse, Error> = contentType.includes('text/event-stream')
                ? handleStreamedResponse(responseString)
                : handleStaticResponse(responseString);

            // TODO - For streamed responses, SSE spec should make it possible to send an error `{ "type": "error", ... }`
            if (!result.ok) {
                console.error(`error parsing llama-server response: ${result.value} | responseString: ${responseString}`);
            }

            this.emit('stop', result);
        });

        stream.pipe(this);
    }

    /* -------------------- EVENTS -------------------- */

    emit<E extends keyof LlamaStreamEvents>(event: E, ...args: Parameters<LlamaStreamEvents[E]>): boolean;
    emit(event: string | symbol, ...args: any[]): boolean {
        return super.emit(event as string | symbol, ...args);
    }

    once<E extends keyof LlamaStreamEvents>(event: E, listener: LlamaStreamEvents[E]): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this {
        super.once(event as string | symbol, listener as (...args: any[]) => void);
        return this;
    }
}

function handleStaticResponse(responseString: string): proto.Result<proto.CompletionResponse, Error> {
    try {
        return {
            ok: true,
            value: JSON.parse(responseString),
        }
    } catch (err: any) {
        return {
            ok: false,
            value: new Error(`handleStaticResponse: error decoding response: ${err}`)
        }
    }
}

// When streamed, the response is formatted as SSE (server-sent events).
// https://platform.openai.com/docs/api-reference/chat-streaming
function handleStreamedResponse(responseString: string): proto.Result<proto.CompletionResponse, Error> {
    // This should give us an array of JSON strings representing various streamed tokens
    let responseDeltas = responseString.split('data: ').reduce<proto.CompletionResponse[]>((accum, event) => {
        try { accum.push(JSON.parse(event.trim())) } catch { }

        return accum;
    }, []);

    let finalResponse: proto.CompletionResponse | undefined;
    let finalDelta: proto.ChatDelta = {
        role: "",
        content: "",
        reasoning_content: "",
    };

    // Combine streamed CompletionResponse deltas into a single CompletionResponse
    responseDeltas.forEach(responseDelta => {
        if (!responseDelta.choices) {
            console.error(`handleStreamedResponse: invalid response: ${JSON.stringify(responseDelta)}`);
            return;
        }

        const choice = responseDelta.choices.at(0);

        if (!choice || !choice.delta) {
            return;
        }

        if (choice.delta.role) {
            finalDelta.role = choice.delta.role;
        }

        if (choice.delta.content) {
            finalDelta.content += choice.delta.content;
        }

        if (choice.delta.reasoning_content) {
            finalDelta.reasoning_content += choice.delta.reasoning_content;
        }

        if (choice.delta.refusal) {
            finalDelta.refusal = choice.delta.refusal;
        }

        choice.delta.tool_calls?.forEach(call => {
            if (!finalDelta.tool_calls) finalDelta.tool_calls = [];

            const existingCall = finalDelta.tool_calls.find(
                existingCall => existingCall.index === call.index
            );

            if (!existingCall) {
                finalDelta.tool_calls.push(call);
            } else {
                existingCall.function.arguments += call.function.arguments;
            }
        });

        finalResponse = {
            ...responseDelta,
            choices: [{
                ...choice,
                delta: finalDelta
            }]
        };
    });

    if (!finalResponse) {
        return {
            ok: false,
            value: new Error(`handleStreamedResponse: empty final response`),
        }
    }

    return {
        ok: true,
        value: finalResponse,
    }
}