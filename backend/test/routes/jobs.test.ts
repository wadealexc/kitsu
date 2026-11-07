import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { Readable } from 'node:stream';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Headers } from 'node-fetch';

import { assertInMemoryDatabase, createUserWithToken } from '../helpers.js';
import { db, schema, Chats } from '../../src/db/index.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import chatRouter from '../../src/routes/completions/index.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { McpManager } from '../../src/mcp/manager.js';
import LlamaStream from '../../src/llama/llamaStream.js';
import { compactReplay } from '../../src/routes/completions/jobs.js';
import { MockLlama } from '../mockLlama.js';
import type * as Types from '../../src/routes/types/index.js';

assertInMemoryDatabase();
await migrate(db, { migrationsFolder: './drizzle' });

const mock = new MockLlama();
const app: Express = express();
app.use(express.json());
app.use(cookieParser());
app.locals.llama = mock;
app.locals.tools = new ToolRegistry(new McpManager(async () => { throw new Error('no servers'); }), mock as any);
app.use('/api/v1/chat', chatRouter);

let server: Server;
let base = '';
let token = '';

/** A reply streamed one word every `gapMs`, so a test can act while it's in progress. */
function slowReply(words: string[], gapMs: number) {
    return (req: { signal: AbortSignal }) => {
        async function* frames() {
            for (const word of words) {
                await new Promise(r => setTimeout(r, gapMs));
                yield `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'test model', choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', content: word } }] })}\n\n`;
            }
            yield `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'test model', choices: [{ index: 0, finish_reason: 'stop', delta: {} }] })}\n\n`;
        }
        return {
            status: 200,
            headers: new Headers({ 'content-type': 'text/event-stream' }),
            stream: new LlamaStream(Readable.from(frames()), true, req.signal as any),
        };
    };
}

function chatBody(chatId: string): Types.ChatCompletionForm {
    const userId = crypto.randomUUID();
    const replyId = crypto.randomUUID();
    return {
        stream: true,
        chatId,
        promptVariables: {},
        chat: {
            title: 'Jobs',
            model: 'test model',
            timestamp: 0,
            history: {
                currentId: replyId,
                messages: {
                    [userId]: { id: userId, parentId: null, childrenIds: [replyId], role: 'user', content: 'Hi', files: [], timestamp: 0, done: true },
                    [replyId]: { id: replyId, parentId: userId, childrenIds: [], role: 'assistant', content: '', files: [], timestamp: 0, done: false },
                },
            },
        },
    };
}

const auth = () => ({ Authorization: `Bearer ${token}`, 'content-type': 'application/json' });

/** The reply text in an SSE body (token frames only). */
function replyText(body: string): string {
    return body.split('\n\n')
        .filter(part => part.startsWith('data: '))
        .map(part => { try { return JSON.parse(part.slice(6)).choices?.[0]?.delta?.content ?? ''; } catch { return ''; } })
        .join('');
}

async function readAll(res: Response): Promise<string> {
    return await res.text();
}

