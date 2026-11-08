import type { Sink } from './jobs.js';
import chalk from 'chalk';

import type * as proto from '../../protocol/index.js';
import type { SseEvent, SseEventPayload, SseUsage } from '../../protocol/sse.js';
import { ToolRegistry, type ToolRoundResult } from '../../tools/registry.js';
import type { ToolProgress, ToolSession } from '../../tools/types.js';
import type * as Types from '../types/index.js';

/* -------------------- SSE EVENTS -------------------- */

/**
 * Writes a typed `event: chat-event` SSE frame to the response.
 */
export function emitSseEvent(
    res: Sink,
    chatId: string,
    payload: SseEventPayload,
): void {
    const frame: SseEvent = { chatId, data: payload };
    res.write(`event: chat-event\ndata: ${JSON.stringify(frame)}\n\n`);
}

/**
 * Returns a callback function that will emit the provided SSE event when called.
 */
export function emitCallback(
    res: Sink,
    chatId: string,
    payload: SseEventPayload,
): (() => void) {
    return () => {
        console.log(`emit: ${payload.type}`);
        emitSseEvent(res, chatId, payload);
    };
}

export type ToolExecResult = {
    results: ToolRoundResult[];
    elapsedMs: number;
    toolRoundStartMs: number;
    /** When the round's tools started (unix ms) */
    startedAt: number;
};

export async function emitEventsAndExecuteTools(
    res: Sink,
    chatId: string,
    toolRegistry: ToolRegistry,
    toolCalls: proto.AssistantToolCall[],
    signal: AbortSignal,
    session: ToolSession,
    round: number,
): Promise<ToolExecResult | undefined> {
    if (toolCalls.length === 0) return;
    const startedAt = Date.now();

    // Emit SSE events for each tool call
    for (const tc of toolCalls) {
        const server = toolRegistry.find(tc.function.name)?.serverName;
        emitSseEvent(res, chatId, {
            type: 'tool_call:start',
            data: { id: tc.id, name: tc.function.name, arguments: tc.function.arguments, round, startedAt, ...(server ? { server } : {}) },
        });
    }

    // Execute tool calls, forwarding progress events as SSE frames
    const toolRoundStartMs = performance.now();
    const onProgress = (toolCallId: string, event: ToolProgress) => {
        const tc = toolCalls.find(t => t.id === toolCallId);
        emitSseEvent(res, chatId, {
            type: 'tool_call:progress',
            data: {
                id: toolCallId,
                name: tc?.function.name ?? '',
                progress: event,
            },
        });
    };
    const roundResults = await toolRegistry.executeToolRound(toolCalls, session, signal, onProgress);
    const elapsedMs = performance.now() - toolRoundStartMs;

    // Emit SSE events for each result
    for (const r of roundResults) {
        if (!r.result.ok) {
            console.error(`tool call ${r.name} failed with error: ${r.result.error}`);
        }
        
        emitSseEvent(res, chatId, {
            type: 'tool_call:result',
            data: {
                id: r.id,
                name: r.name,
                arguments: r.arguments,
                result: r.result.ok ? r.result.output : r.result.error,
                failed: !r.result.ok,
                ...(r.server ? { server: r.server } : {}),
                ...(r.result.structured ? { structured: r.result.structured } : {}),
                ...(r.result.ok && r.result.images ? { images: r.result.images } : {}),
            },
        });
    }

    return { results: roundResults, elapsedMs, toolRoundStartMs, startedAt };
}

/* -------------------- BLOCK ACCUMULATION -------------------- */

/**
 * Updates the blocks array for one completion round.
 *
 * Non-tool call rounds: Adds reasoning block. Returns final text content.
 *
 * Tool round: Adds reasoning and content blocks (if present) and tool_call blocks.
 * Returns empty string. These blocks are what later requests rebuild this round
 * from, so everything the model wrote or was told has to be in them.
 */
export function accumulateBlocks(
    blocks: Types.MessageBlock[],
    response: proto.CompletionResponse,
    toolResults?: ToolRoundResult[],
    reasoningDurationMs?: number,
    timing?: { round: number; startedAt: number },
): string {
    const message = response.choices[0]?.message;

    if (message?.reasoning_content) {
        const duration = reasoningDurationMs !== undefined ? Math.round(reasoningDurationMs / 1000) : undefined;
        blocks.push({ type: 'reasoning', content: message.reasoning_content, done: true, duration });
    }

    if (!toolResults) {
        return message?.content ?? '';
    }

    // The same trim the frontend applies, so both copies of a reply match.
    const said = message?.content?.trim();
    if (said) blocks.push({ type: 'content', content: said, done: true });

    for (let i = 0; i < toolResults.length; i++) {
        const r = toolResults.at(i)!;

        blocks.push({
            type: 'tool_call',
            id: r.id,
            name: r.name,
            arguments: r.arguments,
            done: true,
            result: r.result.ok ? r.result.output : r.result.error,
            failed: !r.result.ok,
            ...(r.server ? { server: r.server } : {}),
            ...(r.result.structured ? { structured: r.result.structured } : {}),
            ...(timing ?? {}),
            ...(r.result.ok && r.result.images ? { images: r.result.images } : {}),
        });
    }

    // Return 'final content' (empty string because we ended on a tool call)
    return '';
}

/* -------------------- ROUND LOGGING -------------------- */

export type RoundLog = {
    round: number;
    totalMs: number;
    tokens: number;
    reasoningMs?: number;
    contentMs?: number;
    toolCalls?: string[];
    toolsMs?: number;
};

export function logCompletion(model: string, roundLogs: RoundLog[]): void {
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

/* -------------------- USAGE ACCUMULATION -------------------- */

export type UsageInfo = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;

    totalPredictedMs: number;
    totalPromptMs: number;

    /** Prompt tokens actually processed (not served from the cache) */
    processedTokens: number;
    /** Conversation size before this reply: the first round's prompt */
    contextBefore?: number;
    /** Conversation size after the latest round: prompt plus what it generated */
    contextAfter?: number;
};

export function newUsageInfo(): UsageInfo {
    return {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        totalPredictedMs: 0,
        totalPromptMs: 0,
        processedTokens: 0,
    };
}

/**
 * Merges timings/usage from a single CompletionResponse into running totals.
 * A reply with tool calls has several rounds, each seeing the whole conversation.
 */
export function accumulateUsage(info: UsageInfo, response: proto.CompletionResponse): UsageInfo {
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
        processedTokens: info.processedTokens + promptIn,
        contextBefore: info.contextBefore ?? tokensIn,
        contextAfter: tokensIn + tokensOut,
    };
}

export function getFinalUsage(info: UsageInfo): SseUsage {
    const completionTps = info.totalPredictedMs > 0
        ? (info.completion_tokens / info.totalPredictedMs) * 1000
        : undefined;
    // Only tokens that were processed: cached ones take no time, and counting them
    // gave nonsense speeds
    const promptTps = info.totalPromptMs > 0 && info.processedTokens > 0
        ? (info.processedTokens / info.totalPromptMs) * 1000
        : undefined;

    return {
        prompt_tokens: info.prompt_tokens,
        completion_tokens: info.completion_tokens,
        total_tokens: info.total_tokens,
        completion_tokens_per_second: completionTps,
        prompt_tokens_per_second: promptTps,
        ...(info.contextAfter !== undefined ? { context_tokens: info.contextAfter } : {}),
        ...(info.contextAfter !== undefined && info.contextBefore !== undefined
            ? { message_tokens: info.contextAfter - info.contextBefore }
            : {}),
    };
}
