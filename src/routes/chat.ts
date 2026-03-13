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
import { ToolRegistry } from '../tools/registry.js';
import type { SseEvent, SseEventPayload, SseUsage } from './sseEvents.js';

const router = Router();

/* -------------------- SHARED PRE-PROCESSING -------------------- */

type ChatRequestContext = {
    userId: string;
    chatId: string;
    messageId: string;
    parentMessage: any;
    firstUserMessage: proto.BasicMessage;
    resolvedModel: string;
    messages: proto.Message[];
    completionBody: Types.ChatCompletionForm & Record<string, any>;
};

type PreprocessError = {
    status: number;
    detail: string;
    errors?: any[];
};

/**
 * Validates, resolves model access, injects system prompt, verifies chat
 * ownership, and associates uploaded files. Returns a typed context or error.
 */
async function preprocessChatRequest(
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
): Promise<proto.Result<ChatRequestContext, PreprocessError>> {
    const parsed = Types.ChatCompletionFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return { ok: false, value: { status: 400, detail: 'Invalid request body', errors: parsed.error.issues } };
    }

    const userId = req.user!.id;
    const { chat_id: chatId, id: messageId, parent_message: parentMessage } = parsed.data;

    // Resolve custom model -> base model
    let resolvedModel: string = parsed.data.model;
    const customModel = await Models.getModelById(resolvedModel, db);
    if (customModel) {
        if (!Models.hasAccess(customModel, userId, 'read')) {
            return { ok: false, value: { status: 403, detail: 'No access to this model' } };
        }
        resolvedModel = customModel.baseModelId;
    }

    // Oh god it's horrible
    let systemPrompt = (parsed.data.model_item?.params as any)?.system as string;
    let messages = parsed.data.messages as proto.Message[];
    // Add system prompt if needed
    if (systemPrompt && messages[0]?.role !== 'system') {
        messages.unshift({ role: 'system', content: systemPrompt });
    }

    // At this point, we should have a user message at [1] no matter what
    const firstUserMessage = messages[1];
    if (!firstUserMessage || firstUserMessage.role !== 'user') {
        console.error(`Expected user message at messages[1]`);
        throw new Error(`no user message found`);
    }

    const completionBody = { ...parsed.data, model: resolvedModel, messages };

    // Verify user owns the referenced chat (unless 'local', which is not persisted)
    if (!chatId.startsWith('local:')) {
        const chat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!chat) {
            return { ok: false, value: { status: 404, detail: 'Chat not found' } };
        }
    }

    // Insert chat files from parent message (if provided)
    if (parentMessage?.files && !chatId.startsWith('local:')) {
        const fileIds = parentMessage.files
            .filter((f: any) => f.type === 'file')
            .map((f: any) => f.id)
            .filter(Boolean);

        if (fileIds.length > 0) {
            try {
                await Chats.insertChatFiles(chatId, parentMessage.id, fileIds, userId, db);
            } catch (error) {
                console.error('Error inserting chat files:', error);
                // Don't fail request — file associations are metadata, not critical
            }
        }
    }

    return {
        ok: true,
        value: {
            userId,
            chatId,
            messageId,
            parentMessage,
            firstUserMessage,
            resolvedModel,
            messages,
            completionBody
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

/* -------------------- CHAT COMPLETION -------------------- */

/**
 * POST /api/v1/chat/completions
 * Access Control: Any authenticated user
 *
 * Main chat completion API — send messages to AI and get responses.
 * OpenAI-compatible endpoint with OpenWebUI extensions.
 *
 * @body {Types.ChatCompletionForm} - OpenAI-compatible request with extensions
 * @returns {object} - OpenAI-compatible response (streaming or static)
 */
router.post('/completions', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
    res: Response<any | Types.ErrorResponse>,
    next: NextFunction,
) => {
    console.log(`body: \n\n${JSON.stringify(req.body, null, 2)}\n\n`);

    const ctx = await preprocessChatRequest(req);
    if (!ctx.ok) {
        return res
            .status(ctx.value.status)
            .json({ detail: ctx.value.detail, errors: ctx.value.errors });
    }

    const { chatId, messageId, completionBody: body } = ctx.value;
    const llama = req.app.locals.llama as LlamaManager;

    await resolveFileIdImages(body.messages as proto.Message[]);

    // AbortController will cancel request if the client aborts
    const ctrl = new AbortController();
    res.once('close', () => ctrl.abort());
    req.once('aborted', () => {
        console.log(chalk.dim.yellow(`client aborted request`));
        ctrl.abort();
    });

    try {
        // Send completion request
        const response = await llama.completions({ body, signal: ctrl.signal });
        const stream = response.stream;

        // Once we have data back from llama-server, set headers/status
        // and begin streaming to the client
        stream.once('readable', () => {
            response.headers.forEach((v, k) => res.setHeader(k, v));
            res.status(response.status);

            stream.pipe(res, { end: false });
        });

        // This listener is triggered when llama-server is done streaming, or when the
        // stream is cancelled prematurely due to client disconnects/llama-server errors
        stream.once('stop', async (result: proto.Result<proto.CompletionResponse, Error>) => {
            console.log(`stream stopped. result: ${result.ok}`);

            // On success, inject a chat-event frame then end the response
            if (result.ok) {
                const tokensOut = result.value.timings?.predicted_n ?? 0;
                const cacheIn = result.value.timings?.cache_n ?? 0;
                const promptIn = result.value.timings?.prompt_n ?? 0;
                const tokensIn = cacheIn + promptIn;
                const predictedMs = result.value.timings?.predicted_ms ?? 0;
                const promptMs = result.value.timings?.prompt_ms ?? 0;
                const completionTps = predictedMs > 0 ? (tokensOut / predictedMs) * 1000 : undefined;
                const promptTps = promptMs > 0 ? (promptIn / promptMs) * 1000 : undefined;

                console.log(` - result: ${JSON.stringify(result.value, null, 2)}`);

                emitSseEvent(res, chatId, messageId, {
                    type: 'chat:completion',
                    data: {
                        done: true,
                        usage: {
                            prompt_tokens: tokensIn,
                            completion_tokens: tokensOut,
                            total_tokens: tokensIn + tokensOut,
                            ...(completionTps !== undefined ? { completion_tokens_per_second: completionTps } : {}),
                            ...(promptTps !== undefined ? { prompt_tokens_per_second: promptTps } : {}),
                        },
                    },
                });
                res.end();
            } else {
                console.log(` - error: ${JSON.stringify(result.value, null, 2)}`);
                next(result.value);
            }
        });
    } catch (err: any) {
        return next(err);
    }
});

/* -------------------- CUSTOM COMPLETION (TOOL LOOP) -------------------- */

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

    const ctx = await preprocessChatRequest(req);
    if (!ctx.ok) {
        return res
            .status(ctx.value.status)
            .json({ detail: ctx.value.detail, errors: ctx.value.errors });
    }

    const { chatId, messageId, completionBody: rawBody } = ctx.value;
    const llama = req.app.locals.llama as LlamaManager;
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

    await resolveFileIdImages(rawBody.messages as proto.Message[]);

    // Inject tool definitions and run beforeRequest hooks once before the loop
    let body: Types.ChatCompletionForm & Record<string, any> = {
        ...rawBody,
        tools: toolRegistry.getToolDefinitions(),
    };
    body = await toolRegistry.beforeRequest(body) as typeof body;

    // Commit SSE headers before any writes (doTasks may write before the main loop's
    // first response arrives, which would implicitly commit default headers)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.status(200);
    res.flushHeaders();

    // Dispatch task model, if configured
    const taskModel = llama.getTaskModel();
    const taskPromise = (taskModel && rawBody.generateTitle)
        ? doTasks(llama, taskModel, res, ctx.value, taskCtrl.signal)
        : Promise.resolve();

    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let totalPredictedMs = 0;
    let totalPromptMs = 0;

    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            console.log(`[custom-completions] round ${round}`);

            const response = await llama.completions({ body, signal: ctrl.signal });
            const stream = response.stream;

            // Pipe llama -> done filter -> res (keep res open between rounds)
            stream.withDoneFilter().pipe(res, { end: false });

            // Wait until the model is done responding
            const result = await stream.finished();
            if (!result.ok) {
                console.error(`[custom-completions] round ${round} error:`, result.value);
                emitSseEvent(res, chatId, messageId, {
                    type: 'chat:message:error',
                    data: { error: { content: result.value.message ?? String(result.value) } },
                });
                res.end();
                return;
            }

            totalUsage = accumulateUsage(totalUsage, result.value);
            totalPredictedMs += result.value.timings?.predicted_ms ?? 0;
            totalPromptMs += result.value.timings?.prompt_ms ?? 0;
            // Model gave a final text response - no more looping required
            if (!hasToolCalls(result.value)) break;

            // Model ended with tool calls. Emit start event
            const toolCalls: proto.ToolCall[] = result.value.choices.flatMap(c => c.message.tool_calls ?? []);
            for (const tc of toolCalls) {
                emitSseEvent(res, chatId, messageId, {
                    type: 'tool_call:start',
                    data: {
                        id: tc.id,
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    },
                });
            }

            // Execute all tool calls, then emit results
            const roundResults = await toolRegistry.executeToolRound(toolCalls);
            for (const r of roundResults) {
                const resultText = r.result.ok ? r.result.output : `Error: ${r.result.error}`;
                emitSseEvent(res, chatId, messageId, {
                    type: 'tool_call:result',
                    data: {
                        id: r.id,
                        name: r.name,
                        arguments: r.arguments,
                        result: resultText
                    },
                });
            }

            // Build assistant turn + tool result messages and append to history.
            const message = result.value.choices[0]?.message;
            const assistantTurn: proto.Message = {
                role: 'assistant',
                content: message?.content ?? '',
                reasoning_content: message?.reasoning_content || undefined,
                tool_calls: toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.function.name, arguments: tc.function.arguments },
                })),
            };

            const toolMessages: proto.Message[] = roundResults.map(r => ({
                role: 'tool' as const,
                tool_call_id: r.id,
                content: r.result.ok ? r.result.output : `Error: ${r.result.error}`,
            }));

            body = { ...body, messages: [...body.messages, assistantTurn, ...toolMessages] };

            // On the last allowed round, strip tools so the model is forced to
            // produce a final text response.
            if (round === MAX_TOOL_ROUNDS - 1) {
                console.log(`[custom-completions] max tool rounds reached, stripping tools`);
                body = { ...body, tools: undefined };
            }
        }

        console.log(`waiting for tasks...`);
        await taskPromise;
        console.log(`done!`);

        const completionTps = totalPredictedMs > 0
            ? (totalUsage.completion_tokens / totalPredictedMs) * 1000
            : undefined;
        const promptTps = totalPromptMs > 0
            ? (totalUsage.prompt_tokens / totalPromptMs) * 1000
            : undefined;

        res.write('data: [DONE]\n\n');
        emitSseEvent(res, chatId, messageId, {
            type: 'chat:completion',
            data: {
                done: true,
                usage: {
                    ...totalUsage,
                    ...(completionTps !== undefined ? { completion_tokens_per_second: completionTps } : {}),
                    ...(promptTps !== undefined ? { prompt_tokens_per_second: promptTps } : {}),
                },
            },
        });
        res.end();
    } catch (err: any) {
        // Headers are always committed at this point (we flush them before the loop)
        console.error(`[custom-completions] mid-stream error:`, err);
        emitSseEvent(res, chatId, messageId, {
            type: 'chat:message:error',
            data: { error: { content: err?.message ?? String(err) } },
        });
        res.end();
    }
});

