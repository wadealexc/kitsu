import { Router, type Response, type NextFunction } from 'express';
import chalk from 'chalk';
import { z } from 'zod';

import type { Llama, LlamaResponse } from '../../llama/types.js';
import * as Types from '../types/index.js';
import { requireAuth } from '../middleware.js';
import * as proto from '../../protocol/index.js';
import { ToolRegistry } from '../../tools/registry.js';
import type { SseUsage } from '../../protocol/sse.js';

import { prepareRequest, type ChatRequestContext } from './prepare.js';
import {
    emitSseEvent,
    emitCallback,
    emitEventsAndExecuteTools,
    accumulateBlocks,
    accumulateUsage,
    getFinalUsage,
    logCompletion,
    newUsageInfo,
    type RoundLog,
    type ToolExecResult,
    type UsageInfo,
} from './helpers.js';
import { createToolSession } from '../../tools/types.js';
import { doTasks } from './tasks.js';
import { Chats, db } from '../../db/index.js';

const router = Router();

/* -------------------- CUSTOM COMPLETION -------------------- */

const MAX_TOOL_ROUNDS = 100;

// Context budget threshold: tool calls are refused once the conversation reaches this fraction of context
const CONTEXT_THRESHOLD_PCT = 0.9;

/**
 * POST /api/v1/chat/custom-completions
 * Access Control: Any authenticated user
 *
 * Chat completions endpoint designed to be used with a frontend.
 *
 * When an LLM response ends with a tool call, this endpoint executes the tool call
 * and passes it back to the model in a multi-round loop that only ends when the
 * model produces its final result.
 *
 * Tool definitions and executions are injected automatically - they must already
 * exist and be configured on the backend.
 * 
 * This endpoint emits several non-OAI SSE events which are consumed by the frontend.
 */
