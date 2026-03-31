import { Router, type Request, type Response, type NextFunction } from 'express';
import chalk from 'chalk';

import { LlamaManager } from '../llama/llamaManager.js';
import * as Types from './types.js';
import { requireAuth } from './middleware.js';
import * as proto from '../protocol.js';
import { db } from '../db/client.js';
import * as Chats from '../db/operations/chats.js';
import * as Models from '../db/operations/models.js';
import * as Files from '../db/operations/files.js';
import { StorageProvider } from '../storage/provider.js';
import { ToolRegistry, type ToolRoundResult } from '../tools/registry.js';
import type { SseEvent, SseEventPayload, SseUsage } from './sseEvents.js';
import type { ToolProgress } from '../tools/types.js';

const router = Router();

/* -------------------- CUSTOM COMPLETION -------------------- */

const MAX_TOOL_ROUNDS = 10;

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
 * SSE events emitted in addition to normal token stream:
 *   - tool_call:start  — when the model requests a tool
 *   - tool_call:result — after the tool executes
 *   - chat:completion  — final usage/done signal
 */
router.post('/custom-completions', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
    res: Response<any | Types.ErrorResponse>,
    next: NextFunction,
) => {
    // console.log(`[custom-completions] body: \n\n${JSON.stringify(req.body, null, 2)}\n\n`);

    const llama = req.app.locals.llama as LlamaManager;
    const ctx = await preprocessChatRequest(req, llama);
    if (!ctx.ok) {
        return res
            .status(ctx.value.status)
            .json({ detail: ctx.value.detail, errors: ctx.value.errors });
    }

    const { chatId, generateTitle, webSearchEnabled } = ctx.value;
    const toolRegistry = req.app.locals.tools as ToolRegistry;

    // AbortController will cancel request if the client aborts
    const ctrl = new AbortController();
    const taskCtrl = new AbortController();

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

    // Inject tools and run beforeRequest hooks
    let body: proto.CompletionRequest = {
        ...ctx.value.completionBody,
        tools: toolRegistry.getToolDefinitions(),
    };
    body = await toolRegistry.beforeRequest(body, { webSearchEnabled });

    // Commit SSE headers before any writes
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.status(200);
    res.flushHeaders();

    let totalUsage: UsageInfo = _newUsageInfo();
    let finalContent = '';
    const blocks: Types.MessageBlock[] = [];
    const roundLogs: RoundLog[] = [];

    try {
        let prevToolExec: ToolExecResult | undefined;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const roundStartMs = performance.now();

            const stream = (await llama.completions({ 
                body, 
                signal: ctrl.signal,
                emit: {
                    onQueue: _emitCallback(res, chatId, { type: 'model:queued' }),
                    onLoading: _emitCallback(res, chatId, { type: 'model:loading' }),
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

            totalUsage = _accumulateUsage(totalUsage, result.value);

            // If model responds with tool calls, emit events and execute tools
            const toolCalls: proto.AssistantToolCall[] = result.value.choices.flatMap(c => c.message.tool_calls ?? []);
            const toolExec = await _emitEventsAndExecuteTools(res, ctx.value, toolRegistry, toolCalls, ctrl.signal);

            finalContent = _accumulateBlocks(blocks, result.value, toolExec?.results, stream.reasoningDurationMs());

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

        const finalUsage: SseUsage = _getFinalUsage(totalUsage);

        // Dispatch tasks to request model once completion loop is finished
        const taskModel = body.model;
        const taskPromise = generateTitle
            ? doTasks(llama, taskModel, res, ctx.value, taskCtrl.signal)
            : Promise.resolve();

        res.write('data: [DONE]\n\n');

        // Emit usage immediately so the frontend can show the usage icon without
        // waiting for title generation (taskPromise) to complete.
        _emitSseEvent(res, chatId, {
            type: 'chat:completion',
            data: { done: true, usage: finalUsage },
        });

        await _persistChat(ctx.value, {
            content: finalContent,
            blocks,
            usage: finalUsage,
            done: true
        });

        // Title generation runs after persist — chat:title event is emitted inside doTasks()
        await taskPromise;

        res.end();
    } catch (err: any) {
        console.error(`[custom-completions] mid-stream error:`, err);
        const errMsg = err?.message ?? String(err);

        _emitSseEvent(res, chatId, {
            type: 'chat:message:error',
            data: { error: { content: errMsg } },
        });

        await _persistChat(ctx.value, {
            content: finalContent,
            blocks,
            usage: totalUsage,
            done: false,
            error: { content: errMsg }
        });

        res.end();
    }

    _logCompletion(ctx.value.resolvedModel, roundLogs);
});

/* -------------------- TASKS -------------------- */

const SYSTEM_PROMPT_TITLEGEN = `You are a helpful assistant.

Your primary role is to come up with a short, memorable phrase to serve as the "title" of a chat initiated by the user.

You should adhere to the following guidelines:
- Respond to the user's message with a phrase that summarizes the user's message
- Your response should contain 5 or fewer words
- Your response should never attempt to answer the user's question, or respond to the user's message directly

Create a chat title that summarizes the following user message:
`;

async function doTasks(
    llama: LlamaManager,
    taskModel: string,
    res: Response,
    ctx: ChatRequestContext,
    signal: AbortSignal
): Promise<void> {

    const log = (str: string) => {
        console.log(chalk.dim.yellow(`[custom-completions::doTasks]: ${str}`));
    };

    // 1. Title generation
    log(`starting title generation request`);

    const emitTitle = (title: string) => {
        _emitSseEvent(res, ctx.chatId, {
            type: 'chat:title',
            data: title,
        });
    }

    const startTime = performance.now();
    let title: string = _fallbackTitle(ctx);
    try {
        if (ctx.isLocalChat) {
            log(`local chat - skipping title generation`);
            return;
        }

        // TODO - this breaks if firstUserMessage has image content and 
        // task model does not have mmproj. Should probably do text-only
        // for speed, anyway.
        const taskResponse = await llama.completions({
            body: {
                stream: false,
                model: taskModel,
                messages: [
                    {
                        role: 'system',
                        content: SYSTEM_PROMPT_TITLEGEN,
                    },
                    ctx.firstUserMessage,
                ],
                // So, this is kind of a janky hack specific to Qwen3.5
                // It turns out, qwen3.5 generates a TON of reasoning tokens when
                // it doesn't have any tools available. When it has even one tool
                // definition available, it's far more efficient.
                //
                // I'm adding a nonsense tool definition here for this reason.
                // If the model (for whatever reason) ends up calling the tool,
                // the fallbacks below will handle it.
                tools: [{
                    type: 'function',
                    function: {
                        name: 'invalid_tool',
                        description: 'do not call this tool',
                    }
                }]
            },
            signal: signal
        });

        const result = await taskResponse.stream.finished();

        if (!result.ok) {
            log(`title generation received failing response: ${result.value}`);
        } else {
            const taskResult = result.value.choices.at(0)?.message;
            if (!taskResult) {
                log(`malformed response from model`);
            } else {
                // Fall back to reasoning_content if content is empty — some chat
                // templates put the entire response inside <think> tags, leaving
                // content empty. (Qwen3-4b-Instruct-2507).
                //
                // Why? This is supposed to be a non-thinking model!
                // 
                // ... I have no idea. It's also fixed by adding a param to 
                // disable thinking in config.json:
                // 
                // "chat_template_kwargs": { "enable_thinking": false }
                title = taskResult.content || taskResult.reasoning_content || title;
            }
        }  
    } catch (err) {
        title = _fallbackTitle(ctx);
        log(`title generation failed; using fallback: ${err}`);
    } finally {
        const endTime = performance.now();
        const seconds = (endTime - startTime) / 1000;
        log(`(title generation) time elapsed: ${seconds.toFixed(2)} sec`);
        
        // TODO - it's a bit messy.
        emitTitle(title);
        try { await Chats.updateChat(ctx.chatId, { chat: { title } }) } catch { }
    }
}

/* -------------------- CHAT PRE-PROCESSING -------------------- */

type ChatRequestContext = {
    userId: string;
    chatId: string;
    chat: Types.ChatObject;
    folderId: string | null | undefined;
    userMessage: Types.ChatMessage;
    firstUserMessage: proto.UserMessage;
    resolvedModel: string;
    completionBody: proto.CompletionRequest;
    webSearchEnabled: boolean;
    generateTitle: boolean;
    isLocalChat: boolean;
};

type PreprocessError = {
    status: number;
    detail: string;
    errors?: any[];
};

/**
 * Validates, resolves model access, injects system prompt, resolves file images,
 * verifies chat ownership, associates uploaded files, and builds a clean OAI
 * completion body. Returns a typed context or error.
 */
async function preprocessChatRequest(
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
    llama: LlamaManager,
): Promise<proto.Result<ChatRequestContext, PreprocessError>> {
    const parsed = Types.ChatCompletionFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return {
            ok: false, value: {
                status: 400, detail: 'Invalid request body', errors: parsed.error.issues
            }
        };
    }

    const userId = req.user!.id;
    const {
        chatId,
        chat,
        folderId,
        userMessage,
        params,
        webSearchEnabled,
        generateTitle,
        systemPrompt
    } = parsed.data;

    const isLocalChat = chatId.startsWith('local:');

    // Resolve custom model -> base model
    let resolvedModel: string = parsed.data.model;
    const customModel = await Models.getModelById(resolvedModel, db);
    if (customModel) {
        if (!Models.hasAccess(customModel, userId, 'read')) {
            return {
                ok: false, value: {
                    status: 403, detail: 'No access to this model'
                }
            };
        }

        resolvedModel = customModel.baseModelId;
    }

    // Ensure base model exists
    if (!llama.getModelInfo(resolvedModel)) {
        return {
            ok: false, value: {
                status: 404, detail: `Model not found: ${resolvedModel}`
            }
        };
    }

    let messages = parsed.data.messages as proto.Message[];
    // Inject system prompt from frontend, if needed
    if (messages[0]?.role !== 'system') {
        if (systemPrompt) {
            console.warn('[chat] Appending system prompt to messages.');
            messages.unshift({ role: 'system', content: systemPrompt });
        } else {
            console.warn('[chat] No system prompt provided by frontend');
            messages.unshift({ role: 'system', content: '' });
        }

        if (messages[0]?.content === '') {
            console.warn('[chat] System prompt is empty!');
        }
    }

    // At this point, we should have a user message at [1] no matter what
    const firstUserMessage = messages[1];
    if (!firstUserMessage || firstUserMessage.role !== 'user') {
        console.error(`Expected user message at messages[1]`);
        return {
            ok: false, value: {
                status: 400, detail: 'Malformed request; no user message found'
            }
        };
    }

    // Resolve file ID images before sending to llama
    await resolveFileIdImages(messages);

    // For non-local chats: create chat if exists, and insert file associations
    if (!isLocalChat) {
        const existingChat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!existingChat) {
            await Chats.createChat(userId, {
                id: chatId,
                title: chat.title,
                chat: chat,
                folderId: folderId ?? null,
            }, db);
        }

        if (userMessage.files.length > 0) {
            const fileIds = userMessage.files
                .filter((f: any) => f.type === 'file')
                .map((f: any) => f.id)
                .filter(Boolean);

            if (fileIds.length > 0) {
                try {
                    await Chats.insertChatFiles(chatId, userMessage.id, fileIds, userId, db);
                } catch (error) {
                    console.error('Error inserting chat files:', error);
                    // Don't fail — file associations are metadata, not critical
                }
            }
        }
    }

    // Extract inference params, dropping non-OAI/non-forwarded fields
    // TODO - remove unused fields
    const {
        system: _system,
        stream_response: _sr,
        reasoning_effort: _re,
        chat_template_kwargs: _ctk,
        ...inferenceParams
    } = params;

    // Build clean OAI body — only known fields, no custom extensions leak to llama
    const completionBody: proto.CompletionRequest = {
        model: resolvedModel,
        messages,
        stream: parsed.data.stream,
        ...inferenceParams,
    };

    return {
        ok: true,
        value: {
            userId,
            chatId,
            chat,
            folderId,
            userMessage,
            firstUserMessage,
            resolvedModel,
            completionBody,
            webSearchEnabled,
            generateTitle,
            isLocalChat,
        }
    };
}

/**
 * Walks messages and resolves any `image_url` content parts whose URL is a bare
 * file UUID (not a data: or http(s): URL) into base64 data URLs.
 *
 * The frontend uploads images and stores the returned file ID as `image_url.url`.
 * llama-server only accepts `data:` or `http(s)://` URLs, so we must resolve
 * the ID → file record → filesystem bytes → base64 before forwarding.
 *
 * Mutates the messages array in-place. Parts that cannot be resolved are
 * replaced with a text marker so the request still succeeds.
 */
async function resolveFileIdImages(messages: proto.Message[]): Promise<void> {
    for (const message of messages) {
        if (typeof message.content === 'string') continue;

        const parts = message.content as proto.ContentPart[];
        for (let i = 0; i < parts.length; i++) {
            const part: proto.ContentPart | undefined = parts[i];
            if (!part || part.type !== 'image_url') continue;

            const imagePart: proto.ImageContentPart = part;
            const url = imagePart.image_url.url;
            if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) {
                continue; // already a valid URL
            }

            // Treat as file ID
            const file = await Files.getFileById(url, db);
            if (!file || !file.path) {
                console.warn(`[resolveFileIdImages] file not found for id: ${url}`);
                parts[i] = { type: 'text', text: '[image unavailable]' };
                continue;
            }

            const buffer = await StorageProvider.downloadFile(file.path);
            const contentType = file.meta?.contentType ?? 'image/png';
            const base64 = buffer.toString('base64');
            parts[i] = {
                type: 'image_url',
                image_url: { url: `data:${contentType};base64,${base64}` },
            };
        }
    }
}

