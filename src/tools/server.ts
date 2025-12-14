import express from 'express';
import chalk from 'chalk';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";

import loadTools from './loader.js';
import type { Tool, ToolContext } from './types.js';

export class ToolServer {

    private app: express.Express;
    private registry: OpenAPIRegistry;

    private ctx: ToolContext;
    private tools: Record<string, Tool>;

    constructor(app: express.Express, ctx: ToolContext) {
        this.app = app;
        this.registry = new OpenAPIRegistry();
        this.ctx = ctx;
        this.tools = {};
    }

    async serve() {
        console.log(`Setting up tool server`);

        this.initTools();
        if (Object.values(this.tools).length === 0) {
            console.log(` -> no tools loaded`);
            return;
        }

        // For each tool, serve endpoint at `/tools/toolName`
        for (const tool of Object.values(this.tools)) {
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

    initTools() {
        loadTools().forEach(factory => {
            try {
                const tool = factory(this.ctx);
                this.tools[tool.name()] = tool;
            } catch (err: any) {
                console.error(`Failed to load tool: ${err}; skipping`);
            }
        });
    }
}