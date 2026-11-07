import { describe, test, before, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { IncomingMessage } from 'node:http';

import { assertInMemoryDatabase, createUserWithToken } from '../helpers.js';
import { db, schema } from '../../src/db/index.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import chatRouter from '../../src/routes/completions/index.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { McpManager } from '../../src/mcp/manager.js';
import { SYSTEM_PROMPT_NOTES } from '../../src/routes/completions/notes.js';
import { MockLlama } from '../mockLlama.js';
import { fakeConnector, serverRecord } from '../fakeMcp.js';
import type { SseEvent } from '../../src/protocol/sse.js';
import * as Types from '../../src/routes/types/index.js';

/* -------------------- TEST SETUP -------------------- */

assertInMemoryDatabase();
await migrate(db, { migrationsFolder: './drizzle' });

async function clearDatabase(): Promise<void> {
    await db.delete(schema.auths);
    await db.delete(schema.users);
}

const app: Express = express();
app.use(express.json());
app.use(cookieParser());

const mock = new MockLlama();
const mcpCalls: { server: string; tool: string; args: unknown }[] = [];
const mcp = new McpManager(fakeConnector(mcpCalls));
const webServer = serverRecord({ id: 'srv-web', name: 'web', url: 'http://web.local/mcp', createdAt: 1 });
const otherServer = serverRecord({ id: 'srv-other', name: 'other', url: 'http://other.local/mcp', createdAt: 2 });
await mcp.sync([webServer, otherServer]);
const toolServer = new ToolRegistry(mcp, mock as any);

app.locals.llama = mock;
app.locals.tools = toolServer;
app.use('/api/v1/chat', chatRouter);

/* -------------------- SSE HELPERS -------------------- */

/** Supertest response parser that buffers raw SSE text into res.body. */
function sseParser(
    res: IncomingMessage,
    callback: (err: Error | null, body: string) => void,
): void {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => { body += chunk; });
    res.on('end', () => callback(null, body));
}

type TokenFrame = { kind: 'token'; raw: string; parsed?: any };
type ChatEventFrame = { kind: 'chat-event'; event: SseEvent };
type SseFrame = TokenFrame | ChatEventFrame;

/**
 * Splits a raw SSE body string into typed frames.
 * Frames with `event: chat-event` are parsed as SseEvent; others as token chunks.
 */
function parseSseBody(body: string): SseFrame[] {
    const frames: SseFrame[] = [];

    for (const part of body.split('\n\n')) {
        if (!part.trim()) continue;

        let eventType: string | undefined;
        let dataLine: string | undefined;

        for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7);
            else if (line.startsWith('data: ')) dataLine = line.slice(6);
        }

        if (dataLine === undefined) continue;

        if (eventType === 'chat-event') {
            try {
                const event = JSON.parse(dataLine) as SseEvent;
                frames.push({ kind: 'chat-event', event });
            } catch {
                frames.push({ kind: 'token', raw: dataLine });
            }
        } else {
            let parsed: any;
            try { parsed = JSON.parse(dataLine); } catch { /* empty */ }
            frames.push({ kind: 'token', raw: dataLine, parsed });
        }
    }

    return frames;
}

function findChatEvent(frames: SseFrame[], type: string): ChatEventFrame | undefined {
    return frames.find(
        f => f.kind === 'chat-event' && f.event.data.type === type
    ) as ChatEventFrame | undefined;
}

/* -------------------- REQUEST BUILDERS -------------------- */

let authToken = '';

