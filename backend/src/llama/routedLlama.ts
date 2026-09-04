import path from 'path';

import fetch from 'node-fetch';
import chalk from 'chalk';

import type { ModelConfig } from '../config.js';
import * as proto from '../protocol/index.js';
import LlamaStream from './llamaStream.js';
import type { Llama, LlamaRequest, LlamaResponse, LlamaStatus } from './types.js';

/* -------------------- ROUTED LLAMA -------------------- */

/**
 * Forwards completions and tokenize requests to a remote kitsu backend rather
 * than running llama.cpp locally. Used by the beta environment so it can share
 * the prod GPU instead of competing for it.
 *
 * The remote backend's `/api/v1/chat/completions` queues through its own
 * `LlamaManager`, so request ordering and model swaps play nicely with prod.
 */
export class RoutedLlama implements Llama {

    private prodBackendURL: string;
    private models: string[];
    private modelInfos: Map<string, proto.ModelInfo>;

    constructor(params: {
        models: ModelConfig,
        prodBackendURL: string,
    }) {
        this.prodBackendURL = params.prodBackendURL.replace(/\/+$/, '');

        this.models = params.models.models.map(m => m.alias ?? m.gguf);

        this.modelInfos = new Map(params.models.models.map(model => {
            const name = model.alias ?? model.gguf;
            const info = buildModelInfo(model, params.models.path);
            return [name, info];
        }));

        console.log(`RoutedLlama: targeting ${chalk.cyan(this.prodBackendURL)} with models: ${this.models.join(', ')}`);
    }

    /* -------------------- PUBLIC METHODS -------------------- */

    async completions(req: LlamaRequest): Promise<LlamaResponse> {
        const url = `${this.prodBackendURL}/api/v1/chat/completions`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(req.body),
            signal: req.signal,
        });

        const contentType: string | null = response.headers.get('content-type');

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`RoutedLlama: prod backend returned error: ${errText}`);
        } else if (response.body === null) {
            throw new Error(`RoutedLlama: prod backend returned null response.body`);
        } else if (contentType === null) {
            throw new Error(`RoutedLlama: prod backend did not return content-type header`);
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
        const url = `${this.prodBackendURL}/api/v1/chat/tokenize`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content, model }),
            signal,
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`RoutedLlama.tokenize: prod backend returned error: ${errText}`);
        }

        const data: unknown = await response.json();
        if (typeof data !== 'object' || data === null || typeof (data as Record<string, unknown>).count !== 'number') {
            throw new Error(`RoutedLlama.tokenize: unexpected response shape`);
        }

        return (data as { count: number }).count;
    }

    /* -------------------- WAKE / STATUS -------------------- */

    // Beta has no local processes to wake, and prod manages its own queue/swaps
    // when a completion arrives. Reporting 'active' for any known model keeps
    // the frontend's loading affordances quiet without misleading it about
    // models that don't exist.

    async wake(modelName: string): Promise<LlamaStatus> {
        if (!this.modelInfos.has(modelName))
            throw new Error(`RoutedLlama.wake: model not found: ${modelName}`);
        return 'active';
    }

    async getStatus(model: string): Promise<LlamaStatus> {
        return this.modelInfos.has(model) ? 'active' : 'idle';
    }

    /* -------------------- GETTERS -------------------- */

    async getModelInfo(name: string): Promise<proto.ModelInfo | undefined> {
        return this.modelInfos.get(name);
    }

    getAllModelNames(): string[] {
        return [...this.models];
    }

    /* -------------------- LIFECYCLE (NO-OPS) -------------------- */

    async stopServer(): Promise<void> {
        console.log('RoutedLlama.stopServer: nothing to stop');
    }

    forceStopServer(): void {
        console.log('RoutedLlama.forceStopServer: nothing to stop');
    }
}

/* -------------------- HELPERS -------------------- */

function buildModelInfo(
    model: { 
        gguf: string, 
        mmproj?: string, 
        alias?: string,
        args?: string[], 
        params?: Record<string, unknown> 
    }, 
    basePath: string
): proto.ModelInfo {
    const name = model.alias ?? model.gguf;

    const modelPath = withGgufExt(path.join(basePath, model.gguf));
    const mmprojPath = model.mmproj
        ? withGgufExt(path.join(basePath, model.mmproj))
        : undefined;

    // Parse --ctx-size from args, if present
    const args = model.args ?? [];
    const ctxIdx = args.indexOf('--ctx-size');
    const contextLength = ctxIdx !== -1 ? Number(args[ctxIdx + 1]) || undefined : undefined;

    return {
        name,
        path: modelPath,
        mmprojPath,
        args,
        params: model.params ?? {},
        contextLength,
    };
}

function withGgufExt(p: string): string {
    return p.endsWith('.gguf') ? p : `${p}.gguf`;
}
