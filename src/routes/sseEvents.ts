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

/** Emitted once when generation is complete */
export type SseCompletionPayload = {
    type: 'chat:completion';
    data: {
        done: true;
        usage: SseUsage;
    };
};

/** Emitted when the backend encounters an error mid-stream */
export type SseMessageErrorPayload = {
    type: 'chat:message:error';
    data: {
        error: { content: string };
    };
};

/** Emitted after completion with an auto-generated chat title */
export type SseTitlePayload = {
    type: 'chat:title';
    data: string;
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
    };
};

/* -------------------- UNION & TOP-LEVEL -------------------- */

export type SseEventPayload =
    | SseCompletionPayload
    | SseMessageErrorPayload
    | SseTitlePayload
    | SseToolCallStartPayload
    | SseToolCallResultPayload;

export type SseEvent = {
    chat_id: string;
    data: SseEventPayload;
};
