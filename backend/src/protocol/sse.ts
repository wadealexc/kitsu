/**
 * Types for named events embedded in the SSE stream by the backend.
 * These are pure type definitions with no imports, so they can be safely
 * imported by the frontend via the @backend path alias.
 */

/* -------------------- SHARED -------------------- */

export type SseUsage = {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_per_second?: number;
    prompt_tokens_per_second?: number;
};

/* -------------------- EVENT PAYLOAD TYPES -------------------- */

/** Emitted once when generation is complete. Carries optional error if the stream ended abnormally. */
export type SseCompletionPayload = {
    type: 'chat:completion';
    data: {
        done: true;
        usage: SseUsage;
        error?: { content: string };
    };
};

/** Emitted after completion with an auto-generated chat title */
export type SseTitlePayload = {
    type: 'chat:title';
    data: string;
};

export type SseModelQueuedPayload = {
    type: 'model:queued'
    data?: never,
};

export type SseModelLoadingPayload = {
    type: 'model:loading',
    data?: never,
};

/** Emitted when the LLM requests a tool call */
export type SseToolCallStartPayload = {
    type: 'tool_call:start';
    data: {
        id: string;
        name: string;
        arguments: string;
    };
};

/** Emitted when a tool call finishes executing */
export type SseToolCallResultPayload = {
    type: 'tool_call:result';
    data: {
        id: string;
        name: string;
        arguments: string;
        result: string;
        failed: boolean;
    };
};

/** Emitted during tool execution to report progress */
export type SseToolCallProgressPayload = {
    type: 'tool_call:progress';
    data: {
        id: string;       // tool call ID
        name: string;     // tool name (e.g. 'webSearch')
        progress: {       // tool-specific payload
            type: string;
            [key: string]: unknown;
        };
    };
};

/* -------------------- UNION & TOP-LEVEL -------------------- */

export type SseEventPayload =
    | SseCompletionPayload
    | SseTitlePayload
    | SseModelQueuedPayload
    | SseModelLoadingPayload
    | SseToolCallStartPayload
    | SseToolCallResultPayload
    | SseToolCallProgressPayload;

export type SseEvent = {
    chatId: string;
    data: SseEventPayload;
};
