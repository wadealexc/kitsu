import type { Response } from 'express';
import chalk from 'chalk';

import { LlamaManager } from '../../llama/llamaManager.js';
import { db, Chats } from '../../db/index.js';
import { emitSseEvent } from './helpers.js';
import type { ChatRequestContext } from './prepare.js';

/* -------------------- TITLE GENERATION -------------------- */

const SYSTEM_PROMPT_TITLEGEN = `You are a helpful assistant.

Your primary role is to come up with a short, memorable phrase to serve as the "title" of a chat initiated by the user.

You should adhere to the following guidelines:
- Respond to the user's message with a phrase that summarizes the user's message
- Your response should contain 5 or fewer words
- Your response should never attempt to answer the user's question, or respond to the user's message directly

Create a chat title that summarizes the following user message:
`;

export async function doTasks(
    llama: LlamaManager,
    taskModel: string,
    res: Response,
    ctx: ChatRequestContext,
    signal: AbortSignal,
): Promise<void> {

    // TEMP: only task right now is title generation. If we don't need it, return early
    if (ctx.chat.title || ctx.isLocalChat) return;

    const log = (str: string) => {
        console.log(chalk.dim.yellow(`[custom-completions::doTasks]: ${str}`));
    };

    log(`starting title generation request`);

    const emitTitle = (title: string) => {
        emitSseEvent(res, ctx.chatId, {
            type: 'chat:title',
            data: title,
        });
    };

    // `title` starts as a fallback title derived from the user's message
    let title: string = normalizeTitle(ctx.userMessage.content) || 'New Chat';
    const startTime = performance.now();
    try {
        const taskResponse = await llama.completions({
            body: {
                stream: false,
                model: taskModel,
                messages: [
                    {
                        role: 'system',
                        content: SYSTEM_PROMPT_TITLEGEN,
                    },
                    // Use text-only content — avoids mmproj issues when the user
                    // attached images and the task model doesn't have mmproj.
                    {
                        role: 'user',
                        content: ctx.userMessage.content,
                    },
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
            if (!taskResult || !taskResult.content) {
                log(`malformed response from model`);
            } else {
                title = normalizeTitle(taskResult.content);
            }
        }
    } catch (err) {
        log(`title generation failed; using fallback: ${err}`);
    } finally {
        const endTime = performance.now();
        const seconds = (endTime - startTime) / 1000;
        log(`(title generation) time elapsed: ${seconds.toFixed(2)} sec`);

        // TODO - it's a bit messy.
        emitTitle(title);
        try { await Chats.updateChat(ctx.chatId, { chat: { title } }, db); } catch { }
    }
}

/* -------------------- TITLE HELPERS -------------------- */

/**
 * Split string by spaces, trim to max 5 words and capitalize first
 * letter of each word, then join with space again.
 */
function normalizeTitle(title: string): string {
    return title
        .trim()
        .split(/\s+/)
        .slice(0, 5)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
}
