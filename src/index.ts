import * as fs from 'fs';
import { PassThrough } from 'stream';
import path, { basename } from 'path';
import { spawn, ChildProcess } from 'child_process';
import fetch, { type RequestInit, Response } from 'node-fetch';

import express from 'express';
import chalk, { type ChalkInstance } from 'chalk';
import bytes from 'bytes';

import * as utils from './utils.js';
import { LlamaManager } from './llamaManager.js';
import { readConfig } from './config.js';

type ChatResponse = {
    created: number,
    id: string,
    model: string,
    system_fingerprint: string,
    object: string,
    timings?: any,
    choices: ChatChoice[],
};

type ChatChoice = {
    finish_reason: string | null,
    index: number,
    delta: {
        content?: string,
        reasoning_content?: string,
    }
};

/* -------------------- CONFIGURATION -------------------- */
const EXTERNAL_PORT = 8081;                     // Port the proxy listens on
const INTERNAL_PORT = 8080;                     // Port llama‑server runs on
const HOST_IP = utils.getLanIPv4();             // Our ip address

const LLAMA_SERVER_URL = `http://${HOST_IP}:${INTERNAL_PORT}`; // URL for underlying llama.cpp server
const LLAMA_SHIM_URL = `http://${HOST_IP}:${EXTERNAL_PORT}`;   // URL we expose to frontend

// Check for 'verbose' option for llama-server verbosity
const LLAMA_SERVER_VERBOSITY = process.argv.slice(2).includes('-vb');

const CONFIG_PATH = './shim-config.json';
const cfg = readConfig(CONFIG_PATH);

// Find all models recursively in MODEL_FILES_PATH and check for the default model
const MODELS = utils.findModels(cfg.MODEL_FILES_PATH);
if (MODELS.length === 0) {
    console.error('No local GGUF models found in the working directory.');
    process.exit(1);
}

