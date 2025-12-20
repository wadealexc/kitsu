import express from 'express';
import chalk from 'chalk';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

import loadTools from './loader.js';
import type { Tool, ToolContext } from './types.js';
import * as proto from '../protocol.js';

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
            if (tool.beforeRequest) req = await tool.beforeRequest(req);
        }

        return req;
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