router.post('/custom-completions', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
    res: Response<any | Types.ErrorResponse>,
    next: NextFunction,
) => {
    console.log(`custom-completions: received request`);

    const llama = req.app.locals.llama as Llama;
    const toolRegistry = req.app.locals.tools as ToolRegistry;

    const ctrl = new AbortController();
    const taskCtrl = new AbortController();
    {
        // Abort taskCtrl if parent aborts
        ctrl.signal.addEventListener('abort', () => {
            taskCtrl.abort();
        }, { once: true });

        // Abort ctrl if client/request aborts or finishes
        res.once('close', () => ctrl.abort());
        req.once('aborted', () => {
            console.log(chalk.dim.yellow(`[custom-completions] client aborted request`));
            ctrl.abort();
        });
    }

    let ctx: ChatRequestContext;
    let body: proto.CompletionRequest;
    try {
        // Validate request, resolve model, system prompt, params, and tools, 
        // and construct OAI message format
        ctx = await prepareRequest(req, llama, toolRegistry);
        body = ctx.completionBody;
    } catch (err: any) {
        return res.status(400).json({ detail: err?.message ?? String(err) });
    }

    // Commit SSE headers before any writes
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.status(200);
    res.flushHeaders();

    let totalUsage: UsageInfo = newUsageInfo();
    let finalContent = '';
    const blocks: Types.MessageBlock[] = [];
    const roundLogs: RoundLog[] = [];

    // Send the notes on each message back, so the frontend keeps them with the chat
    const notes = Object.fromEntries(Object.values(ctx.chat.history.messages)
        .filter(m => m.notes?.length)
        .map(m => [m.id, m.notes!]));
    emitSseEvent(res, ctx.chatId, { type: 'chat:notes', data: notes });

    // Per-request session for context budget tracking and tools turned off
    const modelInfo = await llama.getModelInfo(ctx.resolvedModel);
    const session = createToolSession(ctx.resolvedModel, modelInfo?.contextLength, ctx.disabledServers);

    try {
        let prevToolExec: ToolExecResult | undefined;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const roundStartMs = performance.now();

            const stream = (await llama.completions({
                body,
                signal: ctrl.signal,
                emit: {
                    onQueue: emitCallback(res, ctx.chatId, { type: 'model:queued' }),
                    onLoading: emitCallback(res, ctx.chatId, { type: 'model:loading' }),
                },
            })).stream;

            // Pipe llama -> done filter -> res (keep res open between rounds)
            stream.withDoneFilter().pipe(res, { end: false });

            // Wait until the model is done responding
            const result = await stream.finished();
            if (!result.ok) throw result.value;

            // Retroactively set duration on previous round's tool call blocks now that
            // we have the first output timestamp from this round's stream.
            if (prevToolExec) {
                const firstOutputMs = stream.firstOutputMs();
                if (firstOutputMs !== undefined) {
                    const durationSec = Math.round((firstOutputMs - prevToolExec.toolRoundStartMs) / 1000);
                    for (const block of blocks) {
                        if (block.type === 'tool_call' && block.duration === undefined) {
                            block.duration = durationSec;
                        }
                    }
                }

                prevToolExec = undefined;
            }

            totalUsage = accumulateUsage(totalUsage, result.value);

            // Update context budget from llama-server timings. Tools stay listed when it
            // runs out (removing them would break the prompt cache); calls get an error instead.
            const timings = result.value.timings;
            if (timings && session.contextLimit !== undefined) {
                const conversationTokens = timings.cache_n + timings.prompt_n + timings.predicted_n;
                session.contextBudget = Math.floor(session.contextLimit * CONTEXT_THRESHOLD_PCT) - conversationTokens;
            }

            // If model responds with tool calls, emit events and execute tools
            const toolCalls: proto.AssistantToolCall[] = result.value.choices.flatMap(c => c.message.tool_calls ?? []);
            const toolExec = await emitEventsAndExecuteTools(res, ctx.chatId, toolRegistry, toolCalls, ctrl.signal, session);

            finalContent = accumulateBlocks(blocks, result.value, toolExec?.results, stream.reasoningDurationMs());

            // Build round log
            const roundLog: RoundLog = {
                round,
                totalMs: performance.now() - roundStartMs,
                tokens: result.value.timings?.predicted_n ?? 0,
                reasoningMs: stream.reasoningDurationMs(),
                contentMs: stream.contentDurationMs(),
                ...(toolExec ? {
                    toolCalls: toolCalls.map(tc => tc.function.name),
                    toolsMs: toolExec.elapsedMs,
                } : {}),
            };
            roundLogs.push(roundLog);

            // If model did not produce tool calls, we're done
            if (!toolExec) break;
            prevToolExec = toolExec;

            // Append assistant + tool messages to history for next round
            const roundMessage = result.value.choices[0]?.message;
            const assistantTurn: proto.Message = {
                role: 'assistant',
                content: roundMessage?.content ?? '',
                reasoning_content: roundMessage?.reasoning_content || undefined,
                tool_calls: [...toolCalls],
            };
            const toolMessages: proto.Message[] = toolExec.results.map(r => ({
                role: 'tool' as const,
                tool_call_id: r.id,
                content: r.result.ok ? r.result.output : `Error: ${r.result.error}`,
            }));

            body = { ...body, messages: [...body.messages, assistantTurn, ...toolMessages] };

            // On the last allowed round, strip tools to force a final text response
            if (round === MAX_TOOL_ROUNDS - 1) {
                body = { ...body, tools: undefined };
            }
        }

        const finalUsage: SseUsage = getFinalUsage(totalUsage);

        // Dispatch tasks to request model once completion loop is finished
        const taskPromise = doTasks(llama, body.model, res, ctx, taskCtrl.signal);

        // Emit usage immediately so the frontend can show the usage icon without
        // waiting for tasks to complete.
        emitSseEvent(res, ctx.chatId, {
            type: 'chat:completion',
            data: { done: true, usage: finalUsage },
        });

        await persistChat(ctx, {
            content: finalContent,
            blocks,
            usage: finalUsage,
            done: true
        });

        // Title generation runs after persist - chat:title event is emitted inside doTasks()
        await taskPromise;

        res.end();
    } catch (err: any) {
        console.error(`[custom-completions] mid-stream error:`, err);
        const errMsg = err?.message ?? String(err);

        const errorUsage = getFinalUsage(totalUsage);
        emitSseEvent(res, ctx.chatId, {
            type: 'chat:completion',
            data: { done: true, usage: errorUsage, error: { content: errMsg } },
        });

        await persistChat(ctx, {
            content: finalContent,
            blocks,
            usage: errorUsage,
            done: false,
            error: { content: errMsg }
        });

        res.end();
    }

    logCompletion(ctx.resolvedModel, roundLogs);
});

