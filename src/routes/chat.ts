/**
 * Chat Completion API Router
 *
 * Provides the main chat completion endpoint for AI interactions.
 * OpenAI-compatible with OpenWebUI extensions.
 */

import { Router, type Response, type NextFunction } from 'express';
import * as Types from './types.js';
import * as MockData from './mock-data.js';
import { requireAuth } from './middleware.js';

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
router.post('/completions', requireAuth, (
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

    const formData = parsed.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Verify model access control
    // TODO: If chat_id provided, verify ownership (unless admin)
    // TODO: Process chat_id, id, session_id for async handling
    // TODO: Call actual LLM completion via LlamaManager

    // Mock response - return a simple completion
    const mockResponse = {
        id: 'chatcmpl-mock123',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: formData.model,
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: 'This is a mock response. The real implementation will call LlamaManager.'
                },
                finish_reason: 'stop'
            }
        ],
        usage: {
            prompt_tokens: 10,
            completion_tokens: 15,
            total_tokens: 25
        }
    };

    res.json(mockResponse);
});

export default router;
