import * as fs from 'fs';
import { stat } from 'fs/promises';
import path from 'path';

import { z } from 'zod';

const LlamaCppSchema = z.object({
    sleepAfterXSeconds: z.number().min(0).default(600),
});

/**
 * llama runner settings:
 *
 * ```json
 * "llamaCpp": {
 *     "sleepAfterXSeconds": number,                 // default: 600
 * }
 * ```
 */
export type LlamaCppConfig = z.infer<typeof LlamaCppSchema>;

const WebEnabledSchema = z.object({
    enable: z.literal(true),
    braveAPIKey: z.string().min(1, { message: "Brave API key is required if web is enabled" }),
    runDangerouslyWithoutSandbox: z.boolean().default(false),
    blacklistHosts: z.array(z.string()).default([]),
});

/// `looseObject` used here in case of including `WebEnabledSchema` keys when not enabled
const WebDisabledSchema = z.looseObject({
    enable: z.literal(false),
});

const WebSchema = z.union([WebDisabledSchema, WebEnabledSchema]);

/**
 * web search / webpage loader settings:
 *
 * ```json
 * "web": {
 *     "enable": boolean,                            // default: false
 *     "braveAPIKey": "your api key here",           // required if web.enable
 *     "runDangerouslyWithoutSandbox": boolean,      // default: false
 *     "blacklistHosts": string[],                   // default: []
 * }
 * ```
 */
export type WebConfig = z.infer<typeof WebSchema>;

const PortSchema = z.object({
    llamaCpp: z.object({
        port: z.coerce.number().default(8080),
        host: z.string().default('0.0.0.0'),
    }),
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
 *     "llamaCpp": {
 *         port: number,                             // default: 8080
 *         host: string                              // default: '0.0.0.0'
 *     },
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

const ModelEntrySchema = z.object({
    gguf: z.string(),
    mmproj: z.optional(z.string()),
    alias: z.optional(z.string()),
    args: z.optional(z.array(z.coerce.string())),
    params: z.record(z.string(), z.any()).optional(),
});

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

const ModelSchema = z.object({
    path: z.string().default('./models'),
    onStart: z.string().min(1, { message: "Startup model required - this should be the alias of one of the models you defined in config" }),
    models: z.array(ModelEntrySchema).min(1),
});

/**
 * Model settings:
 *
 * ```json
 * "models": {
 *     "path": string,                               // default: './models'
 *     "onStart": string,                            // OPTIONAL; default: first entry in `models`
 *     "models": [                                   // REQUIRED; model definitions
 *         {
 *             // Points to `./models/qwen/Qwen3-VL-30B-A3B-Thinking-Q6_K.gguf`
 *             "gguf": "qwen/Qwen3-VL-30B-A3B-Thinking-Q6_K",
 *             // OPTIONAL; points to `./models/qwen/mmproj-BF16.gguf`
 *             "mmproj": "qwen/mmproj-BF16",
 *             // OPTIONAL: API will serve model under this alias
 *             "alias": "qwen3-vl-30b",
 *             // OPTIONAL: Extra CLI args for llama-server
 *             "args": [
 *                 "--ctx-size",
 *                 50000
 *             ],
 *             // OPTIONAL: Inference defaults (temperature, system prompt, etc.)
 *             "params": { "temperature": 0.7, "system": "You are a helpful assistant." }
 *         }
 *     ]
 * }
 * ```
 */
export type ModelConfig = z.infer<typeof ModelSchema>;

// Main config schema with strict mode (rejects extra fields)
const ConfigSchema = z.object({
    llamaCpp: LlamaCppSchema,
    web: WebSchema,
    ports: PortSchema,
    logs: LogSchema,
    models: ModelSchema,
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
    config.models.path = path.resolve(configDir, config.models.path);

    // Ensure existence of each of the files referenced by the config
    await validateFilesExist(config);
    return config;
}

async function validateModelFiles(basePath: string, model: z.infer<typeof ModelEntrySchema>) {
    // Validate GGUF file exists
    let ggufPath = path.join(basePath, model.gguf);
    if (!ggufPath.endsWith('.gguf')) ggufPath += '.gguf';

    try {
        await stat(ggufPath);
    } catch (err: any) {
        throw new Error(`config error; could not find model.gguf: ${ggufPath}; err: ${err}`);
    }

    // Validate MMProj exists if specified
    if (model.mmproj) {
        let mmprojPath = path.join(basePath, model.mmproj);
        if (!mmprojPath.endsWith('.gguf')) mmprojPath += '.gguf';

        try {
            await stat(mmprojPath);
        } catch (err: any) {
            throw new Error(`config error; could not find model.mmproj: ${mmprojPath}; err: ${err}`);
        }
    }
}

async function validateFilesExist(config: Config) {
    try {
        const stats = await stat(config.logs.path);
        if (!stats.isDirectory()) throw new Error(`path is not a directory`);
    } catch (err: any) {
        throw new Error(`config error locating log path: ${config.logs.path}; err: ${err}`);
    }

    const modelConfig: ModelConfig = config.models;
    const basePath = modelConfig.path;

    for (const model of modelConfig.models) {
        await validateModelFiles(basePath, model);
    }
}
