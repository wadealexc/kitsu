import fetch from 'node-fetch';

import type { ModelConfig } from '../config.js';
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

export class LlamaManagerAdapter implements Llama {

    private managerUrl: string;
    private modelInfos: Map<string, proto.ModelInfo>;

    constructor(params: {
        managerUrl: string;
        models: ModelConfig;
    }) {
        this.managerUrl = params.managerUrl.replace(/\/+$/, '');

        this.modelInfos = new Map(params.models.models.map(model => {
            const name = model.alias ?? model.gguf;
            const args = model.args ?? [];
            const ctxIdx = args.indexOf('--ctx-size');
            const contextLength = ctxIdx !== -1 ? Number(args[ctxIdx + 1]) || undefined : undefined;

            const info: proto.ModelInfo = {
                name,
                path: '',
                mmprojPath: undefined,
                args,
                params: model.params ?? {},
                contextLength,
            };
            return [name, info];
        }));

        console.log(`LlamaManagerAdapter: targeting ${this.managerUrl} with models: ${[...this.modelInfos.keys()].join(', ')}`);
    }

    async completions(req: LlamaRequest): Promise<LlamaResponse> {
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
        if (!this.modelInfos.has(model))
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
            const url = `${this.managerUrl}/v1/models`;
            const response = await fetch(url);
            if (!response.ok) return 'idle';

            const data = (await response.json() as { object: 'list', data: ModelListEntry[] }).data;
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
        const base = this.modelInfos.get(model);
        if (!base) return undefined;

        try {
            const url = `${this.managerUrl}/v1/models`;
            const response = await fetch(url);
            if (!response.ok) return base;

            const data = (await response.json() as { object: 'list', data: ModelListEntry[] }).data;
            const info = data.find(e => e.id === model);
            if (!info) return base;

            return {
                ...base,
                contextLength: info.n_ctx,
            };
        } catch {
            return base;
        }
    }

    getAllModelNames(): string[] {
        return [...this.modelInfos.keys()];
    }

    async stopServer(): Promise<void> {
        console.log('LlamaManagerAdapter.stopServer: nothing to stop');
    }

    forceStopServer(): void {
        console.log('LlamaManagerAdapter.forceStopServer: nothing to stop');
    }
}