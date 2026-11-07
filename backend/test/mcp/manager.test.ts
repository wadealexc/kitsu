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
