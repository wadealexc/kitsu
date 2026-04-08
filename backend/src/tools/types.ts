import { z } from 'zod';

import type { Browser } from '../browser/browser.js';
import type { LlamaManager } from '../llama/llamaManager.js';
import * as proto from '../protocol/index.js';

export type BeforeRequestOptions = { webSearchEnabled: boolean };

/**
 * Per-request session state threaded through the tool system.
 * Created once per HTTP request and mutated across tool-call rounds.
 */
export type ToolSession = {
    /** Model name used for tokenize calls */
    model: string;
    /** Model context size from ModelInfo (undefined = no budget tracking) */
    contextLimit: number | undefined;
    /** Remaining token budget for tool results; updated by the completion loop each round */
    contextBudget: number | undefined;
    /** Whether webSearch has been called during this request */
    webSearchCalled: boolean;
    /** Pages fetched but not yet returned to the model */
    bufferedPages: Array<{ url: string; content: string; query: string }>;
    /** Per-query Brave API offset for follow-up searches */
    searchState: Map<string, number>;
    /** URLs already returned in tool results; seeded from message history */
    seenUrls: Set<string>;
};

/**
 * Create a fresh ToolSession for a new request. Scans existing tool messages
 * to seed `seenUrls` with URLs already in the conversation history.
 */
export function createToolSession(
    model: string,
    contextLimit: number | undefined,
    messages: proto.Message[],
): ToolSession {
    const seenUrls = new Set<string>();

    for (const msg of messages) {
        if (msg.role !== 'tool') continue;

        try {
            const parsed: unknown = JSON.parse(msg.content);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (
                        item !== null &&
                        typeof item === 'object' &&
                        'url' in item &&
                        typeof (item as Record<string, unknown>).url === 'string'
                    ) {
                        seenUrls.add((item as Record<string, unknown>).url as string);
                    }
                }
            }
        } catch {
            // Not JSON or not expected shape — skip
        }
    }

    return {
        model,
        contextLimit,
        contextBudget: undefined,
        webSearchCalled: false,
        bufferedPages: [],
        searchState: new Map(),
        seenUrls,
    };
}

/** Progress event emitted by a tool during execution. */
export type ToolProgress = {
    type: string;
    data: unknown;
};

/** Callback passed to Tool.call for emitting progress events. */
export type ToolEmit = (event: ToolProgress) => void;

export interface Tool<Input = unknown, Output = unknown> {
    name: () => string;
    description: () => string;
    /**
     * What the LLM will send. For tools with no parameters, return
     * an empty object schema.
     */
    inputSchema: () => z.ZodType<Input>;

    /**
     * Calls the tool at runtime.
     * `session` carries per-request state (context budget, seen URLs, etc.)
     */
    call: (input: Input, session: ToolSession, signal: AbortSignal, emit: ToolEmit) => Promise<Output> | Output;

    /**
     * Allows the tool to modify a request's messages before being passed to a model
     * @returns the new completion request object
     */
    beforeRequest?: (req: proto.CompletionRequest, opts: BeforeRequestOptions) => proto.CompletionRequest | Promise<proto.CompletionRequest>;
}

export type ToolContext = {
    browser: Browser | undefined,
    llama: LlamaManager,
}

export type ToolFactory<Input, Output> = (ctx: ToolContext) => Tool<Input, Output>;