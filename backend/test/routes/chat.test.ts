import { describe, test, before, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import type { IncomingMessage } from 'node:http';

import { assertInMemoryDatabase, createUserWithToken } from '../helpers.js';
import { db } from '../../src/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.js';
import chatRouter from '../../src/routes/chat.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { MockLlama } from '../mockLlama.js';
import type { SseEvent } from '../../src/routes/sseEvents.js';
import * as Types from '../../src/routes/types.js';

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
const toolServer = new ToolRegistry({ browser: undefined });

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
            try { parsed = JSON.parse(dataLine); } catch { /* [DONE] or empty */ }
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

/**
 * Builds a minimal valid ChatCompletionForm body.
 * chat_id: 'local:test' skips the chat ownership check.
 * A system prompt is required so preprocessImage.beforeRequest doesn't throw.
 */
function makeChatBody(overrides?: Record<string, any>): Types.ChatCompletionForm {
    return {
        stream: true,
        model: 'test model',
        messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hello' },
        ],
        chatId: `local:test`,
        chat: {
            id: '',
            title: '',
            model: '',
            history: {
                messages: {},
                currentId: null,
            },
            timestamp: 0,
        },
        params: {

        },
        userMessage: {
            id: '',
            parentId: '',
            childrenIds: [],
            role: 'user',
            content: '',
            files: [],
            timestamp: 0,
            done: true,
        },
        webSearchEnabled: false,
        generateTitle: false,
        systemPrompt: 'Test',
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
    });

    afterEach(() => mock.resetQueue());

    test('no tool calls — behaves like /completions with explicit [DONE]', async () => {
        // Default mock returns text with finish_reason: "stop" via the stop chunk,
        // but the accumulated finish_reason in handleStreamedResponse ends up null.
        // hasToolCalls() returns false so the loop exits.
        const res = await request(app)
            .post('/api/v1/chat/custom-completions')
            .set('Authorization', `Bearer ${token}`)
            .send(makeChatBody())
            .buffer(true)
            .parse(sseParser as any);

        console.log(`res: ${JSON.stringify(res, null, 2)}`);

        assert.strictEqual(res.status, 200);

        const body = res.body as unknown as string;
        assert.ok(body.includes('data: [DONE]'), 'Expected explicit [DONE] frame');

        const frames = parseSseBody(body);
        const completion = findChatEvent(frames, 'chat:completion');
        assert.ok(completion, 'Expected chat:completion event');
    });

    test('single tool round — systemInfo executes, result emitted, round 2 includes tool messages', async () => {
        // Round 1: model requests systemInfo
        mock.enqueue(req => MockLlama.createSSEResponse([
            toolCallChunk('systemInfo', 'call_si_1'),
            toolCallFinishChunk(),
        ], req.signal));

        // Round 2: model produces final text
        mock.enqueue(req => MockLlama.createSSEResponse([
            textChunk('Your system is Linux.'),
            stopChunk(),
        ], req.signal));

        const res = await request(app)
            .post('/api/v1/chat/custom-completions')
            .set('Authorization', `Bearer ${token}`)
            .send(makeChatBody())
            .buffer(true)
            .parse(sseParser as any);

        assert.strictEqual(res.status, 200);

        const body = res.body as unknown as string;
        const frames = parseSseBody(body);

        // tool_call:start
        const toolStart = findChatEvent(frames, 'tool_call:start');
        assert.ok(toolStart, 'Expected tool_call:start event');
        const startData = (toolStart.event.data as any).data;
        assert.strictEqual(startData.name, 'systemInfo');
        assert.strictEqual(startData.id, 'call_si_1');

        // tool_call:result — systemInfo actually ran
        const toolResult = findChatEvent(frames, 'tool_call:result');
        assert.ok(toolResult, 'Expected tool_call:result event');
        const resultData = (toolResult.event.data as any).data;
        assert.strictEqual(resultData.name, 'systemInfo');
        assert.ok(typeof resultData.result === 'string' && resultData.result.length > 0, 'Expected non-empty tool result');
        // systemInfo returns JSON with known keys
        const parsedResult = JSON.parse(resultData.result);
        assert.ok(typeof parsedResult.hostname === 'string', 'Expected hostname in systemInfo result');

        // Final content token from round 2
        const contentToken = frames.find(
            f => f.kind === 'token' && (f as TokenFrame).parsed?.choices?.[0]?.delta?.content === 'Your system is Linux.'
        );
        assert.ok(contentToken, 'Expected final content token from round 2');

        // Explicit [DONE] and chat:completion
        assert.ok(body.includes('data: [DONE]'), 'Expected [DONE] frame');
        const completion = findChatEvent(frames, 'chat:completion');
        assert.ok(completion, 'Expected chat:completion event');

        // Round 2 request must include assistant + tool result messages
        assert.strictEqual(mock.requests.length, 2, 'Expected exactly 2 llama requests');
        const round2Messages: any[] = mock.requests[1]!.body.messages;
        const assistantMsg = round2Messages.find(m => m.role === 'assistant' && m.tool_calls?.length > 0);
        assert.ok(assistantMsg, 'Expected assistant message with tool_calls in round 2');
        const toolMsg = round2Messages.find(m => m.role === 'tool');
        assert.ok(toolMsg, 'Expected tool message in round 2');
        assert.ok(typeof toolMsg.content === 'string' && toolMsg.content.length > 0, 'Expected non-empty tool message content');
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
            (resultData.result as string).startsWith('Error:'),
            `Expected error result, got: ${resultData.result}`,
        );

        // Despite the error, the model still finishes
        const completion = findChatEvent(frames, 'chat:completion');
        assert.ok(completion, 'Expected chat:completion event even after tool error');
    });
});
