import fetch from 'node-fetch';

import * as proto from '../protocol/index.js';
import LlamaStream from './llamaStream.js';
import type { Llama, LlamaRequest, LlamaResponse, LlamaStatus } from './types.js';

enum LoadStatus {
    UNLOADED,
    WEIGHTS_ONLY,
    LOADED,
}

type ModelListEntry = {
    id: string;
    object: 'model';
    created: number;
    owned_by: string;
    status: LoadStatus;
    queued: boolean;
    active: boolean;
    n_ctx: number;
}

/** How long a model list from llama-manager is reused before asking again. */
const MODEL_LIST_TTL_MS = 5_000;

/**
 * Talks to llama-manager, which serves the models: the model list comes from it,
 * not from kitsu's config.
 */
export class LlamaManagerAdapter implements Llama {

    private managerUrl: string;
    /** Last list llama-manager gave, kept for when it can't be reached. */
    private lastModels: ModelListEntry[] = [];
    private lastFetchedAt = 0;

    constructor(params: { managerUrl: string }) {
        this.managerUrl = params.managerUrl.replace(/\/+$/, '');
        console.log(`LlamaManagerAdapter: targeting ${this.managerUrl}`);
    }

    async completions(req: LlamaRequest): Promise<LlamaResponse> {
        if (req.emit) {
            const data = await this.#listModels();
            const target = data.find(e => e.id === req.body.model);

            if (target?.active) {
                // no emit
            } else if (data.some(e => e.id !== req.body.model && e.active)) {
                req.emit.onQueue();
            } else {
                req.emit.onLoading();
            }
        }

        const url = `${this.managerUrl}/v1/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ timings_per_token: true, return_progress: true, ...req.body }),
            signal: req.signal,
        });

        const contentType: string | null = response.headers.get('content-type');

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`LlamaManagerAdapter: upstream returned error: ${errText}`);
        } else if (response.body === null) {
            throw new Error(`LlamaManagerAdapter: upstream returned null response.body`);
        } else if (contentType === null) {
            throw new Error(`LlamaManagerAdapter: upstream did not return content-type header`);
        }

        const expectSSE = contentType.includes('text/event-stream');
        const stream = new LlamaStream(response.body, expectSSE, req.signal);

        return {
            status: response.status,
            headers: response.headers,
            stream: stream,
        };
    }

    async tokenize(content: string, model: string, signal: AbortSignal): Promise<number> {
        const url = `${this.managerUrl}/v1/chat/completions/input_tokens`;

        const body = {
            model,
            messages: [{ role: 'user', content }],
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`LlamaManagerAdapter.tokenize: upstream returned error: ${errText}`);
        }

        const data: unknown = await response.json();
        return (data as { input_tokens: number, object: string }).input_tokens;
    }

    async wake(model: string): Promise<LlamaStatus> {
        if (!(await this.getAllModelNames()).includes(model))
            throw new Error(`LlamaManagerAdapter.wake: model not found: ${model}`);

        const status = await this.getStatus(model);
        if (status === 'queued') return status;
        if (status === 'active') return status;

        const url = `${this.managerUrl}/v1/models/load`;
        fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: model }),
        }).catch(err => console.error(`LlamaManagerAdapter.wake: ${err}`));

        return 'queued';
    }

    async getStatus(model: string): Promise<LlamaStatus> {
        try {
            const data = await this.#listModels();
            const info = data.find(e => e.id === model);
            if (!info) return 'idle';

            if (info.active) return 'active';
            if (info.queued) return 'queued';
            return 'idle';
        } catch {
            return 'idle';
        }
    }

    async getModelInfo(model: string): Promise<proto.ModelInfo | undefined> {
        const info = (await this.#models()).find(e => e.id === model);
        if (!info) return undefined;
        return { name: info.id, params: {}, contextLength: info.n_ctx };
    }

    async #listModels(): Promise<ModelListEntry[]> {
        const url = `${this.managerUrl}/v1/models`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`llama-manager /v1/models returned ${response.status}`);

        const models = (await response.json() as { object: 'list', data: ModelListEntry[] }).data;
        this.lastModels = models;
        this.lastFetchedAt = Date.now();
        return models;
    }

    /** The model list, reused for a few seconds, or the last known one if llama-manager is unreachable. */
    async #models(): Promise<ModelListEntry[]> {
        if (Date.now() - this.lastFetchedAt < MODEL_LIST_TTL_MS) return this.lastModels;
        try {
            return await this.#listModels();
        } catch (err) {
            console.error(`LlamaManagerAdapter: couldn't list models: ${err}`);
            return this.lastModels;
        }
    }

    async getAllModelNames(): Promise<string[]> {
        return (await this.#models()).map(m => m.id);
    }
}