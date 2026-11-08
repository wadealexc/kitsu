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
    /** Prompt tokens processed per second (cached tokens excluded) */
    prompt_tokens_per_second?: number;
    /** The conversation's size once this reply finished */
    context_tokens?: number;
    /** What this reply added to the conversation: generated text and tool results */
    message_tokens?: number;
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

/**
 * Emitted before generation with the notes kitsu keeps on each message (by
 * message id), so the frontend saves them with the chat.
 */
export type SseNotesPayload = {
    type: 'chat:notes';
    data: Record<string, ({
        kind: 'tools';
        text: string;
        disabledServers: string[];
    } | {
        kind: 'files';
        text: string;
    })[]>;
};

/** Emitted when the LLM requests a tool call */
export type SseToolCallStartPayload = {
    type: 'tool_call:start';
    data: {
        id: string;
        name: string;
        arguments: string;
        /** MCP server the tool belongs to */
        server?: string;
        /** Which model turn asked for it */
        round: number;
        /** When it started (unix ms) */
        startedAt: number;
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
        server?: string;
        /** Machine-readable result (MCP structuredContent), for display */
        structured?: Record<string, unknown>;
        /** Images for the model to look at */
        images?: { mimeType: string; data: string }[];
    };
};

/** Emitted during tool execution to report progress */
export type SseToolCallProgressPayload = {
    type: 'tool_call:progress';
    data: {
        id: string;       // tool call ID
        name: string;     // tool name (e.g. 'web_fetch')
        progress: {
            type: 'progress';
            message?: string;
            progress: number;
            total?: number;
            /** Status of one page, from tools that load web pages */
            page?: { url: string; status: string; outcome?: string };
            /** The latest output of a command still running */
            output?: string;
        };
    };
};

/* -------------------- UNION & TOP-LEVEL -------------------- */

export type SseEventPayload =
    | SseCompletionPayload
    | SseTitlePayload
    | SseNotesPayload
    | SseModelQueuedPayload
    | SseModelLoadingPayload
    | SseToolCallStartPayload
    | SseToolCallResultPayload
    | SseToolCallProgressPayload;

export type SseEvent = {
    chatId: string;
    data: SseEventPayload;
};
