import * as fs from 'fs';
import { PassThrough } from 'stream';
import path from 'path';
import { type Response } from 'node-fetch';

import express from 'express';
import chalk from 'chalk';
import bytes from 'bytes';

import * as utils from './utils.js';
import { LlamaManager } from './llamaManager.js';
import { browserInit, type Browser, type SearchRequest, type SearchResponse } from './browser/browser.js';
import { readConfig } from './config.js';
import * as proto from './protocol.js';

/* -------------------- CONFIGURATION -------------------- */
const EXTERNAL_PORT = 8081;                     // Port the proxy listens on
const INTERNAL_PORT = 8080;                     // Port llama‑server runs on
const HOST_IP = utils.getLanIPv4();             // Our ip address

const LLAMA_SERVER_URL = `http://${HOST_IP}:${INTERNAL_PORT}`; // URL for underlying llama.cpp server
const LLAMA_SHIM_URL = `http://${HOST_IP}:${EXTERNAL_PORT}`;   // URL we expose to frontend

// Check for 'verbose' option for llama-server verbosity
const LLAMA_SERVER_VERBOSITY = process.argv.slice(2).includes('-vb');

const CONFIG_PATH = './config.json';
const cfg = await readConfig(CONFIG_PATH);

// ensure log directory exists
try { fs.mkdirSync(cfg.logs.path, { recursive: true }); } catch (e) {
    console.error('Failed to create log dir', e);
    process.exit(1);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFilePrefix = `llama-${timestamp}`

const chatPath = path.join(cfg.logs.path, `${logFilePrefix}.chat.json`);
let logger: {
    logs: any[],
    stream: fs.WriteStream,
} | undefined = undefined;

if (cfg.logs.enable) {
    logger = {
        logs: [],
        stream: fs.createWriteStream(chatPath, { flags: 'a' }),
    };
}

/* -------------------- INIT LLAMA AND EXPRESS -------------------- */

const app = express();
app.use(express.raw({ type: (() => true), limit: '50mb' }));

app.listen(EXTERNAL_PORT, () => {
    console.log(`llama-shim listening on ${chalk.cyan(LLAMA_SHIM_URL)}`);
});

// Start llama-server
const llama = new LlamaManager({
    llamaServerIP: HOST_IP, llamaServerPort: INTERNAL_PORT, llamaServerVerbose: LLAMA_SERVER_VERBOSITY,
    logDirectory: cfg.logs.path, logFilePrefix: logFilePrefix,
    sleepAfterXSeconds: cfg.llamaCpp.sleepAfterXSeconds,
    models: cfg.models,
});

/* -------------------- ROUTES -------------------- */

/**
 * /v1/models – return list of local models
 * TODO - return richer info
 */
app.get('/v1/models', async (_req, res) => {
    try {
        const data = llama.getFrontendModels().map(name => ({
            id: name,
            object: 'model',
            owned_by: 'llamacpp',
        }));
        res.json({ object: 'list', data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to list models' });
    }
});

app.post('/v1/chat/completions', async (req, res) => {
    let request: proto.CompletionRequest;

    // Basic request info for logging
    const requestLen = req.headers['content-length'] ?? '0';
    const requestInfo = `${req.method}: ${chalk.yellow(req.originalUrl)} (req len: ${bytes(Number(requestLen))})`;

    // Convert request body to JSON. Typically this is automatically done by middleware like
    // app.use(express.json()), but in our case we want express.raw() so that we can pass
    // the request through to llama-server (mostly) untouched.
    //
    // However, we do still need to use/validate the request, so we do some conversion here.
    if (Buffer.isBuffer(req.body) && req.headers['content-type']?.includes('application/json')) {
        try {
            request = JSON.parse(req.body.toString('utf8'));
            // console.log(`request: \n${JSON.stringify(request, null, 2)}`);
        } catch (e) {
            throw new Error(`failed to parse request body: ${e}`);
        }
    } else {
        throw new Error(`/v1/chat/completions: unexpected input for request: ${JSON.stringify(req.body, null, 2)}`);
    }

    // Swap to vision model if the message stream has any images
    const useVision = request.messages.findIndex(msg => {
        if (typeof msg.content === 'string') return false;
        return msg.content.find(part => part.type === 'image_url');
    }) !== -1;

    // Wait for our requested model to be ready
    try { await llama.ready(request.model, useVision) } catch (err: any) {
        console.log(requestInfo);
        console.log(chalk.dim.red(` -> failed while waiting for requested model`));
        console.log(chalk.dim.red(` -> request: \n${JSON.stringify(request, null, 2)}`));
        console.log(chalk.dim.red(` -> error: ${err}`));

        res.status(502).json({ error: err.message || `unknown error while waiting for model: ${request.model}` });
        return;
    }

    // Forward request to llama-server
    let llamaResponse: Response | null = null;
    let contentType: string | null = null;
    try {
        llamaResponse = await llama.forwardRequest({
            originalURL: req.originalUrl,
            headers: req.headers,
            method: req.method,
            body: req.body
        });

        contentType = llamaResponse.headers.get("content-type");
        // copy headers and status from upstream
        res.status(llamaResponse.status);
        llamaResponse.headers.forEach((v, k) => res.setHeader(k, v));
    } catch (err: any) {
        console.log(requestInfo);
        console.log(chalk.dim.red(` -> failed when forwarding request to llama-server`));
        console.log(chalk.dim.red(` -> request: \n${JSON.stringify(request, null, 2)}`));
        console.log(chalk.dim.red(` -> error: ${err}`));

        res.status(502).json({ error: err.message || `unknown error forwarding request to llama-server` });
        return;
    }

    // Should not be reachable
    if (llamaResponse === null || contentType === null) {
        throw new Error(`unknown error; null llamaResponse or contentType`);
    }

    // Log request + status
    if (llamaResponse.status !== 200) {
        console.log(requestInfo);

        // Try to decode the error
        let internalMessage: string;
        try {
            const chunks = [];
            for await (const chunk of llamaResponse.body!) {
                chunks.push(chunk);
            }

            // `chunks` can contain Buffers or strings. concat expects buffer, so ensure
            // chunks are buffers before calling concat.
            const buffer = Buffer.concat(chunks.map(c => (Buffer.isBuffer(c) ? c : Buffer.from(c))));
            const body = buffer.toString('utf8');

            internalMessage = JSON.parse(body).error?.message as string;
        } catch (e: any) {
            internalMessage = 'could not decode error';
        }

        console.log(chalk.dim.yellow(` -> llama-server responds with (${llamaResponse.status}: ${internalMessage})`));
        res.status(500).json({ error: 'llama-server error: ' + internalMessage });
        return;
    } else {
        console.log(requestInfo);
        console.log(chalk.dim.green(` -> llama-server responds success (200); content: ${contentType}`));
    }

    // Write logs and clean up after response is finished
    const finish = ((response?: proto.CompletionResponse) => {
        logger?.logs.push({
            request: request,
            response: response
        });

        passThrough.end();
        res.end();
    });

    // As the response comes back from llama-server, we'll collect it
    // here so we can log it without getting in the way of the shim response.
    const passThrough = new PassThrough();
    const chunks: Buffer<any>[] = [];
    passThrough.on('data', chunk => chunks.push(Buffer.from(chunk)));
    passThrough.once('end', () => {
        const responseString = Buffer.concat(chunks).toString('utf8');

        // Handle streamed vs static response
        let response: proto.CompletionResponse | undefined;
        try {
            if (contentType.includes("text/event-stream")) {
                response = handleStreamedResponse(responseString);
            } else {
                response = handleStaticResponse(responseString);
            }
        } catch (err: any) {
            console.error(`error handling llama-server response: ${err}`);
        }

        finish(response);
    });

    passThrough.once('error', err => {
        console.error('passThrough error', err);
        finish();
    });

    llamaResponse.body?.once('error', err => {
        console.error('upstream body error', err);
        finish();
    });

    // Stream response to client (as well as our logging/caching system)
    llamaResponse.body?.pipe(passThrough).pipe(res);
});

// app.put('/pdf/process', async (req, res) => {
//     console.log(`got pdf extract request (${req.originalUrl})`);
//     console.log(`headers: ${JSON.stringify(req.headers, null, 2)}`);
//     console.log(`method: ${req.method}`);
//     console.log(`body size: ${req.body?.length}`);

//     // Format originally from: https://github.com/open-webui/open-webui/discussions/17621
//     // (backend/open_webui/retrieval/loaders/external_document.py)
//     let result = [
//         {
//             "page_content": "hello world",
//             "metadata": {
//                 "source": "bingus",
//                 "page": 1,
//                 "extraction_method": "dummy thicc",
//                 "total_pages": 1,
//                 "ocr_language": "bongus",
//             }
//         }
//     ]

//     res.send(result);
// });

// If web browser is enabled, start it and define an endpoint
let browser: Browser | undefined = undefined;
if (cfg.web.enable) {
    browser = await browserInit(
        cfg.web.braveAPIKey,
        cfg.web.runDangerouslyWithoutSandbox,
        cfg.web.screenshotWebpages,
    );

    app.post('/web/search', async (req, res) => {
        // Basic request info for logging
        const requestLen = req.headers['content-length'] ?? '0';
        const requestInfo = `${req.method}: ${chalk.yellow(req.originalUrl)} (req len: ${bytes(Number(requestLen))})`;

        // Convert request body to JSON
        let request: SearchRequest;
        try { request = JSON.parse(req.body.toString('utf8')) } catch (e) {
            console.log(`failed to parse request body: ${e}`);
            res.status(500).json({ error: `/web/search error: malformed request body` });
            return;
        }

        // Perform web search and start loading pages in background
        let response: SearchResponse[];
        try { response = await browser!.search(request, true) } catch (err: any) {
            console.log(`/web/search: search failed: ${err}`);
            res.status(500).json({ error: `/web/search: search failed: ${err}` });
            return;
        }

        // Log results from brave API and return
        console.log(requestInfo);
        console.log(chalk.dim(` -> "${request.query}" (got ${response.length} results)`));

        res.send(response);
    });
}

app.all('/{*splat}', async (req, res) => {
    console.log(`got unknown request to: ${req.originalUrl}`);
    console.log(`headers: ${JSON.stringify(req.headers, null, 2)}`);
    console.log(`method: ${req.method}`);
    // console.log(`body: ${req.body}`);
    // console.log(`${JSON.stringify(req, null, 2)}`);

    res.send('result text');
});

function handleStaticResponse(responseString: string): proto.CompletionResponse {
    try { return JSON.parse(responseString) } catch (err: any) {
        throw new Error(`handleStaticResponse: error decoding response: ${err}`);
    }
}

// When streamed, the response is formatted as SSE (server-sent events).
// https://platform.openai.com/docs/api-reference/chat-streaming
function handleStreamedResponse(responseString: string): proto.CompletionResponse {
    // This should give us an array of JSON strings representing various streamed tokens
    let responseDeltas = responseString.split('data: ').reduce<proto.CompletionResponse[]>((accum, event) => {
        try { accum.push(JSON.parse(event.trim())) } catch { }

        return accum;
    }, []);

    let finalResponse: proto.CompletionResponse | null = null;
    let finalDelta: proto.ChatDelta = {
        role: "",
        content: "",
        reasoning_content: "",
    };

    // Combine streamed CompletionResponse deltas into a single CompletionResponse
    responseDeltas.forEach(responseDelta => {
        const choice = responseDelta.choices.at(0)!;

        if (choice.delta.role) {
            finalDelta.role = choice.delta.role;
        }

        if (choice.delta.content) {
            finalDelta.content += choice.delta.content;
        }

        if (choice.delta.reasoning_content) {
            finalDelta.reasoning_content += choice.delta.reasoning_content;
        }

        if (choice.delta.refusal) {
            finalDelta.refusal = choice.delta.refusal;
        }

        if (choice.delta.tool_calls) {
            finalDelta.tool_calls = choice.delta.tool_calls;
        }

        finalResponse = {
            ...responseDelta,
            choices: [{
                ...choice,
                delta: finalDelta
            }]
        };
    });

    if (!finalResponse) {
        throw new Error(`handleStreamedResponse: empty final response`);
    }

    return finalResponse;
}

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
        // 2. Close browser if it's running
        new Promise<void>(async (resolve) => {
            try { if (browser) await browser.shutdown() }
            catch (err) { console.error(`shutdown: browser.shutdown failed: `, err) }
            finally { resolve() }
        }),
        // 3. Write chat logs to file
        new Promise<void>(async (resolve) => {
            if (!logger) {
                resolve();
                return;
            }

            logger.stream.once('finish', resolve);
            logger.stream.once('error', (err) => {
                console.error(`shutdown: error writing logs to file: `, err);
                resolve();
            });

            // Actually do the write, then close the file
            logger.stream.write(JSON.stringify(logger.logs, null, 2));
            logger.stream.end();
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