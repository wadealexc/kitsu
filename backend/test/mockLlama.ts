import { Readable } from 'stream';
import { Headers } from 'node-fetch';

import type { LlamaRequest, LlamaResponse } from '../src/llama/llamaManager.js';
import LlamaStream from '../src/llama/llamaStream.js';

import * as proto from '../src/protocol/index.js';

export class MockLlama {

    models: string[] = ['test model'];

    /** All calls to completions(), in order. Reset with resetQueue(). */
    requests: LlamaRequest[] = [];

    private queue: Array<(req: LlamaRequest) => LlamaResponse> = [];

    constructor(models?: string[]) {
        if (models) this.models = models;
    }

    /** Queue a response factory. Consumed in order by completions(). */
    enqueue(factory: (req: LlamaRequest) => LlamaResponse): void {
        this.queue.push(factory);
    }

    /** Clear the queue and recorded requests. Call in afterEach. */
    resetQueue(): void {
        this.queue = [];
        this.requests = [];
    }

    /**
     * Builds a streaming LlamaResponse from an array of chunk objects.
     * Appends data: [DONE] automatically. Pass req.signal from the factory.
     */
    static createSSEResponse(chunks: object[], signal: AbortSignal): LlamaResponse {
        const frames = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`);
        frames.push('data: [DONE]\n\n');
        return {
            status: 200,
            headers: new Headers({ 'content-type': 'text/event-stream' }),
            stream: new LlamaStream(Readable.from(frames), true, signal),
        };
    }

    completions(req: LlamaRequest): Promise<LlamaResponse> {
        this.requests.push(req);

        if (this.queue.length > 0) {
            return Promise.resolve(this.queue.shift()!(req));
        }

        const lastMessage = req.body.messages.at(-1);
        const lastMessageInfo: string = lastMessage
            ? `${lastMessage.role} says: ${lastMessage.content}`
            : 'no last message';

        const responseMessageInfo = `Hello, World! (stream: ${req.body.stream} | model: ${req.body.model} | # tools: ${req.body.tools?.length})`;
        const responseMessageEcho = `Last Message: ${lastMessageInfo.replace(/\n/g, '\\n')}`;

        const completionInfoObj = {
            id: 'test1234',
            object: "chat.completion.chunk",
            created: 1694268190,
            model: this.models[0]!,
            choices: [{
                index: 0,
                finish_reason: null,
                delta: {
                    role: 'assistant',
                    content: responseMessageInfo,
                }
            }]
        };

        const completionEchoObj = {
            id: 'test1234',
            object: "chat.completion.chunk",
            created: 1694268190,
            model: this.models[0]!,
            choices: [{
                index: 0,
                finish_reason: null,
                delta: {
                    role: 'assistant',
                    content: responseMessageEcho,
                }
            }]
        };

        const completionStopObj = {
            id: 'test1234',
            object: "chat.completion.chunk",
            created: 1694268190,
            model: this.models[0]!,
            choices: [{
                index: 0,
                finish_reason: "stop",
            }]
        };


        const sseInfoObj = `data: ${JSON.stringify(completionInfoObj)}\n\n`;
        const sseEchoObj = `data: ${JSON.stringify(completionEchoObj)}\n\n`;
        const sseStopObj = `data: ${JSON.stringify(completionStopObj)}\n\n`;

        const init: HeadersInit = {
            "access-control-allow-origin": "",
            "content-type": "text/event-stream",
            "keep-alive": "timeout=5, max=100",
            "server": "llama.cpp",
            "transfer-encoding": "chunked"
        };

        let response: LlamaResponse = {
            status: 200,
            headers: new Headers(init),
            stream: new LlamaStream(
                Readable.from([sseInfoObj, sseEchoObj, sseStopObj]),
                true,
                req.signal,
            )
        }

        return Promise.resolve(response);
    }

    wake(_model: string): void {}

    getStatus(_model: string): 'idle' | 'queued' | 'active' { return 'active'; }

    hasTaskModel(): boolean {
        return false;
    }

    getTaskModel(): string | undefined {
        return undefined;
    }

    getModelInfo(name: string): proto.ModelInfo | undefined {
        if (this.models.includes(name)) {
            return {
                name: name,
                path: 'path.gguf',
                mmprojPath: 'mmproj.gguf',
                args: [],
                params: {},
            }
        }
    }

    getAllModelNames(): string[] {
        return this.models;
    }
}