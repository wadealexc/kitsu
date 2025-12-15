import { z } from '../config.js';

import type { Browser } from '../browser/browser.js';

export interface Tool<Input = unknown, Output = unknown> {
    name: () => string;
    description: () => string;
    strict: () => boolean;

    /**
     * What the LLM will send. For tools with no parameters, return
     * an empty object schema.
     */
    inputSchema: () => z.ZodType<Input>;

    /**
     * What the tool returns to the LLM.
     */
    outputSchema: () => z.ZodType<Output>;

    /**
     * Calls the tool at runtime
     */
    call: (input: Input) => Promise<Output> | Output;
}

export type ToolContext = {
    browser: Browser | undefined,
}

export type ToolFactory<Input, Output> = (ctx: ToolContext) => Tool<Input, Output>;