/* -------------------- PERSISTENCE -------------------- */

type PersistData = {
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
 * Skips for local: chats and requests that didn't include a chat object.
 * DB errors are caught and logged so they never mask stream errors.
 */
async function _persistChat(ctx: ChatRequestContext, data: PersistData): Promise<void> {
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

    // Exclude title from the update — it was set at creation time and may have been
    // updated by doTasks running concurrently. Overwriting it here would be a race.
    const { title: _title, ...chatFields } = ctx.chat;

    try {
        await Chats.updateChat(ctx.chatId, { chat: chatFields }, db);
    } catch (err) {
        console.error('[custom-completions] failed to persist chat:', err);
    }
}

/* -------------------- EVENTS -------------------- */

/**
 * Writes a typed `event: chat-event` SSE frame to the response.
 */
function _emitSseEvent(
    res: Response,
    chatId: string,
    payload: SseEventPayload,
): void {
    const frame: SseEvent = {
        chat_id: chatId ?? '',
        data: payload,
    };
    res.write(`event: chat-event\ndata: ${JSON.stringify(frame)}\n\n`);
}

/**
 * Returns a callback function that will emit the provided SSE event when called
 */
function _emitCallback(
    res: Response,
    chatId: string,
    payload: SseEventPayload,
): (() => void) {
    return () => { 
        console.log(`emit: ${payload.type}`);
        _emitSseEvent(res, chatId, payload);
    };
}

type ToolExecResult = {
    results: ToolRoundResult[];
    elapsedMs: number;
    toolRoundStartMs: number;
};

async function _emitEventsAndExecuteTools(
    res: Response,
    ctx: ChatRequestContext,
    toolRegistry: ToolRegistry,
    toolCalls: proto.AssistantToolCall[],
    signal: AbortSignal,
): Promise<ToolExecResult | undefined> {
    if (toolCalls.length === 0) return;

    // Emit SSE events for each tool call
    for (const tc of toolCalls) {
        _emitSseEvent(res, ctx.chatId, {
            type: 'tool_call:start',
            data: { id: tc.id, name: tc.function.name, arguments: tc.function.arguments },
        });
    }

    // Execute tool calls, forwarding progress events as SSE frames
    const toolRoundStartMs = performance.now();
    const onProgress = (toolCallId: string, event: ToolProgress) => {
        const tc = toolCalls.find(t => t.id === toolCallId);
        _emitSseEvent(res, ctx.chatId, {
            type: 'tool_call:progress',
            data: {
                id: toolCallId,
                name: tc?.function.name ?? '',
                progress: event,
            },
        });
    };
    const roundResults = await toolRegistry.executeToolRound(toolCalls, signal, onProgress);
    const elapsedMs = performance.now() - toolRoundStartMs;

    // Emit SSE events for each result
    for (const r of roundResults) {
        _emitSseEvent(res, ctx.chatId, {
            type: 'tool_call:result',
            data: {
                id: r.id,
                name: r.name,
                arguments: r.arguments,
                result: r.result.ok ? r.result.output : `Error: ${r.result.error}`
            },
        });
    }

    return { results: roundResults, elapsedMs, toolRoundStartMs };
}

/* -------------------- HELPERS -------------------- */

/**
 * Updates the blocks array for one completion round.
 * 
 * Non-tool call rounds: Adds reasoning block and content block. Returns final text content
 * 
 * Tool rounds: Add reasoning block and tool call blocks
 *
 * Final round (no tool calls): adds reasoning block (if present) and content block.
 * Returns the final text content.
 *
 * Tool round: adds reasoning block (if present), tool_call blocks, and fills in
 * results after execution. Returns an empty string.
 */
function _accumulateBlocks(
    blocks: Types.MessageBlock[],
    response: proto.CompletionResponse,
    toolResults?: ToolRoundResult[],
    reasoningDurationMs?: number,
): string {
    const message = response.choices[0]?.message;

    if (message?.reasoning_content) {
        const duration = reasoningDurationMs !== undefined ? Math.round(reasoningDurationMs / 1000) : undefined;
        blocks.push({ type: 'reasoning', content: message.reasoning_content, done: true, duration });
    }

    if (!toolResults) {
        return message?.content ?? '';
    }

    for (let i = 0; i < toolResults.length; i++) {
        const r = toolResults.at(i)!;

        blocks.push({
            type: 'tool_call',
            id: r.id,
            name: r.name,
            arguments: r.arguments,
            done: true,
            result: r.result.ok ? r.result.output : `Error: ${r.result.error}`,
        });
    }

    // Return 'final content' (empty string because we ended on a tool call)
    return '';
}

type RoundLog = {
    round: number;
    totalMs: number;
    tokens: number;
    reasoningMs?: number;
    contentMs?: number;
    toolCalls?: string[];
    toolsMs?: number;
};

function _logCompletion(model: string, roundLogs: RoundLog[]): void {
    const lines: string[] = [];
    for (const r of roundLogs) {
        lines.push(`[custom-completions::${r.round}] (${model}) (total: ${(r.totalMs / 1000).toFixed(2)}s) [${r.tokens} tokens]`);
        if (r.reasoningMs !== undefined) {
            lines.push(` - reasoning: ${(r.reasoningMs / 1000).toFixed(2)}s`);
        }
        if (r.toolCalls && r.toolCalls.length > 0) {
            for (const name of r.toolCalls) lines.push(` - called tool: ${name}`);
            lines.push(` - tools finished: ${((r.toolsMs ?? 0) / 1000).toFixed(2)}s`);
        }
        if (r.contentMs !== undefined) {
            lines.push(` - content: ${(r.contentMs / 1000).toFixed(2)}s`);
        }
    }
    console.log(lines.join('\n'));
}

type UsageInfo = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;

    totalPredictedMs: number;
    totalPromptMs: number;
};