describe('generation jobs', () => {
    before(async () => {
        await db.delete(schema.chats);
        ({ token } = await createUserWithToken());
        server = app.listen(0, '127.0.0.1');
        await new Promise(r => server.once('listening', r));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/chat`;
    });

    after(() => server.close());
    afterEach(() => mock.resetQueue());

    test('keeps generating when the client goes away, and a returning client gets the whole reply', async () => {
        const chatId = crypto.randomUUID();
        mock.enqueue(slowReply(['one ', 'two ', 'three ', 'four'], 40));

        // Start, read a little, then drop the connection (the app was suspended)
        const ctrl = new AbortController();
        const first = await fetch(`${base}/custom-completions`, { method: 'POST', headers: auth(), body: JSON.stringify(chatBody(chatId)), signal: ctrl.signal });
        assert.strictEqual(first.status, 200);
        const reader = first.body!.getReader();
        await reader.read();
        ctrl.abort();

        // It's still running
        const active = await (await fetch(`${base}/custom-completions/active`, { headers: auth() })).json();
        assert.deepStrictEqual(active.map((a: any) => a.chatId), [chatId]);

        // Coming back: the whole reply, replayed from the start and then followed live
        const again = await fetch(`${base}/custom-completions/${chatId}/stream`, { headers: auth() });
        assert.strictEqual(again.status, 200);
        const body = await readAll(again);
        assert.strictEqual(replyText(body), 'one two three four');
        assert.ok(body.includes('"chat:completion"'));

        // And it was saved
        const saved = await Chats.getChatById(chatId, db);
        const reply = Object.values(saved!.chat.history.messages).find(m => m.role === 'assistant')!;
        assert.strictEqual(reply.content, 'one two three four');
        assert.strictEqual(reply.done, true);
    });

    test('saves the chat with the unfinished reply as soon as it starts', async () => {
        const chatId = crypto.randomUUID();
        mock.enqueue(slowReply(['slow ', 'reply'], 80));
        const body = chatBody(chatId);
        const res = await fetch(`${base}/custom-completions`, { method: 'POST', headers: auth(), body: JSON.stringify(body) });
        const reader = res.body!.getReader();
        await reader.read();

        // Mid-reply, the saved chat already has the reply, unfinished
        const saved = await Chats.getChatById(chatId, db);
        const reply = saved!.chat.history.messages[body.chat.history.currentId!]!;
        assert.strictEqual(saved!.chat.history.currentId, body.chat.history.currentId);
        assert.strictEqual(reply.done, false);

        // Let it finish, so it doesn't show up as running in later tests
        while (!(await reader.read()).done) { /* drain */ }
    });

    test('stop ends the reply, keeping what was written', async () => {
        const chatId = crypto.randomUUID();
        mock.enqueue(slowReply(['a ', 'b ', 'c ', 'd ', 'e ', 'f'], 60));

        const res = await fetch(`${base}/custom-completions`, { method: 'POST', headers: auth(), body: JSON.stringify(chatBody(chatId)) });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let seen = '';
        while (!seen.includes('"content":"a "')) seen += decoder.decode((await reader.read()).value);

        const stopped = await fetch(`${base}/custom-completions/${chatId}/stop`, { method: 'POST', headers: auth() });
        assert.deepStrictEqual(await stopped.json(), { stopped: true });

        // The stream ends with a completion event and no error
        let body = '';
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            body += decoder.decode(value);
        }
        assert.ok(body.includes('"chat:completion"'));
        assert.ok(!body.includes('"error"'));

        const saved = await Chats.getChatById(chatId, db);
        const reply = Object.values(saved!.chat.history.messages).find(m => m.role === 'assistant')!;
        assert.strictEqual(reply.done, true);
        assert.strictEqual(reply.error, undefined);
        // What was written before the stop is kept (mid-round: there were no tool rounds)
        assert.ok(reply.content.startsWith('a '), `saved: ${JSON.stringify(reply.content)}`);
        assert.ok(reply.content.length < 'a b c d e f'.length, 'and nothing after it');

        const active = await (await fetch(`${base}/custom-completions/active`, { headers: auth() })).json();
        assert.deepStrictEqual(active, []);
    });

    test('one reply at a time per chat', async () => {
        const chatId = crypto.randomUUID();
        mock.enqueue(slowReply(['x ', 'y'], 50));
        const res = await fetch(`${base}/custom-completions`, { method: 'POST', headers: auth(), body: JSON.stringify(chatBody(chatId)) });

        const second = await fetch(`${base}/custom-completions`, { method: 'POST', headers: auth(), body: JSON.stringify(chatBody(chatId)) });
        assert.strictEqual(second.status, 409);
        await res.text();
    });

    test('nothing to follow or stop in a chat without a reply running', async () => {
        const chatId = crypto.randomUUID();
        assert.strictEqual((await fetch(`${base}/custom-completions/${chatId}/stream`, { headers: auth() })).status, 404);
        assert.strictEqual((await fetch(`${base}/custom-completions/${chatId}/stop`, { method: 'POST', headers: auth() })).status, 404);
    });

    test("other users can't follow or stop a reply", async () => {
        const chatId = crypto.randomUUID();
        mock.enqueue(slowReply(['p ', 'q'], 50));
        const res = await fetch(`${base}/custom-completions`, { method: 'POST', headers: auth(), body: JSON.stringify(chatBody(chatId)) });

        const { token: other } = await createUserWithToken();
        const headers = { Authorization: `Bearer ${other}` };
        assert.strictEqual((await fetch(`${base}/custom-completions/${chatId}/stream`, { headers })).status, 404);
        assert.strictEqual((await fetch(`${base}/custom-completions/${chatId}/stop`, { method: 'POST', headers })).status, 404);
        await res.text();
    });
});

describe('compactReplay', () => {
    const tok = (delta: object, extra: object = {}) =>
        `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, finish_reason: null, delta }], ...extra })}\n\n`;

    test('merges token runs, keeps everything else in order, drops stale progress', () => {
        const stream = [
            tok({}, { prompt_progress: { total: 10, cache: 0, processed: 5 } }),
            tok({ reasoning_content: 'Let ' }, { timings: { predicted_n: 1 } }), tok({ reasoning_content: 'me ' }, { timings: { predicted_n: 2 } }), tok({ reasoning_content: 'think' }, { timings: { predicted_n: 3 } }),
            tok({ content: 'Hel' }), tok({ content: 'lo ' }),
            'event: chat-event\ndata: {"chatId":"c","data":{"type":"tool_call:start","data":{"id":"1","name":"t","arguments":"{}"}}}\n\n',
            tok({ content: 'wor' }), tok({ content: 'ld' }),
            `data: ${JSON.stringify({ choices: [{ index: 0, finish_reason: 'stop', delta: {} }], timings: { predicted_n: 9 } })}\n\n`,
            'data: {"partial',
        ].join('');

        const out = compactReplay(stream);
        const events = out.split('\n\n');
        assert.strictEqual(events.length, 6, out);
        assert.deepStrictEqual(JSON.parse(events[0]!.slice(6)).choices[0].delta, { reasoning_content: 'Let me think' });
        assert.deepStrictEqual(JSON.parse(events[0]!.slice(6)).timings, { predicted_n: 3 }, 'keeps the latest timings');
        assert.deepStrictEqual(JSON.parse(events[1]!.slice(6)).choices[0].delta, { content: 'Hello ' });
        assert.ok(events[2]!.startsWith('event: chat-event'));
        assert.deepStrictEqual(JSON.parse(events[3]!.slice(6)).choices[0].delta, { content: 'world' });
        assert.strictEqual(JSON.parse(events[4]!.slice(6)).choices[0].finish_reason, 'stop');
        assert.strictEqual(events[5], 'data: {"partial');
    });
});
