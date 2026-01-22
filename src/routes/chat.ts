/**
 * Chat Completion API Router
 *
 * Provides the main chat completion endpoint for AI interactions.
 * OpenAI-compatible with OpenWebUI extensions.
 */

import { Router, type Response, type NextFunction } from 'express';
import chalk from 'chalk';

import { LlamaManager, type LlamaResponse } from '../llama/llamaManager.js';
import * as Types from './types.js';
import * as MockData from './mock-data.js';
import { requireAuth } from './middleware.js';
import * as proto from '../protocol.js';

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

    // TODO: Get user ID from JWT token
    // const userId = MockData.MOCK_ADMIN_USER_ID;

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
            body: parsed.data,
            signal: ctrl.signal,
        });

        const stream = response.stream;

        // Once we have data back from llama-server, we can begin streaming it to the client
        stream.once('readable', () => {
            // Copy headers and status for client once we have confirmation we're getting data
            response.headers.forEach((v, k) => res.setHeader(k, v));
            res.status(response.status);

            stream.pipe(res);
        });

        // This listener is triggered when llama-server is done streaming, or when the
        // stream is cancelled prematurely due to:
        // - client disconnects
        // - llama-server errors
        stream.once('stop', (result: proto.Result<proto.CompletionResponse, Error>) => {
            // logger?.logs.push({
            //     request: req.body,
            //     response: result.ok ? result.value : result.value.message
            // });

            console.log(`stream stopped. result: ${result.ok}`);

            // On success, end response and track stats for logs
            if (result.ok) {
                const tps = result.value.timings?.predicted_per_second;
                const tokensOut = result.value.timings?.predicted_n;
                const cacheIn = result.value.timings?.cache_n ?? 0;
                const promptIn = result.value.timings?.prompt_n ?? 0;
                const tokensIn = cacheIn + promptIn;

                console.log(` - result: ${JSON.stringify(result.value, null, 2)}`);

                // (res.locals.llama as middleware.LlamaStatus).usage = {
                //     tps: tps ?? 0,
                //     inputTokens: tokensIn ?? 0,
                //     outputTokens: tokensOut ?? 0,
                // }

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
