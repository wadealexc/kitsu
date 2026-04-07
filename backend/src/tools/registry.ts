import { toJSONSchema } from 'zod';

import loadTools from './loader.js';
import type { Tool, ToolContext, BeforeRequestOptions, ToolProgress, ToolEmit } from './types.js';
import * as proto from '../protocol/index.js';

export type ToolCallResult =
    | { ok: true; output: string }
    | { ok: false; error: string };

export type ToolRoundResult = {
    id: string;
    name: string;
    arguments: string;
    result: ToolCallResult;
};

export class ToolRegistry {

    private ctx: ToolContext;
    private tools: Map<string, Tool>;

    constructor(ctx: ToolContext) {
        this.ctx = ctx;

        this.tools = new Map();

        loadTools().forEach((factory => {
            try {
                const tool = factory(this.ctx);
                this.tools.set(tool.name(), tool);
            } catch (err: any) {
                console.error(`Failed to load tool: ${err}; skipping`);
            }
        }));
    }

    /**
     * Each tool may have preflight changes to completion requests. This method
     * iterates over each tool, allows it to mutate the request, and returns the
     * final request.
     */
    async beforeRequest(req: proto.CompletionRequest, opts: BeforeRequestOptions): Promise<proto.CompletionRequest> {
        for (const tool of this.tools.values()) {
            // Don't perform preflight changes if the tool was not included
            if (!req.tools) continue;
            if (-1 === req.tools.findIndex(t => t.function.name === tool.name())) continue;

            if (tool.beforeRequest) req = await tool.beforeRequest(req, opts);
        }

        return req;
    }

    /**
     * Injects tool definitions into the request body and runs all beforeRequest hooks.
     * 
     * Returns the new request body
     */
    async prepareTools(body: proto.CompletionRequest, opts: BeforeRequestOptions): Promise<proto.CompletionRequest> {
        const withTools = { ...body, tools: this.getToolDefinitions() };
        return this.beforeRequest(withTools, opts);
    }

    getToolDefinitions(): proto.ToolDefinition[] {
        return [...this.tools.values()].map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name(),
                description: tool.description(),
                parameters: toJSONSchema(tool.inputSchema()),
            },
        }));
    }

    async call(
        name: string,
        args: string,
        signal: AbortSignal,
        onProgress?: (toolCallId: string, event: ToolProgress) => void,
        toolCallId?: string,
    ): Promise<ToolCallResult> {
        const tool = this.tools.get(name);
        if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

        let parsed: unknown;
        try { parsed = JSON.parse(args); }
        catch { return { ok: false, error: `Invalid JSON arguments for ${name}` }; }

        const validated = tool.inputSchema().safeParse(parsed);
        if (!validated.success) {
            return { ok: false, error: `Validation failed: ${JSON.stringify(validated.error.issues)}` };
        }

        const emit: ToolEmit = (event) => {
            if (onProgress && toolCallId) onProgress(toolCallId, event);
        };

        try {
            const result = await tool.call(validated.data, signal, emit);
            return { ok: true, output: JSON.stringify(result) };
        } catch (err: any) {
            return { ok: false, error: err?.message ?? String(err) };
        }
    }

    /**
     * Runs all tool calls in a single round in parallel.
     * Uses Promise.allSettled so one failure doesn't block the others.
     */
    async executeToolRound(
        toolCalls: proto.AssistantToolCall[],
        signal: AbortSignal,
        onProgress?: (toolCallId: string, event: ToolProgress) => void,
    ): Promise<ToolRoundResult[]> {
        const promiseResults = await Promise.allSettled(
            toolCalls.map(tc => this.call(tc.function.name, tc.function.arguments, signal, onProgress, tc.id))
        );

        return toolCalls.map((tc, i) => {
            const promise = promiseResults[i]!;
            const result: ToolCallResult = promise.status === 'fulfilled'
                ? promise.value
                : { ok: false, error: String(promise.reason) };

            return {
                id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
                result,
            };
        });
    }
}
