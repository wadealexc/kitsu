import { describe, test } from 'node:test';
import assert from 'node:assert';

import { McpManager, type McpProgress } from '../../src/mcp/manager.js';
import { fakeConnector, serverRecord } from '../fakeMcp.js';

describe('McpManager', () => {
    test('lists the tools of enabled servers in a stable order', async () => {
        const mcp = new McpManager(fakeConnector());
        const web = serverRecord({ name: 'web', url: 'http://web.local/mcp', createdAt: 1 });
        const off = serverRecord({ name: 'off', enabled: false, createdAt: 2 });
        await mcp.sync([off, web]);

        assert.deepStrictEqual(mcp.tools().map(t => t.name), ['echo', 'big', 'broken', 'web_search']);
        assert.ok(mcp.tools().every(t => t.serverName === 'web'));
        assert.strictEqual(mcp.status().find(s => s.name === 'off')!.state, 'disabled');
        await mcp.close();
    });

    test('prefixes tool names that two servers share', async () => {
        const mcp = new McpManager(fakeConnector());
        await mcp.sync([
            serverRecord({ name: 'Alpha One', createdAt: 1 }),
            serverRecord({ name: 'beta', url: 'http://web.local/mcp', createdAt: 2 }),
        ]);

        const names = mcp.tools().map(t => t.name);
        assert.ok(names.includes('alpha_one_echo'));
        assert.ok(names.includes('beta_echo'));
        assert.ok(names.includes('web_search'), 'unique names stay as they are');
        await mcp.close();
    });

    test('reports servers it cannot reach, without failing the others', async () => {
        const mcp = new McpManager(fakeConnector());
        await mcp.sync([serverRecord({ name: 'gone', url: 'http://down.local/mcp' }), serverRecord({ name: 'ok' })]);

        const gone = mcp.status().find(s => s.name === 'gone')!;
        assert.strictEqual(gone.state, 'error');
        assert.match(gone.error!, /connection refused/);
        assert.strictEqual(mcp.status().find(s => s.name === 'ok')!.state, 'connected');
        await mcp.close();
    });

    test('never reveals the token in status', async () => {
        const mcp = new McpManager(fakeConnector());
        await mcp.sync([serverRecord({ token: 'secret-value' })]);
        const status = mcp.status()[0]!;
        assert.strictEqual(status.hasToken, true);
        assert.ok(!JSON.stringify(status).includes('secret-value'));
        await mcp.close();
    });

    test('calls tools, forwarding progress and structured results', async () => {
        const mcp = new McpManager(fakeConnector());
        await mcp.sync([serverRecord()]);
        const echo = mcp.tools().find(t => t.name === 'echo')!;

        const progress: McpProgress[] = [];
        const result = await mcp.call(echo, { text: 'hi' }, { signal: new AbortController().signal, onProgress: p => progress.push(p) });

        assert.deepStrictEqual(result, { ok: true, text: 'echo: hi', structured: { pages: [{ url: 'https://a.example/', outcome: 'ok' }] } });
        assert.deepStrictEqual(progress.map(p => p.page?.status), ['loading', 'loaded']);
        assert.strictEqual(progress[0]!.message, 'loading a.example');

        const broken = await mcp.call(mcp.tools().find(t => t.name === 'broken')!, {}, { signal: new AbortController().signal });
        assert.deepStrictEqual(broken, { ok: false, text: 'it broke' });
        await mcp.close();
    });

    test('keeps a server\'s tools listed when it is reconnected', async () => {
        const mcp = new McpManager(fakeConnector());
        const record = serverRecord();
        await mcp.sync([record]);
        const before = mcp.tools().map(t => t.name);

        await mcp.sync([{ ...record, token: 'new' }]);
        assert.deepStrictEqual(mcp.tools().map(t => t.name), before);

        await mcp.sync([]);
        assert.deepStrictEqual(mcp.tools(), []);
        await mcp.close();
    });
});

describe('sandbox calls', () => {
    const sandboxClient = (callTool: () => Promise<unknown>) => ({
        listTools: async () => ({ tools: [{ name: 'bash', description: '', inputSchema: { type: 'object' } }] }),
        getServerCapabilities: () => ({ experimental: { 'kitsu/sandbox': {} } }),
        callTool,
        close: async () => {},
    });
    const identity = { chat: '00000000-0000-4000-8000-000000000000', user: 'u1' };
    const box = serverRecord({ id: 'box', name: 'box', url: 'http://box.local/mcp', createdAt: 1 });

    test('does not repeat a call that failed', async () => {
        let calls = 0;
        const mcp = new McpManager(async () => sandboxClient(async () => { calls++; throw new Error('boom'); }) as any);
        await mcp.sync([box]);
        const result = await mcp.call(mcp.tools()[0]!, {}, { signal: new AbortController().signal, identity });
        assert.equal(calls, 1);
        assert.equal(result.ok, false);
    });

    test('tells the manager to stop when the call is aborted', async () => {
        const controller = new AbortController();
        const seen: string[] = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async (url: URL) => { seen.push(String(url)); return new Response(null, { status: 204 }); }) as typeof fetch;
        try {
            const mcp = new McpManager(async () => sandboxClient(() => new Promise((_, reject) => {
                controller.signal.addEventListener('abort', () => reject(new Error('aborted')));
            })) as any);
            await mcp.sync([box]);
            const call = mcp.call(mcp.tools()[0]!, {}, { signal: controller.signal, identity });
            controller.abort();
            await assert.rejects(call);
            assert.deepEqual(seen, [`http://box.local/sandboxes/${identity.chat}/cancel?user=u1`]);
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});
