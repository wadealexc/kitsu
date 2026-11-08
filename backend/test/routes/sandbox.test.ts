import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { assertInMemoryDatabase, createUserWithToken } from '../helpers.js';
import { db, schema, Chats } from '../../src/db/index.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import chatRouter from '../../src/routes/completions/index.js';
import sandboxRouter from '../../src/routes/sandbox.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { McpManager } from '../../src/mcp/manager.js';
import { MockLlama } from '../mockLlama.js';
import { fakeConnector, serverRecord } from '../fakeMcp.js';
import type * as Types from '../../src/routes/types/index.js';

assertInMemoryDatabase();
await migrate(db, { migrationsFolder: './drizzle' });

// The sandbox manager, as far as these routes are concerned
const managerCalls: { method: string; url: URL; auth?: string }[] = [];
const fakeManager: Server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url!, 'http://x');
    managerCalls.push({ method: req.method!, url, ...(req.headers.authorization ? { auth: req.headers.authorization } : {}) });
    if (url.pathname.endsWith('/file') && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-length': '20' });
        return res.end('<script>x</script>!!');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ entries: [] }));
});
await new Promise<void>(resolve => fakeManager.listen(0, '127.0.0.1', resolve));
const managerPort = (fakeManager.address() as AddressInfo).port;

const mock = new MockLlama();
const calls: { server: string; tool: string; args: any }[] = [];
const mcp = new McpManager(fakeConnector(calls));
const web = serverRecord({ id: 'srv-web', name: 'web', url: 'http://web.local/mcp', createdAt: 1 });
const box = { ...serverRecord({ id: 'srv-box', name: 'box', url: `http://127.0.0.1:${managerPort}/sandbox/mcp`, token: 'manager-token', createdAt: 2 }), icon: 'terminal', condensed: false };
await mcp.sync([web, box]);

const app: Express = express();
app.use(express.json());
app.use(cookieParser());
app.locals.llama = mock;
app.locals.mcp = mcp;
app.locals.tools = new ToolRegistry(mcp, mock as any);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/sandbox', sandboxRouter);

const chunk = (choice: object) => ({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'test model', choices: [{ index: 0, ...choice }] });
const text = (content: string) => chunk({ finish_reason: null, delta: { role: 'assistant', content } });
const stop = () => chunk({ finish_reason: 'stop', delta: {} });
const callTool = (name: string, args: string) => chunk({ finish_reason: null, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name, arguments: args } }] } });
const toolFinish = () => chunk({ finish_reason: 'tool_calls', delta: {} });

const replyWith = (...frames: object[]) => mock.enqueue(req => MockLlama.createSSEResponse(frames, req.signal));

function body(chatId: string, fields: Partial<Types.ChatObject> = {}, extra: object = {}): Types.ChatCompletionForm {
    const userId = crypto.randomUUID();
    const replyId = crypto.randomUUID();
    return {
        stream: true, chatId, promptVariables: {}, ...extra,
        chat: {
            title: 'T', model: 'test model', timestamp: 0, ...fields,
            history: {
                currentId: replyId,
                messages: {
                    [userId]: { id: userId, parentId: null, childrenIds: [replyId], role: 'user', content: 'Hi', files: [], timestamp: 0, done: true },
                    [replyId]: { id: replyId, parentId: userId, childrenIds: [], role: 'assistant', content: '', files: [], timestamp: 0, done: false },
                },
            },
        },
    } as Types.ChatCompletionForm;
}

let token = '';
let userId = '';
const send = async (b: Types.ChatCompletionForm) => {
    const res = await request(app).post('/api/v1/chat/custom-completions').set('Authorization', `Bearer ${token}`).send(b).buffer(true)
        .parse(((r: IncomingMessage, cb: (e: Error | null, s: string) => void) => { let s = ''; r.setEncoding('utf8'); r.on('data', c => { s += c; }); r.on('end', () => cb(null, s)); }) as any);
    assert.strictEqual(res.status, 200);
    return res.body as unknown as string;
};
const toolNames = (i = 0) => (mock.requests[i]!.body.tools ?? []).map((t: any) => t.function.name);
const lastUser = (i = 0) => mock.requests[i]!.body.messages.filter(m => m.role === 'user').at(-1)!.content as string;