async function complete(body: Types.ChatCompletionForm): Promise<SseFrame[]> {
    const res = await request(app)
        .post('/api/v1/chat/custom-completions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(body)
        .buffer(true)
        .parse(sseParser as any);
    assert.strictEqual(res.status, 200);
    return parseSseBody(res.body as unknown as string);
}

function withChat(body: Types.ChatCompletionForm, fields: Partial<Types.ChatObject>): Types.ChatCompletionForm {
    return { ...body, chat: { ...body.chat, ...fields } };
}

/** Puts an earlier user/assistant turn, with the given notes, before the body's user message. */
function withEarlierTurn(body: Types.ChatCompletionForm, notes: Types.MessageNote[]): Types.ChatCompletionForm {
    const messages = body.chat.history.messages;
    const user = Object.values(messages).find(m => m.role === 'user')!;
    const firstId = crypto.randomUUID();
    const replyId = crypto.randomUUID();
    return withChat(body, {
        history: {
            ...body.chat.history,
            messages: {
                ...messages,
                [firstId]: { id: firstId, parentId: null, childrenIds: [replyId], role: 'user', content: 'First', files: [], timestamp: 0, done: true, notes },
                [replyId]: { id: replyId, parentId: firstId, childrenIds: [user.id], role: 'assistant', content: 'Reply', files: [], timestamp: 0, done: true },
                [user.id]: { ...user, parentId: replyId },
            },
        },
    });
}

/**
 * Builds a minimal valid ChatCompletionForm body.
 * chatId: 'local:test' skips the chat ownership check.
 * History contains a user message and an empty assistant placeholder
 * so prepareRequest can derive the user message correctly.
 */
function makeChatBody(overrides?: Record<string, any>): Types.ChatCompletionForm {
    const userMsgId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    return {
        stream: true,
        chatId: 'local:test',
        chat: {
            title: '',
            model: 'test model',
            history: {
                messages: {
                    [userMsgId]: {
                        id: userMsgId,
                        parentId: null,
                        childrenIds: [assistantId],
                        role: 'user',
                        content: 'Hello',
                        files: [],
                        timestamp: 0,
                        done: true,
                    },
                    [assistantId]: {
                        id: assistantId,
                        parentId: userMsgId,
                        childrenIds: [],
                        role: 'assistant',
                        content: '',
                        files: [],
                        timestamp: 0,
                        done: false,
                    },
                },
                currentId: assistantId,
            },
            timestamp: 0,
        },
        promptVariables: {},
        ...overrides,
    };
}

/** Builds a minimal chat completion chunk, suitable for passing to MockLlama.createSSEResponse(). */
function makeChunk(overrides?: Record<string, any>): Record<string, any> {
    return {
        id: 'test1234',
        object: 'chat.completion.chunk',
        created: 1694268190,
        model: 'test model',
        choices: [{ index: 0, finish_reason: null, delta: {} }],
        ...overrides,
    };
}

/** Builds a tool-call delta chunk (round 1 response). */
function toolCallChunk(toolName: string, toolId: string, args: string = '{}'): Record<string, any> {
    return makeChunk({
        choices: [{
            index: 0,
            finish_reason: null,
            delta: {
                role: 'assistant',
                content: null,
                tool_calls: [{
                    index: 0,
                    id: toolId,
                    type: 'function',
                    function: { name: toolName, arguments: args },
                }],
            },
        }],
    });
}

/** Builds the finish chunk that signals tool_calls finish_reason. */
function toolCallFinishChunk(): Record<string, any> {
    return makeChunk({ choices: [{ index: 0, finish_reason: 'tool_calls', delta: {} }] });
}

/** Builds a text content chunk. */
function textChunk(content: string): Record<string, any> {
    return makeChunk({
        choices: [{ index: 0, finish_reason: null, delta: { role: 'assistant', content } }],
    });
}

/** Builds the finish chunk that signals stop finish_reason. */
function stopChunk(): Record<string, any> {
    return makeChunk({ choices: [{ index: 0, finish_reason: 'stop', delta: {} }] });
}

/* -------------------- /custom-completions -------------------- */

describe('POST /custom-completions', () => {
    let token: string;

    before(async () => {
        await clearDatabase();
        ({ token } = await createUserWithToken());
        authToken = token;
    });

    afterEach(() => mock.resetQueue());

    test('no tool calls — streams tokens and emits chat:completion', async () => {
        const res = await request(app)
            .post('/api/v1/chat/custom-completions')
            .set('Authorization', `Bearer ${token}`)
            .send(makeChatBody())
            .buffer(true)
            .parse(sseParser as any);

        assert.strictEqual(res.status, 200);

        const body = res.body as unknown as string;
        assert.ok(!body.includes('data: [DONE]'), 'Expected no [DONE] frame');

        const frames = parseSseBody(body);
        const completion = findChatEvent(frames, 'chat:completion');
        assert.ok(completion, 'Expected chat:completion event');
    });

    test('single tool round — MCP tool runs, progress and result emitted, round 2 includes tool messages', async () => {
        mock.enqueue(req => MockLlama.createSSEResponse([
            toolCallChunk('web_echo', 'call_1', JSON.stringify({ text: 'hi' })),
            toolCallFinishChunk(),
        ], req.signal));
        mock.enqueue(req => MockLlama.createSSEResponse([
            textChunk('Done.'),
            stopChunk(),
        ], req.signal));

        const frames = await complete(makeChatBody());

        const start = findChatEvent(frames, 'tool_call:start');
        assert.deepStrictEqual((start!.event.data as any).data, { id: 'call_1', name: 'web_echo', arguments: '{"text":"hi"}', server: 'web' });

        const progress = frames.filter(f => f.kind === 'chat-event' && f.event.data.type === 'tool_call:progress') as ChatEventFrame[];
        assert.deepStrictEqual(progress.map(p => (p.event.data as any).data.progress.page.status), ['loading', 'loaded']);

        const result = (findChatEvent(frames, 'tool_call:result')!.event.data as any).data;
        assert.strictEqual(result.result, 'echo: hi');
        assert.strictEqual(result.failed, false);
        assert.strictEqual(result.server, 'web');
        assert.deepStrictEqual(result.structured, { pages: [{ url: 'https://a.example/', outcome: 'ok' }] });

        assert.strictEqual(mock.requests.length, 2);
        const round2: any[] = mock.requests[1]!.body.messages;
        assert.ok(round2.find(m => m.role === 'assistant' && m.tool_calls?.length > 0));
        assert.strictEqual(round2.find(m => m.role === 'tool').content, 'echo: hi');
    });

    test('sends the same tools and system prompt whatever is turned off', async () => {
        await complete(makeChatBody());
        await complete(withChat(makeChatBody(), { disabledToolServers: ['srv-web'] }));

        const [a, b] = mock.requests;
        assert.deepStrictEqual(a!.body.tools, b!.body.tools);
        assert.deepStrictEqual(a!.body.messages[0], b!.body.messages[0]);
        assert.ok((a!.body.messages[0]!.content as string).endsWith(SYSTEM_PROMPT_NOTES));
        assert.deepStrictEqual(a!.body.tools!.map(t => t.function.name), ['web_echo', 'web_big', 'web_broken', 'web_search', 'other_echo', 'other_big', 'other_broken']);
    });

    test('tells the model in a note when tools are turned off, and refuses calls to them', async () => {
        mock.enqueue(req => MockLlama.createSSEResponse([
            toolCallChunk('web_search', 'call_off', JSON.stringify({ query: 'cats' })),
            toolCallFinishChunk(),
        ], req.signal));
        mock.enqueue(req => MockLlama.createSSEResponse([textChunk('OK.'), stopChunk()], req.signal));

        const body = withChat(makeChatBody(), { disabledToolServers: ['srv-web'] });
        const userId = Object.values(body.chat.history.messages).find(m => m.role === 'user')!.id;
        const callsBefore = mcpCalls.length;
        const frames = await complete(body);

        const user = mock.requests[0]!.body.messages.find(m => m.role === 'user')!;
        assert.match(user.content as string, /^Hello\n\n<kitsu-note>\nThe user has turned off these tools for now: web_echo, web_big, web_broken, web_search \(from web\)\./);

        const notes = (findChatEvent(frames, 'chat:notes')!.event.data as any).data;
        assert.deepStrictEqual(notes[userId][0].disabledServers, ['srv-web']);

        const result = (findChatEvent(frames, 'tool_call:result')!.event.data as any).data;
        assert.strictEqual(result.failed, true);
        assert.match(result.result, /turned off the web tools/);
        assert.strictEqual(mcpCalls.length, callsBefore, 'the server was never called');
    });

    test('adds no note when nothing changed, and one when tools come back on', async () => {
        await complete(makeChatBody());
        assert.ok(!(mock.requests[0]!.body.messages.at(-1)!.content as string).includes('kitsu-note'));

        // An earlier message noted web was off; now it's back on
        const body = withEarlierTurn(makeChatBody(), [{ kind: 'tools', text: 'off', disabledServers: ['srv-web'] }]);
        await complete(body);
        const messages = mock.requests[1]!.body.messages;
        assert.match(messages[1]!.content as string, /<kitsu-note>\noff\n<\/kitsu-note>$/, 'the earlier note is sent unchanged');
        assert.match(messages.at(-1)!.content as string, /turned all tools back on/);
    });

    test('older chats with web search off have every server turned off', async () => {
        await complete(withChat(makeChatBody(), { webSearchEnabled: false }));
        assert.match(mock.requests[0]!.body.messages.at(-1)!.content as string, /from web\); other_echo, other_big, other_broken \(from other\)/);
    });

    test('refuses tool results too large for the context left', async () => {
        mock.contextLength = 1000;
        mock.enqueue(req => MockLlama.createSSEResponse([
            toolCallChunk('web_big', 'call_big', JSON.stringify({ size: 8000 })),
            // llama-server reports the conversation's size with the last chunk
            makeChunk({
                choices: [{ index: 0, finish_reason: 'tool_calls', delta: {} }],
                timings: { cache_n: 0, prompt_n: 100, prompt_ms: 1, prompt_per_token_ms: 1, prompt_per_second: 1, predicted_n: 10, predicted_ms: 1, predicted_per_token_ms: 1, predicted_per_second: 1 },
            }),
        ], req.signal));
        mock.enqueue(req => MockLlama.createSSEResponse([textChunk('OK.'), stopChunk()], req.signal));

        try {
            const frames = await complete(makeChatBody());
            const result = (findChatEvent(frames, 'tool_call:result')!.event.data as any).data;
            assert.strictEqual(result.failed, true);
            assert.match(result.result, /^The result was 2000 tokens, but only 790 tokens of context are left/);
            assert.ok(mock.requests[1]!.body.tools?.length, 'tools stay listed');
        } finally {
            mock.contextLength = undefined;
        }
    });

    test('keeps saved notes on a stored chat even if the frontend sends the message without them', async () => {
        const chatId = crypto.randomUUID();
        const first = withChat({ ...makeChatBody(), chatId }, { disabledToolServers: ['srv-web'] });
        await complete(first);

        // Next turn: the frontend's copy of the first message has no notes
        const firstUser = Object.values(first.chat.history.messages).find(m => m.role === 'user')!;
        const firstReply = Object.values(first.chat.history.messages).find(m => m.role === 'assistant')!;
        const nextUserId = crypto.randomUUID();
        const nextReplyId = crypto.randomUUID();
        const { notes: _dropped, ...withoutNotes } = firstUser;
        const second = withChat({ ...first }, {
            history: {
                currentId: nextReplyId,
                messages: {
                    [firstUser.id]: withoutNotes,
                    [firstReply.id]: { ...firstReply, content: 'Reply', done: true, childrenIds: [nextUserId] },
                    [nextUserId]: { id: nextUserId, parentId: firstReply.id, childrenIds: [nextReplyId], role: 'user', content: 'Again', files: [], timestamp: 1, done: true },
                    [nextReplyId]: { id: nextReplyId, parentId: nextUserId, childrenIds: [], role: 'assistant', content: '', files: [], timestamp: 1, done: false },
                },
            },
        });
        await complete(second);

        // Stored chats also ask the model for a title; keep just the chat turns
        const [a, b] = mock.requests.filter(r => r.body.stream);
        const userTurns = (r: typeof a) => r!.body.messages.filter(m => m.role === 'user').map(m => m.content);
        assert.strictEqual(userTurns(b)[0], userTurns(a)[0], 'the first message reads exactly as before');
        assert.strictEqual(userTurns(b)[1], 'Again', 'no new note: nothing changed');
    });

    test('unknown tool — result contains error text, model still produces final response', async () => {
        // Round 1: model calls a nonexistent tool
        mock.enqueue(req => MockLlama.createSSEResponse([
            toolCallChunk('nonexistent_tool', 'call_err_1'),
            toolCallFinishChunk(),
        ], req.signal));

        // Round 2: model recovers
        mock.enqueue(req => MockLlama.createSSEResponse([
            textChunk('I could not do that.'),
            stopChunk(),
        ], req.signal));

        const res = await request(app)
            .post('/api/v1/chat/custom-completions')
            .set('Authorization', `Bearer ${token}`)
            .send(makeChatBody())
            .buffer(true)
            .parse(sseParser as any);

        assert.strictEqual(res.status, 200);

        const frames = parseSseBody(res.body as unknown as string);

        // tool_call:result should contain error text
        const toolResult = findChatEvent(frames, 'tool_call:result');
        assert.ok(toolResult, 'Expected tool_call:result event');
        const resultData = (toolResult.event.data as any).data;
        assert.ok(
            (resultData.result as string).startsWith('Unknown tool:'),
            `Expected error result, got: ${resultData.result}`,
        );

        // Despite the error, the model still finishes
        const completion = findChatEvent(frames, 'chat:completion');
        assert.ok(completion, 'Expected chat:completion event even after tool error');
    });
});
