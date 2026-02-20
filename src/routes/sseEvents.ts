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
};

/* -------------------- EVENT PAYLOAD TYPES -------------------- */

export type SseStatusItem = {
    description?: string;
    done?: boolean;
    hidden?: boolean;
} & (
    | { action: 'web_search'; urls?: string[]; items?: unknown[]; query?: string }
    | { action: 'knowledge_search'; query: string }
    | { action: 'web_search_queries_generated'; queries: string[] }
    | { action: 'queries_generated'; queries: string[] }
    | { action: 'sources_retrieved'; count: number }
    | { action?: string }
);

/** Emitted during tool call execution to show progress in the UI */
export type SseStatusPayload = {
    type: 'status';
    data: SseStatusItem;
};

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

type SseSource = {
    type?: string;
    [key: string]: unknown;
};

/** Emitted for each web search result or code execution result */
export type SseCitationPayload = {
    type: 'source' | 'citation';
    data: SseSource;
};

/** Emitted to display a toast notification in the UI */
export type SseNotificationPayload = {
    type: 'notification';
    data: {
        type: 'success' | 'error' | 'warning' | 'info';
        content: string;
    };
};

/* -------------------- UNION & TOP-LEVEL -------------------- */

export type SseEventPayload =
    | SseStatusPayload
    | SseCompletionPayload
    | SseMessageErrorPayload
    | SseTitlePayload
    | SseCitationPayload
    | SseNotificationPayload;

export type SseEvent = {
    chat_id: string;
    message_id: string;
    data: SseEventPayload;
};
