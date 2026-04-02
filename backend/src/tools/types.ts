import { z } from 'zod';

import type { Browser } from '../browser/browser.js';
import * as proto from '../protocol/index.js';

export type BeforeRequestOptions = { webSearchEnabled: boolean };

/** Progress event emitted by a tool during execution. */
export type ToolProgress = {
    type: string;
    data: unknown;
};

/** Callback passed to Tool.call for emitting progress events. */
export type ToolEmit = (event: ToolProgress) => void;

export interface Tool<Input = unknown, Output = unknown> {
    name: () => string;
    description: () => string;
    /**
     * What the LLM will send. For tools with no parameters, return
     * an empty object schema.
     */
    inputSchema: () => z.ZodType<Input>;

    /**
     * Calls the tool at runtime
     */
    call: (input: Input, signal: AbortSignal, emit: ToolEmit) => Promise<Output> | Output;

    /**
     * Allows the tool to modify a request's messages before being passed to a model
     * @returns the new completion request object
     */
    beforeRequest?: (req: proto.CompletionRequest, opts: BeforeRequestOptions) => proto.CompletionRequest | Promise<proto.CompletionRequest>;
}

export type ToolContext = {
    browser: Browser | undefined,
}

export type ToolFactory<Input, Output> = (ctx: ToolContext) => Tool<Input, Output>;