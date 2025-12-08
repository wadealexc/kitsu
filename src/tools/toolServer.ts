import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

import express from 'express';
import chalk from 'chalk';
import type { Browser } from '../browser/browser.js';

export type JsonSchema =
    | {
        type: 'string' | 'number' | 'integer' | 'boolean' | 'null';
        description?: string;
        enum?: (string | number | boolean | null)[];
    }
    | {
        type: 'object';
        description?: string;
        properties: Record<string, JsonSchema>;
        required?: string[];
        additionalProperties?: boolean;
    }
    | {
        type: 'array';
        description?: string;
        items: JsonSchema;
    };

// Generic types let you keep type safety for each tool
export interface Tool<Input = unknown, Output = unknown> {
    name: () => string;
    description: () => string;
    strict: () => boolean;

    /**
     * JSON Schema for the input object (what the LLM will send).
     * For tools with no parameters, return an empty object schema.
     */
    inputSchema: () => JsonSchema;

    /**
     * JSON Schema for the output value (what the tool returns).
     */
    outputSchema: () => JsonSchema;

    /**
     * Calls the tool at runtime
     */
    call: (input: Input) => Promise<Output> | Output;
}

export type ToolContext = {
    browser: Browser | undefined,
}

export type ToolFactory = (ctx: ToolContext) => Tool;

// Minimal OpenAPI 3.1 document type
type OpenAPIDoc = {
    openapi: string;
    info: {
        title: string;
        version: string;
    };
    paths: Record<string, any>;
    components?: {
        schemas?: Record<string, JsonSchema>;
    };
};

export class ToolServer {
    private app: express.Express;

    private tools: Record<string, Tool> | null = null;
    private ctx: ToolContext;

    constructor(app: express.Express, ctx: ToolContext) {
        this.app = app;
        this.ctx = ctx;
    }

    async serve() {
        await this.#loadTools();
        if (!this.tools) {
            console.log(`ToolServer: no tools loaded`);
            return;
        }

        const spec: OpenAPIDoc = {
            openapi: '3.1.0',
            info: {
                title: 'llama-shim tool server',
                version: '1.0.0',
            },
            paths: {},
            components: {
                schemas: {},
            },
        };

        // For each tool, mount POST /tools/{toolName} and add to OpenAPI paths
        for (const tool of Object.values(this.tools)) {
            const toolName = tool.name();
            const pathKey = `/tools/${toolName}`;

            console.log(`serving tool: ${chalk.magenta(pathKey)}`);

            // Express handler: POST /tools/{toolName}
            this.app.post(pathKey, express.json(), async (req, res, next) => {
                try {
                    const result = await tool.call(req.body ?? {});
                    res.json(result);
                } catch (err: any) {
                    console.error(`Error in tool "${toolName}":`, err);
                    return next(err);
                }
            });

            // OpenAPI: define input and output schemas
            const inputSchema = tool.inputSchema();
            const outputSchema = tool.outputSchema();

            // Optionally register schemas by name under components/schemas
            const inputSchemaName = `${toolName}Input`;
            const outputSchemaName = `${toolName}Output`;

            spec.components!.schemas![inputSchemaName] = inputSchema;
            spec.components!.schemas![outputSchemaName] = outputSchema;

            spec.paths[`/${toolName}`] = {
                post: {
                    operationId: toolName,
                    description: tool.description(),
                    'x-openai-isStrict': tool.strict(), // OpenAI-compatible extension
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    $ref: `#/components/schemas/${inputSchemaName}`,
                                },
                            },
                        },
                    },
                    responses: {
                        '200': {
                            description: 'Successful response',
                            content: {
                                'application/json': {
                                    schema: {
                                        $ref: `#/components/schemas/${outputSchemaName}`,
                                    },
                                },
                            },
                        },
                    },
                },
            };
        }

        // console.log(`spec:\n${JSON.stringify(spec, null, 2)}`);

        this.app.get('/tools/openapi.json', (_req, res) => {
            res.json(spec);
        });
    }

    /**
     * Dynamically loads all tool modules from the tools directory.
     * Validates runtime compatibility with Tool.
     */
    async #loadTools() {
        const toolsDir = path.join('src', 'tools');
        const files = fs.readdirSync(toolsDir);

        this.tools = {};

        for (const file of files) {
            if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;

            try {
                const filePath = path.join(toolsDir, file);
                const moduleUrl = pathToFileURL(filePath).href;
                const mod = await import(moduleUrl);

                const exported = mod.default ?? mod;

                let tool: Tool | null = null;

                if (typeof exported === 'function') {
                    // Treat as ToolFactory
                    tool = (exported as ToolFactory)(this.ctx);
                } else {
                    tool = exported as Tool;
                }

                if (
                    tool &&
                    typeof tool.name === 'function' &&
                    typeof tool.description === 'function' &&
                    typeof tool.call === 'function' &&
                    typeof tool.strict === 'function' &&
                    typeof tool.inputSchema === 'function' &&
                    typeof tool.outputSchema === 'function'
                ) {
                    const toolName = tool.name();
                    this.tools[toolName] = tool;
                    console.log(`loaded tool: ${chalk.green(toolName)}`);
                } else {
                    console.warn(`Skipping "${file}" - module does not implement Tool/ToolFactory`);
                }
            } catch (err: any) {
                console.error(`Failed to load tool "${file}": ${err?.stack ?? err}`);
            }
        }
    }
}