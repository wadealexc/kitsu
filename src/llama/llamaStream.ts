import { type Response } from 'node-fetch';
import { PassThrough, Transform, type TransformCallback } from 'stream';

import * as proto from '../protocol.js';

type LlamaStreamEvents = {
    response: (response: Response) => void,
    data: () => void,
    readable: () => void,
    stop: (result: proto.Result<proto.CompletionResponse, Error>) => void,
};

export default class LlamaStream extends PassThrough {

    private chunks: Buffer<any>[] = [];

    // Eagerly captures the stop event so callers can await finished() to
    // get the result of the stream.
    private result: Promise<proto.Result<proto.CompletionResponse, Error>>;

    constructor(stream: NodeJS.ReadableStream, expectSSE: boolean, signal: AbortSignal) {
        super({ signal: signal });

        this.result = new Promise(resolve => this.once('stop', resolve));

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
            const result: proto.Result<proto.CompletionResponse, Error> = expectSSE
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

    /* -------------------- HELPERS -------------------- */

    /**
     * Creates a Transform that filters out `data: [DONE]` SSE frames, pipes
     * this stream into it, and returns it ready to pipe to the client.
     *
     * Used by the tool loop to strip [DONE] between rounds so it can send
     * a single [DONE] after all rounds complete.
     */
    withDoneFilter(): Transform {
        let buffer = '';

        const filter = new Transform({
            transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
                buffer += chunk.toString('utf8');

                // Split on double-newline SSE boundaries. The last element may be
                // an incomplete frame, so we keep it buffered.
                const parts = buffer.split('\n\n');
                buffer = parts.pop() ?? '';

                // Forward complete frames downstream, unless the frame is [DONE],
                // which gets dropped.
                for (const part of parts) {
                    if (part.trim() === '' || part.trim() === 'data: [DONE]') continue;
                    this.push(part + '\n\n');
                }

                callback();
            },

            // Called when the source closes. Anything left in the buffer gets forwarded
            // (unless it's [DONE]).
            flush(callback: TransformCallback) {
                if (buffer.trim() !== '' && buffer.trim() !== 'data: [DONE]') {
                    this.push(buffer);
                }

                buffer = '';
                callback();
            },
        });

        this.pipe(filter);
        return filter;
    }

    /**
     * Promisifies the `stop` event. Resolves once the stream finishes.
     */
    finished(): Promise<proto.Result<proto.CompletionResponse, Error>> {
        return this.result;
    }
}

function handleStaticResponse(responseString: string): proto.Result<proto.CompletionResponse, Error> {
    try {
        return {
            ok: true,
            value: JSON.parse(responseString),
        }
    } catch (err: any) {
        console.log(`handleStaticResponse: error decoding response: ${err}`);
        return {
            ok: false,
            value: new Error(`handleStaticResponse: error decoding response: ${err}`)
        }
    }
}

// When streamed, the response is formatted as SSE (server-sent events).
// https://platform.openai.com/docs/api-reference/chat-streaming
function handleStreamedResponse(responseString: string): proto.Result<proto.CompletionResponse, Error> {
    // Parse each SSE frame as a CompletionChunk (streaming shape, with `delta`)
    const chunks = responseString.split('data: ').reduce<proto.CompletionChunk[]>((accum, event) => {
        try { accum.push(JSON.parse(event.trim())) } catch { }
        return accum;
    }, []);

    let finalChunk: proto.CompletionChunk | undefined;
    let finalMessage: proto.ChatMessage = {
        role: '',
        content: '',
        reasoning_content: '',
    };

    // Accumulate all chunk deltas into a single ChatMessage
    for (const chunk of chunks) {
        if (!chunk.choices) {
            console.error(`handleStreamedResponse: invalid chunk: ${JSON.stringify(chunk)}`);
            continue;
        }

        const choice = chunk.choices.at(0);
        if (!choice || !choice.delta) continue;

        if (choice.delta.role) {
            finalMessage.role = choice.delta.role;
        }

        if (choice.delta.content) {
            finalMessage.content = (finalMessage.content ?? '') + choice.delta.content;
        }

        if (choice.delta.reasoning_content) {
            finalMessage.reasoning_content = (finalMessage.reasoning_content ?? '') + choice.delta.reasoning_content;
        }

        if (choice.delta.refusal) {
            finalMessage.refusal = choice.delta.refusal;
        }

        choice.delta.tool_calls?.forEach(call => {
            if (!finalMessage.tool_calls) finalMessage.tool_calls = [];

            const existingCall = finalMessage.tool_calls.find(
                existing => existing.index === call.index
            );

            if (!existingCall) {
                finalMessage.tool_calls.push(call);
            } else {
                existingCall.function.arguments += call.function.arguments;
            }
        });

        finalChunk = chunk;
    }

    if (!finalChunk) {
        return {
            ok: false,
            value: new Error(`handleStreamedResponse: empty final response`),
        };
    }

    const finalChoice = finalChunk.choices.at(0);
    const response: proto.CompletionResponse = {
        ...finalChunk,
        choices: [{
            finish_reason: finalChoice?.finish_reason,
            index: finalChoice?.index ?? 0,
            message: finalMessage,
        }],
    };

    return {
        ok: true,
        value: response,
    };
}