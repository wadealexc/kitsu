import { Headers } from 'node-fetch';

import * as proto from '../protocol/index.js';
import LlamaStream from './llamaStream.js';

/* -------------------- REQUEST / RESPONSE -------------------- */

export type LlamaRequest = {
    body: proto.CompletionRequest,
    signal: AbortSignal,
    emit?: {
        onQueue: () => void,
        onLoading: () => void,
    },
};

export type LlamaResponse = {
    status: number,
    headers: Headers,
    stream: LlamaStream,
};

/* -------------------- LLAMA INTERFACE -------------------- */

export type LlamaStatus = 'idle' | 'queued' | 'active';

/**
 * Inference backend. Implemented by `LlamaManagerAdapter`, which talks to
 * llama-manager over HTTP; tests use a mock.
 */
export interface Llama {
    completions(req: LlamaRequest): Promise<LlamaResponse>;
    tokenize(content: string, model: string, signal: AbortSignal): Promise<number>;
    wake(modelName: string): Promise<LlamaStatus>;
    getStatus(model: string): Promise<LlamaStatus>;
    getModelInfo(name: string): Promise<proto.ModelInfo | undefined>;
    getAllModelNames(): Promise<string[]>;
}
