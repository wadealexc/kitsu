import type { Llama } from '../llama/types.js';
import type { McpManager, McpTool, ToolImage } from '../mcp/manager.js';
import * as proto from '../protocol/index.js';
import type { ToolProgress, ToolSession } from './types.js';

export type ToolCallResult =
    | { ok: true; output: string; structured?: Record<string, unknown>; images?: ToolImage[] }
    | { ok: false; error: string; structured?: Record<string, unknown> };

export type ToolRoundResult = {
    id: string;
    name: string;
    arguments: string;
    /** Name of the MCP server the tool came from */
    server?: string;
    result: ToolCallResult;
};

/**
 * The tools offered to the model: every tool of every MCP server an admin added.
 *
 * The same definitions go out on every request, whatever the user has turned
 * off, so the start of the prompt (and llama.cpp's cache of it) stays the same.
 * Calls to tools the user turned off are answered with an error instead. The one
 * exception is a sandbox, which is off by default: most chats never use it, so its
 * tools join the list the first time it's turned on in a chat, and stay.
 */
export class ToolRegistry {

    constructor(private mcp: McpManager, private llama: Llama) { }

    tools(): McpTool[] {
        return this.mcp.tools();
    }

    /** `includeSandbox` is false for a chat that has never turned its sandbox on. */
    getToolDefinitions(includeSandbox = true): proto.ToolDefinition[] {
        return this.tools().filter(tool => includeSandbox || !tool.sandbox).map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));
    }

    find(name: string): McpTool | undefined {
        return this.tools().find(t => t.name === name);
    }

    async call(
        name: string,
        args: string,
        session: ToolSession,
        signal: AbortSignal,
        onProgress?: (event: ToolProgress) => void,
    ): Promise<ToolCallResult> {
        const tool = this.find(name);
        if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

        if (session.disabledServers.has(tool.serverId)) {
            return {
                ok: false,
                error: `The user has turned off the ${tool.serverName} tools for now. Don't call them; answer without them unless the user turns them back on.`,
            };
        }

        if (session.contextBudget !== undefined && session.contextBudget <= 0) {
            return { ok: false, error: 'The context window is nearly full. Answer now with what you have, without calling more tools.' };
        }

        let parsed: unknown;
        try { parsed = args.trim() ? JSON.parse(args) : {}; }
        catch { return { ok: false, error: `Invalid JSON arguments for ${name}` }; }

        const result = await this.mcp.call(tool, parsed, {
            signal,
            onProgress: (p) => onProgress?.({ type: 'progress', ...p }),
            identity: session.identity,
        });
        const structured = result.structured ? { structured: result.structured } : {};

        // Keep results inside the context window: count, and refuse what doesn't fit.
        // A command that failed can have as much output as one that worked.
        if (session.contextBudget !== undefined) {
            const tokens = await this.llama.tokenize(result.text, session.model, signal);
            if (tokens > session.contextBudget) {
                return {
                    ok: false,
                    error: `The result was ${tokens} tokens, but only ${Math.max(0, session.contextBudget)} tokens of context are left. Ask for less, or answer with what you have.`,
                    ...structured,
                };
            }
            session.contextBudget -= tokens;
        }

        if (!result.ok) return { ok: false, error: result.text, ...structured };
        return { ok: true, output: result.text, ...structured, ...(result.images ? { images: result.images } : {}) };
    }

    /**
     * Runs all tool calls from one round in parallel. One failing doesn't stop the others.
     */
    async executeToolRound(
        toolCalls: proto.AssistantToolCall[],
        session: ToolSession,
        signal: AbortSignal,
        onProgress?: (toolCallId: string, event: ToolProgress) => void,
    ): Promise<ToolRoundResult[]> {
        const settled = await Promise.allSettled(toolCalls.map(tc => this.call(
            tc.function.name,
            tc.function.arguments,
            session,
            signal,
            onProgress ? (event) => onProgress(tc.id, event) : undefined,
        )));

        return toolCalls.map((tc, i) => {
            const outcome = settled[i]!;
            const server = this.find(tc.function.name)?.serverName;
            return {
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
                ...(server ? { server } : {}),
                result: outcome.status === 'fulfilled' ? outcome.value : { ok: false, error: String(outcome.reason) },
            };
        });
    }
}