/* -------------------- TASKS -------------------- */

const SYSTEM_PROMPT_TITLEGEN = `You are a helpful assistant.

Your primary role is to come up with a short, memorable phrase to serve as the "title" of a chat initiated by the user.

You should adhere to the following guidelines:
- Respond to the user's message with a phrase that summarizes the user's message
- Your response should contain 5 or fewer words
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
        emitSseEvent(res, ctx.chatId, ctx.messageId, {
            type: 'chat:title',
            data: title,
        });
    }

    const startTime = performance.now();
    try {
        if (ctx.chatId.startsWith('local:')) {
            log(`local chat - skipping title generation`);
            return;
        }

        // TODO - this breaks if firstUserMessage has content parts and task model
        // does not have mmproj
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
                ]
            },
            signal: signal
        }, { taskModel: true });

        const result = await taskResponse.stream.finished();

        let title: string = fallbackTitle(ctx);
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

        log(`generated title: ${title}`);
        await Chats.updateChat(ctx.chatId, { chat: { title } });
        emitTitle(title);
    } catch (err) {
        const title = fallbackTitle(ctx);
        log(`title generation failed: ${err}`);
        log(`using fallback title: ${title}`);
        emitTitle(title);
    } finally {
        const endTime = performance.now();
        const seconds = (endTime - startTime) / 1000;
        log(`(title generation) time elapsed: ${seconds} sec`);
    }
}

/* -------------------- HELPERS -------------------- */

/**
 * Writes a typed `event: chat-event` SSE frame to the response.
 */
function emitSseEvent(
    res: Response,
    chatId: string,
    messageId: string,
    payload: SseEventPayload,
): void {
    const frame: SseEvent = {
        chat_id: chatId ?? '',
        message_id: messageId ?? '',
        data: payload,
    };
    res.write(`event: chat-event\ndata: ${JSON.stringify(frame)}\n\n`);
}

/**
 * Merges timings/usage from a single CompletionResponse into running totals.
 */
function accumulateUsage(total: SseUsage, response: proto.CompletionResponse): SseUsage {
    const tokensOut = response.timings?.predicted_n ?? response.usage?.completion_tokens ?? 0;
    const cacheIn = response.timings?.cache_n ?? 0;
    const promptIn = response.timings?.prompt_n ?? response.usage?.prompt_tokens ?? 0;
    const tokensIn = cacheIn + promptIn;

    return {
        prompt_tokens: total.prompt_tokens + tokensIn,
        completion_tokens: total.completion_tokens + tokensOut,
        total_tokens: total.total_tokens + tokensIn + tokensOut,
    };
}

/**
 * Returns true if the CompletionResponse indicates the model wants tool calls.
 */
function hasToolCalls(response: proto.CompletionResponse): boolean {
    return response.choices.some(
        c => c.finish_reason === 'tool_calls' || (c.message.tool_calls && c.message.tool_calls.length > 0),
    );
}

/**
 * Generate a title for a chat if no task model is available
 */
function fallbackTitle(ctx: ChatRequestContext): string {
    // Fallback: send "first 3 words" of user message
    let message = ctx.firstUserMessage.content;
    let title: string | undefined;
    if (Array.isArray(message)) {
        title = message.find((msg) => msg.type === 'text')?.text;
        if (!title) {
            title = 'New Chat';
        } else {
            title = title.split(' ').slice(0, 3).join(' ');
        }
    } else {
        title = message.split(' ').slice(0, 3).join(' ');
    }

    return title;
}

export default router;