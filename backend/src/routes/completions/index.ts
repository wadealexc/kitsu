import { Router, type Request, type Response, type NextFunction } from 'express';
import chalk from 'chalk';
import { z } from 'zod';

import type { Llama, LlamaResponse } from '../../llama/types.js';
import type LlamaStream from '../../llama/llamaStream.js';
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
import { toolRoundMessages } from './messages.js';
import { doTasks } from './tasks.js';
import { Chats, db } from '../../db/index.js';
import { GenerationJob, JobConflict, jobs } from './jobs.js';

const router = Router();

/* -------------------- CUSTOM COMPLETION -------------------- */

const MAX_TOOL_ROUNDS = 100;

// Context budget threshold: tool calls are refused once the conversation reaches this fraction of context
const CONTEXT_THRESHOLD_PCT = 0.9;

/** Starts an SSE response. */
function startSse(res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Stream through reverse proxies (nginx) instead of buffering
    res.setHeader('X-Accel-Buffering', 'no');
    res.status(200);
    res.flushHeaders();
}

/** Streams a job to this response: what it has sent so far, then the rest live. */
function follow(res: Response, job: GenerationJob): void {
    const unsubscribe = job.subscribe({
        write: (chunk) => { res.write(chunk); },
        end: () => { res.end(); },
    });
    // The client leaving doesn't stop the job; it just stops following
    res.once('close', unsubscribe);
}

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
 * The reply runs as a job tied to the chat (see jobs.ts): if this request's
 * connection drops, it carries on and is saved; GET .../:chatId/stream picks it
 * back up, and POST .../:chatId/stop stops it.
 *
 * This endpoint emits several non-OAI SSE events which are consumed by the frontend.
 */
router.post('/custom-completions', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
    res: Response<any | Types.ErrorResponse>,
) => {
    console.log(`custom-completions: received request`);

    const llama = req.app.locals.llama as Llama;
    const toolRegistry = req.app.locals.tools as ToolRegistry;

    let ctx: ChatRequestContext;
    try {
        // Validate request, resolve model, system prompt, params, and tools,
        // and construct OAI message format
        ctx = await prepareRequest(req, llama, toolRegistry);
    } catch (err: any) {
        return res.status(400).json({ detail: err?.message ?? String(err) });
    }

    let job: GenerationJob;
    try {
        job = jobs.start(ctx.chatId, ctx.userId, ctx.chat.history.currentId ?? null);
    } catch (err) {
        if (err instanceof JobConflict) return res.status(409).json({ detail: err.message });
        throw err;
    }

    startSse(res);
    follow(res, job);
    void runGeneration(job, ctx, llama, toolRegistry);
});

/**
 * GET /api/v1/chat/custom-completions/active
 * Access Control: Any authenticated user
 *
 * The user's chats with a reply being generated right now.
 */
router.get('/custom-completions/active', requireAuth, (req, res) => {
    res.json(jobs.running(req.user!.id));
});

/**
 * GET /api/v1/chat/custom-completions/:chatId/stream
 * Access Control: The chat's user
 *
 * Replays the reply being generated in this chat from the start, then follows
 * it live. 404 when nothing is running (or finished within the last minute).
 */
router.get('/custom-completions/:chatId/stream', requireAuth, (req: Request<{ chatId: string }>, res: Response) => {
    const job = jobs.get(req.params.chatId);
    if (!job || job.userId !== req.user!.id) {
        return res.status(404).json({ detail: 'No reply is being generated in this chat' });
    }
    startSse(res);
    follow(res, job);
});

/**
 * POST /api/v1/chat/custom-completions/:chatId/stop
 * Access Control: The chat's user
 *
 * Stops the reply being generated in this chat; what it wrote so far is kept.
 */
router.post('/custom-completions/:chatId/stop', requireAuth, (req: Request<{ chatId: string }>, res: Response) => {
    const job = jobs.get(req.params.chatId);
    if (!job || job.userId !== req.user!.id || job.status !== 'running') {
        return res.status(404).json({ detail: 'No reply is being generated in this chat' });
    }
    job.stop();
    return res.json({ stopped: true });
});