/* -------------------- OAI COMPLETION -------------------- */

/**
 * POST /api/v1/chat/completions
 * Access Control: None (unauthenticated)
 *
 * OpenAI-compatible chat completions endpoint. Thin wrapper around llamaManager.completions()
 * that proxies requests and streams responses back to the caller without any DB persistence,
 * tool execution, or frontend-specific SSE events.
 */
router.post('/completions', async (
    req: Types.TypedRequest<{}, proto.CompletionRequest>,
    res: Response,
    next: NextFunction,
) => {
    const llama = req.app.locals.llama as Llama;

    const body: proto.CompletionRequest = req.body;
    if (!body.model || !body.messages) {
        return res.status(400).json({ detail: 'Missing required fields: model, messages' });
    }

    const ctrl = new AbortController();
    res.once('close', () => ctrl.abort());
    req.once('aborted', () => {
        console.log(chalk.dim.yellow(`[completions] client aborted request`));
        ctrl.abort();
    });

    let llamaResponse: LlamaResponse;
    try {
        llamaResponse = await llama.completions({ body, signal: ctrl.signal });
    } catch (err: any) {
        return res.status(500).json({ detail: err?.message ?? String(err) });
    }

    const { stream } = llamaResponse;

    if (body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.status(200);
        res.flushHeaders();
        stream.pipe(res);
        await stream.finished();
    } else {
        const result = await stream.finished();
        if (!result.ok) {
            return res.status(500).json({ detail: result.value.message });
        }

        const { timings: _timings, ...response } = result.value;
        return res.status(200).json(response);
    }
});

/* -------------------- TOKENIZE -------------------- */

const TokenizeFormSchema = z.object({
    content: z.string(),
    model: z.string(),
});

/**
 * POST /api/v1/chat/tokenize
 * Access Control: None (unauthenticated)
 *
 * Returns the token count of `content` under the named model. Routed through
 * `llama.tokenize`, which queues against the same model the completions
 * endpoint uses, so the count reflects the active model's tokenizer.
 */
router.post('/tokenize', async (
    req: Types.TypedRequest<{}, z.infer<typeof TokenizeFormSchema>>,
    res: Response<{ count: number } | Types.ErrorResponse>,
) => {
    const body = TokenizeFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    const llama = req.app.locals.llama as Llama;

    const ctrl = new AbortController();
    res.once('close', () => ctrl.abort());
    req.once('aborted', () => {
        console.log(chalk.dim.yellow(`[tokenize] client aborted request`));
        ctrl.abort();
    });

    try {
        const count = await llama.tokenize(body.data.content, body.data.model, ctrl.signal);
        return res.status(200).json({ count });
    } catch (err: any) {
        return res.status(500).json({ detail: err?.message ?? String(err) });
    }
});

export type PersistData = {
    content: string;
    blocks: Types.MessageBlock[];
    usage: SseUsage;
    done: boolean;
    error?: { content: string };
};

/**
 * Fills in the response message placeholder in ctx.chat.history and persists
 * the chat to the DB (create for new chats, update for existing).
 *
 * Skips for local: chats. DB errors are caught and logged so they never mask
 * stream errors.
 */
async function persistChat(ctx: ChatRequestContext, data: PersistData): Promise<void> {
    if (ctx.isLocalChat) return;

    // Fill in the response message placeholder that the frontend seeded in history
    const responseId = ctx.chat.history.currentId;
    if (responseId && ctx.chat.history.messages[responseId]) {
        const msg = ctx.chat.history.messages[responseId];
        msg.content = data.content;
        msg.done = data.done;
        msg.model = ctx.resolvedModel;
        msg.usage = data.usage;
        msg.blocks = data.blocks;
        if (data.error) msg.error = data.error;
    }

    // Exclude title from the update - it was set at creation time and may have been
    // updated by doTasks running concurrently. Overwriting it here would be a race.
    const { title: _title, ...chatFields } = ctx.chat;

    try {
        await Chats.updateChat(ctx.chatId, { chat: chatFields }, db);
    } catch (err) {
        console.error('[custom-completions] failed to persist chat:', err);
    }
}

export default router;
