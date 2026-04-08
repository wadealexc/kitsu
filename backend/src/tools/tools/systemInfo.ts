import os from 'os';
import bytes from 'bytes';

import { z } from 'zod';
import type { Tool, ToolContext, ToolSession, ToolEmit } from '../types.js';

const InputSchema = z.object();
const OutputSchema = z.object({
    osArch: z.string(),
    osRelease: z.string(),
    hostname: z.string(),
    upTime: z.number(),
    memory: z.object({
        total: z.string(),
        available: z.string(),
    }),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

class SystemInfo implements Tool<Input, Output> {

    constructor(ctx: ToolContext) { }

    name(): string {
        return `systemInfo`;
    }

    description(): string {
        return (
`Retrieve information about the system on which this LLM is running:
- osArch: CPU architecture (e.g. x64)
- osRelease: Operating system release/version
- hostname: System hostname
- upTime: System uptime in seconds
- memory: Total and available memory`
        );
    }

    inputSchema(): z.ZodType<Input> {
        return InputSchema;
    }

    call(_input: Input, _session: ToolSession, _signal: AbortSignal, _emit: ToolEmit): Output {
        return {
            osArch: os.arch(),
            osRelease: os.release(),
            hostname: os.hostname(),
            upTime: os.uptime(),
            memory: {
                total: `${bytes(os.totalmem())}`,
                available: `${bytes(os.freemem())}`,
            },
        };
    }
}

export default function systemInfo(ctx: ToolContext): Tool<Input, Output> {
    return new SystemInfo(ctx);
}