/** The tool-call loop for one reply, streaming into its job and saving the chat. */
async function runGeneration(
    job: GenerationJob,
    ctx: ChatRequestContext,
    llama: Llama,
    toolRegistry: ToolRegistry,
): Promise<void> {
    let body: proto.CompletionRequest = ctx.completionBody;
    const signal = job.signal;

    // Title generation runs after the reply; it stops if the job is stopped
    const taskCtrl = new AbortController();
    signal.addEventListener('abort', () => taskCtrl.abort(), { once: true });

    let totalUsage: UsageInfo = newUsageInfo();
    let finalContent = '';
    const blocks: Types.MessageBlock[] = [];
    const roundLogs: RoundLog[] = [];

    // Send the notes on each message back, so the frontend keeps them with the chat
    const notes = Object.fromEntries(Object.values(ctx.chat.history.messages)
        .filter(m => m.notes?.length)
        .map(m => [m.id, m.notes!]));
    emitSseEvent(job, ctx.chatId, { type: 'chat:notes', data: notes });

    // Per-request session for context budget tracking and tools turned off
    const modelInfo = await llama.getModelInfo(ctx.resolvedModel);
    const session = createToolSession(ctx.resolvedModel, modelInfo?.contextLength, ctx.disabledServers, { chat: ctx.chatId, user: ctx.userId });

    // Save the chat as it is now (the new message or branch, with the reply
    // unfinished), so reopening it mid-reply finds the reply and follows it
    await persistChat(ctx, { content: '', blocks: [], usage: getFinalUsage(totalUsage), done: false });

    // The round being streamed, so a stop can keep what it had written
    let currentStream: LlamaStream | undefined;

    try {
        let prevToolExec: ToolExecResult | undefined;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const roundStartMs = performance.now();

            // Stopped during the tools. Asking the model with a cancelled signal isn't
            // just pointless: node-fetch throws an error nothing can catch.
            signal.throwIfAborted();

            let stream: LlamaStream;
            let result: Awaited<ReturnType<LlamaStream['finished']>>;
            try {
                stream = (await llama.completions({
                    body,
                    signal,
                    emit: {
                        onQueue: emitCallback(job, ctx.chatId, { type: 'model:queued' }),
                        onLoading: emitCallback(job, ctx.chatId, { type: 'model:loading' }),
                    },
                })).stream;
                currentStream = stream;

                // Pipe llama -> done filter -> job (kept open between rounds)
                stream.withDoneFilter().pipe(job.writable(), { end: false });

                // Wait until the model is done responding
                result = await stream.finished();
                if (!result.ok) throw result.value;
            } catch (err) {
                // kitsu can't tell which models take images, so a request with one may be
                // refused. Leave them out, or every later message in this chat fails too.
                if (signal.aborted || !omitImages(blocks)) throw err;
                body = { ...body, messages: [...ctx.completionBody.messages, ...toolRoundMessages(blocks).messages] };
                round--;
                continue;
            }

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
            const toolExec = await emitEventsAndExecuteTools(job, ctx.chatId, toolRegistry, toolCalls, signal, session, round);

            finalContent = accumulateBlocks(blocks, result.value, toolExec?.results, stream.reasoningDurationMs(), toolExec ? { round, startedAt: toolExec.startedAt } : undefined);
            // Its blocks are saved now, so a stop mustn't add this round's partial text again.
            currentStream = undefined;

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

            // Save progress so far: if the backend goes away mid-reply, this much is kept
            await persistChat(ctx, { content: finalContent, blocks, usage: getFinalUsage(totalUsage), done: false });

            // The next round sees this reply's rounds exactly as later requests will
            body = { ...body, messages: [...ctx.completionBody.messages, ...toolRoundMessages(blocks).messages] };

            // On the last allowed round, strip tools to force a final text response
            if (round === MAX_TOOL_ROUNDS - 1) {
                body = { ...body, tools: undefined };
            }
        }

        const finalUsage: SseUsage = getFinalUsage(totalUsage);

        // Dispatch tasks to request model once completion loop is finished
        const taskPromise = doTasks(llama, body.model, job, ctx, taskCtrl.signal);

        // Emit usage immediately so the frontend can show the usage icon without
        // waiting for tasks to complete.
        emitSseEvent(job, ctx.chatId, {
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
        job.finish('done');
    } catch (err: any) {
        const usage = getFinalUsage(totalUsage);

        if (job.status === 'stopped') {
            // Stopped by the user: keep what was written, without an error
            console.log(chalk.dim.yellow(`[custom-completions] stopped by the user (${ctx.chatId})`));
            emitSseEvent(job, ctx.chatId, { type: 'chat:completion', data: { done: true, usage } });
            // Keep what the round in progress had written before the stop
            const partial = currentStream?.partial();
            if (partial) finalContent = accumulateBlocks(blocks, partial, undefined, currentStream?.reasoningDurationMs());
            await persistChat(ctx, { content: finalContent, blocks, usage, done: true });
            job.finish('stopped');
        } else {
            console.error(`[custom-completions] mid-stream error:`, err);
            const errMsg = err?.message ?? String(err);
            emitSseEvent(job, ctx.chatId, {
                type: 'chat:completion',
                data: { done: true, usage, error: { content: errMsg } },
            });
            await persistChat(ctx, { content: finalContent, blocks, usage, done: false, error: { content: errMsg } });
            job.finish('error');
        }
    }

    logCompletion(ctx.resolvedModel, roundLogs);
}

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
        res.setHeader('X-Accel-Buffering', 'no');
    // Stream through reverse proxies (nginx) instead of buffering
    res.setHeader('X-Accel-Buffering', 'no');
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

/** Takes tool images out of a reply, telling the model. False if there were none. */
function omitImages(blocks: Types.MessageBlock[]): boolean {
    let found = false;
    for (const block of blocks) {
        if (block.type !== 'tool_call' || !block.images?.length) continue;
        delete block.images;
        block.result = `${block.result ?? ''}\n[Current model does not support images. The image was omitted.]`;
        found = true;
    }
    return found;
}

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
