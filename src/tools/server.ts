import express from 'express';
import chalk from 'chalk';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { toJSONSchema } from 'zod';

import loadTools from './loader.js';
import type { Tool, ToolContext } from './types.js';
import * as proto from '../protocol.js';

export type ToolCallResult =
    | { ok: true; output: string }
    | { ok: false; error: string };

export type ToolRoundResult = {
    id: string;
    name: string;
    arguments: string;
    result: ToolCallResult;
};

export class ToolServer {

    private app: express.Express;
    private registry: OpenAPIRegistry;

    private ctx: ToolContext;
    private tools: Map<string, Tool>;

    constructor(app: express.Express, ctx: ToolContext) {
        this.app = app;
        this.registry = new OpenAPIRegistry();
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
    async beforeRequest(req: proto.CompletionRequest): Promise<proto.CompletionRequest> {
        for (const tool of this.tools.values()) {
            // Don't perform preflight changes if the tool was not included
            if (!req.tools) continue;
            if (-1 === req.tools.findIndex(t => t.function.name === tool.name())) continue;

            if (tool.beforeRequest) req = await tool.beforeRequest(req);
        }

        return req;
    }

    getToolDefinitions(): proto.ToolDefinition[] {
        return [...this.tools.values()].map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name(),
                description: tool.description(),
                parameters: toJSONSchema(tool.inputSchema()),
                strict: tool.strict() || undefined,
            },
        }));
    }

    async call(name: string, args: string): Promise<ToolCallResult> {
        const tool = this.tools.get(name);
        if (!tool) return { ok: false, error: `Unknown tool: ${name}` };

        let parsed: unknown;
        try { parsed = JSON.parse(args); }
        catch { return { ok: false, error: `Invalid JSON arguments for ${name}` }; }

        const validated = tool.inputSchema().safeParse(parsed);
        if (!validated.success) {
            return { ok: false, error: `Validation failed: ${JSON.stringify(validated.error.issues)}` };
        }

        try {
            const result = await tool.call(validated.data);
            return { ok: true, output: JSON.stringify(result) };
        } catch (err: any) {
            return { ok: false, error: err?.message ?? String(err) };
        }
    }

    /**
     * Runs all tool calls in a single round in parallel.
     * Uses Promise.allSettled so one failure doesn't block the others.
     */
    async executeToolRound(toolCalls: proto.ToolCall[]): Promise<ToolRoundResult[]> {
        const promiseResults = await Promise.allSettled(
            toolCalls.map(tc => this.call(tc.function.name, tc.function.arguments))
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

    serve() {
        console.log(`Serving tool server endpoints:`);

        if (this.tools.size === 0) {
            console.log(` -> no tools loaded`);
            return;
        }

        // For each tool, serve endpoint at `/tools/toolName`
        for (const tool of this.tools.values()) {
            const toolName = tool.name();
            const pathKey = `/tools/${toolName}`;

            console.log(` -> serving tool: ${chalk.magenta(pathKey)}`);

            // this.registry.register(`${toolName}Input`, tool.inputSchema());
            // this.registry.register(`${toolName}Output`, tool.outputSchema());
            this.registry.registerPath({
                method: 'post',
                path: pathKey,
                operationId: toolName,
                description: tool.description(),
                request: {
                    body: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: tool.inputSchema(),
                            },
                        },
                    },
                },
                responses: {
                    200: {
                        description: 'Successful response',
                        content: {
                            'application/json': {
                                schema: tool.outputSchema(),
                            }
                        }
                    }
                }
            });

            // Express handler: POST /tools/{toolName}
            this.app.post(pathKey, express.json(), async (req, res, next) => {
                console.log(`tc: ${pathKey}`);
                console.log(`headers: ${JSON.stringify(req.headers, null, 2)}`);
                console.log(`===`)
                console.log(`body: ${JSON.stringify(req.body, null, 2)}`);

                const inputSchema = tool.inputSchema();

                try {
                    const parsed = inputSchema.parse(req.body);
                    const result = await tool.call(parsed);
                    res.json(result);
                } catch (err: any) {
                    console.error(`Error in tool "${toolName}":`, err);
                    return next(err);
                }
            });
        }

        const generator = new OpenApiGeneratorV3(this.registry.definitions);
        const openApiDoc = generator.generateDocument({
            openapi: "3.1.0",
            info: {
                title: 'llama-shim tool server',
                version: '1.0.0',
            },
        });

        // console.log(`spec: \n${JSON.stringify(openApiDoc, null, 2)}`);

        // Serve tool server spec for OWU
        this.app.get('/openapi.json', (_req, res) => {
            res.json(openApiDoc);
        });
    }
}