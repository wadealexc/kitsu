import os from 'os';
import bytes from 'bytes';

import type { Tool, JsonSchema } from './toolServer.js';

type Info = {
    osArch: string;
    osRelease: string;
    hostname: string;
    upTime: number;
    memory: {
        total: string;
        available: string;
    };
};

// Empty input object (no params)
type Input = Record<string, never>;

const inputSchema: JsonSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
    description: '',
};

const outputSchema: JsonSchema = {
    type: 'object',
    description: 'Information about the host system',
    properties: {
        osArch: {
            type: 'string',
            description: 'CPU architecture (e.g., x64)',
        },
        osRelease: {
            type: 'string',
            description: 'Operating system release/version',
        },
        hostname: {
            type: 'string',
            description: 'System hostname',
        },
        upTime: {
            type: 'number',
            description: 'System uptime in seconds',
        },
        memory: {
            type: 'object',
            description: 'Memory statistics',
            properties: {
                total: {
                    type: 'string',
                    description: 'Total system memory, human-readable',
                },
                available: {
                    type: 'string',
                    description: 'Available system memory, human-readable',
                },
            },
            required: ['total', 'available'],
            additionalProperties: false,
        },
    },
    required: ['osArch', 'osRelease', 'hostname', 'upTime', 'memory'],
    additionalProperties: false,
};

const systemInfo: Tool<Input, Info> = {
    name(): string {
        return `systemInfo`;
    },

    description(): string {
        return (`Retrieve information about the system on which this LLM is running.`);
    },

    strict(): boolean {
        return true;
    },

    inputSchema(): JsonSchema {
        return inputSchema;
    },

    outputSchema(): JsonSchema {
        return outputSchema;
    },

    call(): Info {
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
    },
};

export default systemInfo;
