import * as fs from 'fs';
import { stat } from 'fs/promises';
import path from 'path';

import { z } from 'zod';

const PortSchema = z.object({
    backend: z.object({
        port: z.coerce.number().default(8081),
        host: z.string().default('0.0.0.0'),
    }),
});

/**
 * Port settings:
 *
 * ```json
 * "ports": {
 *     "backend": {
 *         port: number,                             // default: 8081
 *         host: string                              // default: '0.0.0.0'
 *     },
 * }
 * ```
 */
export type PortConfig = z.infer<typeof PortSchema>;

const LogSchema = z.object({
    path: z.string().default('./logs'),
    enable: z.boolean().default(false),
});

/**
 * logger settings:
 *
 * ```json
 * "logs": {
 *     "path": string,                               // default: './logs'
 *     "enable": boolean,                            // default: false
 * }
 * ```
 */
export type LogConfig = z.infer<typeof LogSchema>;

/**
 * llama-manager, which runs inference (usually on another machine).
 *
 * ```json
 * "llamaManager": {
 *     "url": "http://192.168.87.30:10001"
 * }
 * ```
 */
const LlamaManagerSchema = z.object({
    url: z.url(),
});

export type LlamaManagerConfig = z.infer<typeof LlamaManagerSchema>;

// Main config schema with strict mode (rejects extra fields)
const ConfigSchema = z.object({
    ports: PortSchema,
    logs: LogSchema,
    llamaManager: LlamaManagerSchema,
}).strict();

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Read the JSON file given by `path`, and return application config
 */
export async function readConfig(configPath: string): Promise<Config> {
    let config: Config;
    try {
        // Read basic config from `configPath`
        const configJSON = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config = ConfigSchema.parse(configJSON);
    } catch (err: any) {
        throw new Error(`readConfig: validation failed when reading file ${configPath}. Err: ${err}`);
    }

    // Resolve paths relative to the config file's directory, so consumers
    // get absolute paths regardless of CWD
    const configDir = path.dirname(path.resolve(configPath));
    config.logs.path = path.resolve(configDir, config.logs.path);

    // Ensure existence of each of the files referenced by the config
    await validateFilesExist(config);
    return config;
}

async function validateFilesExist(config: Config) {
    try {
        const stats = await stat(config.logs.path);
        if (!stats.isDirectory()) throw new Error(`path is not a directory`);
    } catch (err: any) {
        throw new Error(`config error locating log path: ${config.logs.path}; err: ${err}`);
    }
}