describe('sandbox in chats', () => {
    before(async () => {
        await db.delete(schema.chats);
        ({ token, userId } = await createUserWithToken());
    });
    afterEach(() => { mock.resetQueue(); managerCalls.length = 0; calls.length = 0; });

    test('a chat that never turned it on never sees its tools, and gets no note', async () => {
        replyWith(text('ok'), stop());
        await send(body(crypto.randomUUID()));
        assert.ok(toolNames().includes('web_search'));
        assert.ok(!toolNames().includes('sandbox_whoami'));
        assert.ok(!lastUser().includes('kitsu-note'));
    });

    test('turned on, the tools appear and the call carries the real chat and user, whatever the model passes', async () => {
        const chatId = crypto.randomUUID();
        replyWith(callTool('sandbox_whoami', JSON.stringify({ chat: 'someone-elses-chat' })), toolFinish());
        replyWith(text('done'), stop());
        await send(body(chatId, { sandboxEnabled: true }));

        assert.ok(toolNames().includes('sandbox_whoami'));
        assert.ok(!lastUser().includes('kitsu-note'));
        const call = calls.find(c => c.tool === 'sandbox_whoami')!;
        assert.deepStrictEqual(call.args.identity, { chat: chatId, user: userId });
        assert.strictEqual(call.args.given.chat, 'someone-elses-chat');
    });

    test('other servers never receive the identity', async () => {
        replyWith(callTool('web_search', JSON.stringify({ query: 'x' })), toolFinish());
        replyWith(text('done'), stop());
        await send(body(crypto.randomUUID(), { sandboxEnabled: true }));
        assert.strictEqual(calls.find(c => c.tool === 'web_search')!.args.identity, undefined);
    });

    test('turned off after being on: the tools stay listed, a note says so, and calls are refused', async () => {
        const chatId = crypto.randomUUID();
        replyWith(text('first'), stop());
        await send(body(chatId, { sandboxEnabled: true }));
        mock.requests.length = 0;

        replyWith(callTool('sandbox_whoami', '{}'), toolFinish());
        replyWith(text('fine'), stop());
        const out = await send(body(chatId, { sandboxEnabled: false, sandboxActivated: true }));

        assert.ok(toolNames().includes('sandbox_whoami'));
        assert.match(lastUser(), /turned off these tools for now: .*sandbox_whoami/);
        assert.ok(out.includes('turned off the box tools'));
        assert.strictEqual(calls.filter(c => c.tool === 'sandbox_whoami').length, 0);
    });

    test('stays off in a temporary chat, even if asked for', async () => {
        replyWith(callTool('sandbox_whoami', '{}'), toolFinish());
        replyWith(text('fine'), stop());
        await send(body('local:temp', { sandboxEnabled: true }));
        assert.ok(!toolNames().includes('sandbox_whoami'));
        assert.strictEqual(calls.filter(c => c.tool === 'sandbox_whoami').length, 0);
    });

    test('tells the model about uploaded files, only when the sandbox is on', async () => {
        replyWith(text('ok'), stop());
        await send(body(crypto.randomUUID(), { sandboxEnabled: true }, { sandboxUploads: ['data.csv', 'notes/a.txt'] }));
        assert.match(lastUser(), /added these files to the sandbox workspace: data.csv, notes\/a.txt/);
    });
});

describe('sandbox file routes', () => {
    let other = '';
    let chatId = '';
    before(async () => {
        ({ token: other } = await createUserWithToken());
        chatId = crypto.randomUUID();
        await Chats.createChat(userId, { id: chatId, title: 'Mine', chat: { title: 'Mine', model: 'm', timestamp: 0, history: { messages: {}, currentId: null } } as never, folderId: null }, db);
    });
    afterEach(() => { managerCalls.length = 0; });
    after(() => { fakeManager.close(); return mcp.close(); });

    test("passes on the confirmed user with the manager's token", async () => {
        const res = await request(app).get(`/api/v1/sandbox/${chatId}/files?path=sub`).set('Authorization', `Bearer ${token}`);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(managerCalls[0]!.url.searchParams.get('user'), userId);
        assert.strictEqual(managerCalls[0]!.url.searchParams.get('path'), 'sub');
        assert.strictEqual(managerCalls[0]!.auth, 'Bearer manager-token');
    });

    test("another user can't reach a chat's sandbox, and the manager never hears of it", async () => {
        for (const path of ['', '/files', '/file?path=a']) {
            const res = await request(app).get(`/api/v1/sandbox/${chatId}${path}`).set('Authorization', `Bearer ${other}`);
            assert.strictEqual(res.status, 404, path);
        }
        assert.strictEqual(managerCalls.length, 0);
    });

    test('needs a login, and a real chat id', async () => {
        assert.strictEqual((await request(app).get(`/api/v1/sandbox/${chatId}/files`)).status, 401);
        assert.strictEqual((await request(app).get('/api/v1/sandbox/not-a-uuid/files').set('Authorization', `Bearer ${token}`)).status, 400);
    });

    test('files always download, so a page made in the sandbox can never run on kitsu', async () => {
        const res = await request(app).get(`/api/v1/sandbox/${chatId}/file?path=evil.html`).set('Authorization', `Bearer ${token}`).buffer(true).parse(((r: IncomingMessage, cb: (e: Error | null, s: Buffer) => void) => { const c: Buffer[] = []; r.on('data', d => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); }) as any);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers['content-type'], 'application/octet-stream');
        assert.match(res.headers['content-disposition'] as string, /^attachment/);
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    });
});
