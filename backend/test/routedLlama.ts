import fetch from 'node-fetch';
import path from 'path';

import type { LlamaRequest, LlamaResponse } from "../src/llama/llamaManager.js";
import LlamaStream from "../src/llama/llamaStream.js";
import type { ModelConfig } from '../src/config.js';
import * as proto from '../src/protocol.js';

/**
 * Pass completions requests to existing kitsu-backend server
 * (for frontend testing without disrupting prod instance)
 */
export class RoutedLlama {

    models: string[];
    modelInfos: Map<string, proto.ModelInfo>;

    constructor(cfg: ModelConfig) {
        // Map models s.t. (key == model name, value == model info)
        this.models = cfg.models.map(model => model.alias ?? model.gguf);

        console.log(`RoutedLlama sees models: ${this.models}`);

        this.modelInfos = new Map(cfg.models.map(model => {
            const name = model.alias ?? model.gguf;

            const basePath = cfg.path;
            const modelPath = path.join(basePath, model.gguf.endsWith('.gguf')
                ? model.gguf
                : model.gguf + '.gguf');

            const mmprojPath = (model.mmproj ? model.mmproj.endsWith('.gguf')
                ? path.join(basePath, model.mmproj)
                : path.join(basePath, model.mmproj + '.gguf')
                : undefined);

            const args = model.args ?? [];
            const ctxIdx = args.indexOf('--ctx-size');
            const contextLength = ctxIdx !== -1 ? Number(args[ctxIdx + 1]) || undefined : undefined;
            console.log(`ctx of ${name}: ${contextLength}`)

            return [name, {
                name: name,
                path: modelPath,
                mmprojPath: mmprojPath,
                args: args,
                params: model.params ?? {},
                contextLength,
            }];
        }))
    }

    async completions(req: LlamaRequest): Promise<LlamaResponse> {
        console.log()

        const backendUrl = 'http://192.168.87.30:8081/v1/chat/completions'

        let stream: LlamaStream | null = null;

        const body = { ...req.body, timings_per_token: true, return_progress: true };
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: req.signal,
        });

        const contentType: string | null = response.headers.get('content-type');

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`backend returned error: ${errText}`);
        } else if (response.body === null) {
            throw new Error(`backend returned null response.body`);
        } else if (contentType === null) {
            throw new Error(`shim did not return expected header: content-type`);
        }

        const expectSSE = contentType.includes('text/event-stream');
        stream = new LlamaStream(
            response.body,
            expectSSE,
            req.signal,
        );

        stream.once('stop', () => {
            console.log('backend stream stopped');
        });

        return {
            status: response.status,
            headers: response.headers,
            stream: stream,
        };
    }

    stopServer() {
        console.log('nothing to stop, cheif!');
    }

    forceStopServer() {
        console.log('nothing to stop, cheif! (part 2)');
    }

    getModelInfo(name: string): proto.ModelInfo | undefined {
        return this.modelInfos.get(name);
    }

    getAllModelNames(): string[] {
        return [...this.models];
    }
}