// ensure log directory exists
try { fs.mkdirSync(cfg.LOG_DIR, { recursive: true }); } catch (e) {
    console.error('Failed to create log dir', e);
    process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFilePrefix = `llama-${timestamp}`

const chatPath = path.join(cfg.LOG_DIR, `${logFilePrefix}.chat.json`);
const chatLogs: any[] = [];
const chatStream: fs.WriteStream = fs.createWriteStream(chatPath, { flags: 'a' });

/* -------------------- INIT LLAMA AND EXPRESS -------------------- */

const app = express();
app.use(express.raw({ type: (() => true), limit: '50mb' }));

app.listen(EXTERNAL_PORT, () => {
    console.log(`llama-shim listening on ${chalk.cyan(LLAMA_SHIM_URL)}`);
});

// Start llama-server
const llama = new LlamaManager({
    llamaServerIP: HOST_IP, llamaServerPort: INTERNAL_PORT, llamaServerVerbose: LLAMA_SERVER_VERBOSITY,
    logDirectory: cfg.LOG_DIR, logFilePrefix: logFilePrefix,
    sleepAfterXSeconds: cfg.SLEEP_AFTER_X_SECONDS,
    modelFiles: MODELS, defaultModelName: cfg.DEFAULT_MODEL,
});

/* -------------------- ROUTES -------------------- */

/**
 * /v1/models – return list of local models
 * TODO - use llamaManager instead
 * TODO - return richer info
 */
app.get('/v1/models', async (_req, res) => {
    try {
        const data = MODELS.map(p => ({
            id: utils.modelNameFromPath(p),
            object: 'model',
            owned_by: 'llamacpp',
        }));
        res.json({ object: 'list', data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list models' });
    }
});

/**
 * Proxy all other routes to the internal llama‑server
 */
app.all('/{*splat}', async (req, res) => {
    let body = req.body || {};

    // request: X / response: X will be logged
    let chatLog: {
        request?: any,
        response?: any,
    } = {};

    // Convert request body to JSON
    if (Buffer.isBuffer(body) && req.headers['content-type']?.includes('application/json')) {
        try {
            body = JSON.parse(body.toString('utf8'));
            chatLog.request = body;
        } catch (e) {
            console.warn('Failed to parse request body:', e);
        }
    }

    // As the response comes back from llama-server, we'll collect it
    // here so we can log it without getting in the way of the shim response.
    //
    // The response is formatted as SSE (server-sent events).
    // https://platform.openai.com/docs/api-reference/chat-streaming
    const passThrough = new PassThrough();
    const chunks: Buffer<any>[] = [];

    passThrough.on('data', chunk => chunks.push(Buffer.from(chunk)));
    passThrough.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');

        // Try to decode as JSON
        try {
            chatLog.response = JSON.parse(body);
            chatLogs.push(chatLog);
            return;
        } catch (e) {
            // This won't be JSON if the request was made with `stream: true`
            // Swallow error, handle below
        }

        // Parse SSE 'data' events
        if (!chatLog.response) {
            // This should give us an array of JSON strings representing various streamed tokens
            chatLog.response = body.split('data: ').reduce<ChatResponse[]>((accum, event) => {
                try {
                    accum.push(JSON.parse(event.trim()));
                } catch {

                }

                return accum;
            }, []);
        }

        if (!chatLog.response) {
            console.error('failed to decode llama-server response');
            return;
        }

        // Combine streamed ChatResponse deltas into a single ChatResponse for logs
        let finalResponse: ChatResponse | null = null;
        let finalContent: string = '';
        let finalReasoningContent: string = '';

        (chatLog.response as ChatResponse[]).forEach(response => {
            const choice = response.choices.at(0) as ChatChoice;

            if (choice.delta.content) {
                finalContent += choice.delta.content;
            }

            if (choice.delta.reasoning_content) {
                finalReasoningContent += choice.delta.reasoning_content;
            }

            finalResponse = {
                ...response,
                choices: [{
                    ...choice,
                    delta: {
                        content: finalContent,
                        reasoning_content: finalReasoningContent,
                    }
                }]
            }
        })

        if (!finalResponse) {
            console.error(`llama-server response in unknown format`);
            return;
        }

        chatLog.response = finalResponse;
        chatLogs.push(chatLog);
    });

    let llamaResponse: Response | null = null;
    try {
        // If our requested model isn't loaded, wait here
        await llama.ready(body.model as string);

        // Forward request to llama-server. If llama is busy, we'll wait here.
        llamaResponse = await llama.forwardRequest({
            originalURL: req.originalUrl,
            headers: req.headers,
            method: req.method,
            body: req.body
        });

        // copy headers and status from upstream
        res.status(llamaResponse.status);
        llamaResponse.headers.forEach((v, k) => res.setHeader(k, v));

        passThrough.once('error', err => {
            console.error('passThrough error', err);
            res.destroy(err);
        });

        llamaResponse.body?.once('error', err => {
            console.error('upstream body error', err);
            passThrough.destroy(err);
        });

        // Stream llama-server response to both the client as well as our logs
        llamaResponse.body?.pipe(passThrough).pipe(res);
    } catch (err: any) {
        console.error('Proxy error:', err);
        res.status(502).json({ error: err.message || 'Bad gateway' });
    } finally {
        const len = req.headers['content-length'] ?? '0';

        console.log(`${req.method}: ${chalk.yellow(req.originalUrl)} (req len: ${bytes(Number(len))})`);
        if (!llamaResponse) {
            console.log(chalk.dim.red(` -> failed before request made to llama-server`));
            console.log(chalk.dim.red(` -> request: \n${JSON.stringify(chatLog.request, null, 2)}`));
        } else if (llamaResponse.status === 200) {
            console.log(chalk.dim.green(` -> llama-server responds success (200)`));
        } else {
            console.log(chalk.dim.yellow(` -> llama-server responds with (${llamaResponse.status})`));
        }
    }
});

/* -------------------- STOP SERVER -------------------- */

async function shutdown(signal: string) {
    console.log(`received shutdown signal: ${signal}`);

    await Promise.allSettled([
        // 1. Kill llama-server if it's running
        new Promise<void>(async (resolve) => {
            try { await llama.stopServer() }
            catch (err) { console.error(`shutdown: llama.stopServer failed: `, err) }
            finally { resolve() }
        }),
        // 2. Write chat logs to file
        new Promise<void>(async (resolve) => {
            chatStream.once('finish', resolve);
            chatStream.once('error', (err) => {
                console.error(`shutdown: error writing logs to file: `, err);
                resolve();
            });

            // Actually do the write, then close the file
            chatStream.write(JSON.stringify(chatLogs, null, 2));
            chatStream.end();
        })
    ]);

    console.log('goodbye!');
}

// Listen to OS signals, shutdown llama if needed
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.once(signal, async () => {
        await shutdown(signal);
        process.exit(0);
    });
}

// Shutdown if we have any uncaught errors
for (const evt of ['uncaughtException', 'unhandledRejection'] as const) {
    process.once(evt, async (err) => {
        console.error(evt, err);
        await shutdown('SIGTERM');
        process.exit(1);
    });
}

process.once('exit', () => {
    // Attempt last-ditch cleanup, sending SIGKILL if we still have a process running
    try { llama.forceStopServer() } catch { };
});