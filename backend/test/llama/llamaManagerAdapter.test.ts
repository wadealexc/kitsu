import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { LlamaManagerAdapter } from '../../src/llama/llamaManagerAdapter.js';

describe('LlamaManagerAdapter models', () => {
    let server: http.Server;
    let url: string;
    let up = true;
    let requests = 0;

    before(async () => {
        server = http.createServer((req, res) => {
            requests++;
            if (!up) { res.writeHead(503).end(); return; }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ object: 'list', data: [
                { id: 'qwen3.8-dense-mtp', object: 'model', created: 0, owned_by: 'llama-manager', status: 0, queued: false, active: false, n_ctx: 262144 },
                { id: 'gemma4-artemis', object: 'model', created: 0, owned_by: 'llama-manager', status: 0, queued: false, active: true, n_ctx: 180992 },
            ] }));
        });
        await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(() => server.close());

    test('offers the models llama-manager serves, with their context size', async () => {
        const llama = new LlamaManagerAdapter({ managerUrl: url });
        assert.deepStrictEqual(await llama.getAllModelNames(), ['qwen3.8-dense-mtp', 'gemma4-artemis']);
        assert.deepStrictEqual(await llama.getModelInfo('gemma4-artemis'), { name: 'gemma4-artemis', params: {}, contextLength: 180992 });
        assert.strictEqual(await llama.getModelInfo('not-served'), undefined);
    });

    test('reuses the list briefly, and keeps the last one when llama-manager is down', async () => {
        const llama = new LlamaManagerAdapter({ managerUrl: url });
        await llama.getAllModelNames();
        const before = requests;
        await llama.getAllModelNames();
        assert.strictEqual(requests, before, 'second call within a few seconds is served from the cache');

        up = false;
        (llama as any).lastFetchedAt = 0; // pretend the cache expired
        assert.deepStrictEqual(await llama.getAllModelNames(), ['qwen3.8-dense-mtp', 'gemma4-artemis']);
        up = true;
    });
});
