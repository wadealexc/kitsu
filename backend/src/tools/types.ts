/**
 * Per-request state threaded through tool calls, created once per completion
 * request and updated each round.
 */
export type ToolSession = {
    /** Model name, for counting tokens */
    model: string;
    /** Model context size (undefined = no budget tracking) */
    contextLimit: number | undefined;
    /** Tokens tool results may still use; updated by the completion loop each round */
    contextBudget: number | undefined;
    /** Servers the user turned off for this chat */
    disabledServers: Set<string>;
    /** Which chat and user a sandbox call belongs to */
    identity?: { chat: string; user: string } | undefined;
};

export function createToolSession(
    model: string,
    contextLimit: number | undefined,
    disabledServers: Iterable<string> = [],
    identity?: { chat: string; user: string },
): ToolSession {
    return { model, contextLimit, contextBudget: undefined, disabledServers: new Set(disabledServers), identity };
}

/** Progress reported while a tool runs, forwarded to the frontend. */
export type ToolProgress = {
    type: 'progress';
    message?: string;
    progress: number;
    total?: number;
    /** Status of one page, for tools that load web pages */
    page?: { url: string; status: string; outcome?: string };
};
