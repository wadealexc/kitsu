import { Router, type Response, type NextFunction } from 'express';
import chalk from 'chalk';

import { LlamaManager, type LlamaResponse } from '../llama/llamaManager.js';
import * as Types from './types.js';
import { requireAuth } from './middleware.js';
import * as proto from '../protocol.js';
import { db } from '../db/client.js';
import * as Chats from '../db/operations/chats.js';
import * as Models from '../db/operations/models.js';
import { NotFoundError } from './errors.js';

const router = Router();

/* -------------------- CHAT COMPLETION -------------------- */

/**
 * POST /api/v1/chat/completions
 * Access Control: Any authenticated user
 *
 * Main chat completion API - send messages to AI and get responses.
 * OpenAI-compatible endpoint with OpenWebUI extensions.
 *
 * @body {Types.ChatCompletionForm} - OpenAI-compatible request with extensions
 * @returns {object} - OpenAI-compatible response (streaming or static)
 */
router.post('/completions', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
    res: Response<any | Types.ErrorResponse>,
    next: NextFunction
) => {
    const parsed = Types.ChatCompletionFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: parsed.error.issues
        });
    }

    console.log(`body: \n\n${JSON.stringify(parsed, null, 2)}\n\n`);

    const userId = req.user!.id;
    const { chat_id: chatId, id: messageId, parent_message: parentMessage } = parsed.data;

    /* -------------------- PRE-PROCESSING & VALIDATION -------------------- */

    // Resolve custom model → base model
    // If the requested model ID matches a DB custom model, check access and
    // rewrite model to the base model name for LlamaManager routing.
    let resolvedModel = parsed.data.model;
    const customModel = await Models.getModelById(resolvedModel, db);
    if (customModel) {
        if (!Models.hasAccess(customModel, userId, 'read')) {
            return res.status(403).json({ detail: 'No access to this model' });
        }
        resolvedModel = customModel.baseModelId;
    }
    
    // Oh god it's horrible
    let systemPrompt = (parsed.data.model_item?.params as any).system as string;
    let messages = parsed.data.messages as proto.Message[];
    // Add system prompt if needed
    if (messages[0]?.role !== 'system') {
        messages.unshift({
            role: 'system',
            content: systemPrompt,
        })
    }

    const completionBody = { ...parsed.data, model: resolvedModel, messages: messages, };

    // Verify user owns the referenced chat (unless 'local', which is not persisted)
    if (chatId) {        
        if (!chatId.startsWith('local:')) {
            const chat = await Chats.getChatByIdAndUserId(chatId, userId, db);
            if (!chat) return NotFoundError('Chat not found');
        }
    }

    // Insert chat files from parent message (if provided)
    if (chatId && parentMessage?.files && !chatId.startsWith('local:')) {
        const fileIds = parentMessage.files
            .filter((f: any) => f.type === 'file')
            .map((f: any) => f.id)
            .filter(Boolean);

        if (fileIds.length > 0) {
            try {
                await Chats.insertChatFiles(
                    chatId,
                    parentMessage.id,
                    fileIds,
                    userId,
                    db
                );
            } catch (error) {
                console.error('Error inserting chat files:', error);
                // Don't fail request - file associations are metadata, not critical
            }
        }
    }

    // TODO - keeping tools out of the equation for now
    // const request: proto.CompletionRequest = await tools.beforeRequest(req.body);
    const ctrl = new AbortController();

    req.once('aborted', () => {
        console.log(chalk.dim.yellow(`client aborted request`));
        ctrl.abort();
    });

    res.once('close', () => ctrl.abort());

    try {
        const llama = req.app.locals.llama as LlamaManager;

        // Forward request to llama-server
        const response: LlamaResponse = await llama.completions({
            body: completionBody,
            signal: ctrl.signal,
        });

        const stream = response.stream;

        // Once we have data back from llama-server, we can begin streaming it to the client
        stream.once('readable', () => {
            // Copy headers and status for client once we have confirmation we're getting data
            response.headers.forEach((v, k) => res.setHeader(k, v));
            res.status(response.status);

            stream.pipe(res, { end: false });
        });

        // This listener is triggered when llama-server is done streaming, or when the
        // stream is cancelled prematurely due to:
        // - client disconnects
        // - llama-server errors
        stream.once('stop', async (result: proto.Result<proto.CompletionResponse, Error>) => {
            // logger?.logs.push({
            //     request: req.body,
            //     response: result.ok ? result.value : result.value.message
            // });

            console.log(`stream stopped. result: ${result.ok}`);

            // On success, inject a chat-event frame then end the response
            if (result.ok) {
                const tokensOut = result.value.timings?.predicted_n ?? 0;
                const cacheIn   = result.value.timings?.cache_n ?? 0;
                const promptIn  = result.value.timings?.prompt_n ?? 0;
                const tokensIn  = cacheIn + promptIn;

                console.log(` - result: ${JSON.stringify(result.value, null, 2)}`);

                // Build payload in the shape chatEventHandler() expects on the frontend.
                // This triggers chatCompletedHandler() via the SSE path, giving it full
                // parity with the socket path.
                const chatEventPayload = {
                    chat_id: chatId,
                    message_id: messageId,
                    data: {
                        type: 'chat:completion',
                        data: {
                            done: true,
                            usage: {
                                prompt_tokens:     tokensIn,
                                completion_tokens: tokensOut,
                                total_tokens:      tokensIn + tokensOut,
                            },
                        },
                    },
                };

                res.write(`event: chat-event\ndata: ${JSON.stringify(chatEventPayload)}\n\n`);
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

export default router;