function _newUsageInfo(): UsageInfo {
    return {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,

        totalPredictedMs: 0,
        totalPromptMs: 0,
    }
}

/**
 * Merges timings/usage from a single CompletionResponse into running totals.
 */
function _accumulateUsage(info: UsageInfo, response: proto.CompletionResponse): UsageInfo {
    const tokensOut = response.timings?.predicted_n ?? response.usage?.completion_tokens ?? 0;
    const cacheIn = response.timings?.cache_n ?? 0;
    const promptIn = response.timings?.prompt_n ?? response.usage?.prompt_tokens ?? 0;
    const tokensIn = cacheIn + promptIn;

    const totalPredictedMs = info.totalPredictedMs + (response.timings?.predicted_ms ?? 0);
    const totalPromptMs = info.totalPromptMs + (response.timings?.prompt_ms ?? 0);

    return {
        prompt_tokens: info.prompt_tokens + tokensIn,
        completion_tokens: info.completion_tokens + tokensOut,
        total_tokens: info.total_tokens + tokensIn + tokensOut,

        totalPredictedMs,
        totalPromptMs,
    };
}

function _getFinalUsage(info: UsageInfo): SseUsage {
    const completionTps = info.totalPredictedMs > 0
        ? (info.completion_tokens / info.totalPredictedMs) * 1000
        : undefined;
    const promptTps = info.totalPromptMs > 0
        ? (info.prompt_tokens / info.totalPromptMs) * 1000
        : undefined;

    return {
        prompt_tokens: info.prompt_tokens,
        completion_tokens: info.completion_tokens,
        total_tokens: info.total_tokens,
        completion_tokens_per_second: completionTps,
        prompt_tokens_per_second: promptTps,
    }
}

/**
 * Generate a title for a chat if no task model is available
 */
function _fallbackTitle(ctx: ChatRequestContext): string {
    // Fallback: send "first 3 words" of user message
    let message = ctx.firstUserMessage.content;
    let title: string | undefined;
    if (Array.isArray(message)) {
        title = message.find((msg) => msg.type === 'text')?.text;
        if (!title) title = 'New Chat';
    } else {
        title = message;
    }

    return _normalizeTitle(title);
}

/**
 * Split string by spaces, trim to max 5 words and capitalize first
 * letter of each word, then join with space again
 */
function _normalizeTitle(title: string): string {
    return title
        .trim()
        .split(/\s+/)
        .slice(0, 5)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}

export default router;