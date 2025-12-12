import * as fs from 'fs';
import { PassThrough } from 'stream';
import path from 'path';
import { type Response, Headers } from 'node-fetch';

import express from 'express';
import chalk from 'chalk';
import bytes from 'bytes';

import * as utils from './utils.js';
import { LlamaManager, type LlamaResponse } from './llama/llamaManager.js';
import * as Browser from './browser/browser.js';
import { readConfig } from './config.js';
import * as proto from './protocol.js';
import { ToolServer } from './tools/server.js';

/* -------------------- EXPRESS TYPINGS -------------------- */

type RequestBody<T> = express.Request<{}, any, T>;

type LlamaStatus = {
    status: number,
    headers: Headers,
    usage?: {
        tps: number,
        inputTokens: number,
        outputTokens: number,
    }
};

type SearchStatus = {
    query: string,
    results: number,
};

type LoadStatus = {
    successful: number,
    total: number,
};

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

// Per-request logging
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const start = process.hrtime.bigint();

    // TODO - correlate logs/requests via ID
    // res.locals.logContext = {
    //     requestId: crypto.randomUUID(), 
    // };

    // Fire logs for non-GET requests once the response is 100% complete
    if (req.method !== 'GET') {
        res.once('finish', () => {
            const end = process.hrtime.bigint();
            const durationSec = Number(end - start) / 1_000_000_000;
            const durationStr = `${durationSec.toFixed(3)} sec`;

            // Pretty-print request info, e.g:
            // POST: /v1/chat/completions (request: 1.13KB) (elapsed: 1.3 sec)
            //
            // TODO - add response size? output in tokens?
            const requestLen = req.headers['content-length'] ?? '0';
            const requestInfo =
                `${req.method}: ${chalk.yellow(req.originalUrl)}`
                + ` (request: ${bytes(Number(requestLen))})`
                + ` (elapsed: ${durationStr})`;

            console.log(requestInfo);

            // TODO - better typing instead of if/else hell
            if (res.locals.error) {
                const err = res.locals.error?.message;
                console.error(chalk.dim.red(` -> error: ${err}`));
                // console.error(chalk.dim.red(` -> request:\n${JSON.stringify(req, null, 2)}`));
            } else if (res.locals.llama) {
                const llama = res.locals.llama as LlamaStatus;
                console.log(chalk.dim.green(` -> llama response ok (code: ${llama?.status} | ${llama?.headers.get('content-type')})`));
                if (llama.usage) {
                    const tIn = llama.usage.inputTokens;
                    const tOut = llama.usage.outputTokens;
                    const total = tIn + tOut;
                    console.log(chalk.dim.green(` -> usage: (in: ${tIn} + out: ${tOut} = ${total} tokens) (tps: ${llama.usage.tps.toFixed(1)})`));
                }

                // console.log('llama-server response headers:')
                // llama?.headers.forEach((v, k) => console.log(` -> ${k}: ${v}`))
            } else if (res.locals.search) {
                const search = res.locals.search as SearchStatus;
                console.log(chalk.dim(` -> got ${search?.results} results for query ${search?.query}`));
            } else if (res.locals.load) {
                const load = res.locals.load as LoadStatus;
                console.log(chalk.dim(` -> loaded ${load?.successful} of ${load?.total} pages`));
            }
        });
    }

    next();
});

app.use(express.json({ type: (() => true), limit: '50mb' }));

/* -------------------- ROUTES -------------------- */

/**
 * /v1/models – return list of local models
 * TODO - return richer info
 */
app.get('/v1/models', async (_req, res, next) => {
    try {
        const data = llama.getAllModelNames().map(name => ({
            id: name,
            object: 'model',
            owned_by: 'llamacpp',
        }));

        res.json({ object: 'list', data });
    } catch (err) {
        return next(new Error(`failed to list models: ${err}`));
    }
});

app.post('/v1/chat/completions', async (
    req: RequestBody<proto.CompletionRequest>,
    res,
    next
) => {
    const request: proto.CompletionRequest = req.body;
    const ctrl = new AbortController();

    req.once('aborted', () => {
        console.log(chalk.dim.yellow(`client aborted request`));
        ctrl.abort();
    });

    res.once('close', () => ctrl.abort());

    try {
        // Forward request to llama-server
        const llamaResponse: LlamaResponse = await llama.completions({
            originalURL: req.originalUrl,
            headers: req.headers,
            method: req.method,
            body: req.body,
            signal: ctrl.signal,
        });

        const llamaStatus: LlamaStatus = {
            status: llamaResponse.status,
            headers: llamaResponse.headers,
        };
        res.locals.llama = llamaStatus;

        const stream = llamaResponse.stream;

        // Once we have data back from llama-server, we can begin streaming it to the client
        stream.once('readable', () => {
            // Copy headers and status for client once we have confirmation we're getting data
            llamaResponse.headers.forEach((v, k) => res.setHeader(k, v));
            res.status(llamaStatus.status);

            stream.pipe(res);
        });

        // This listener is triggered when llama-server is done streaming, or when the
        // stream is cancelled prematurely due to:
        // - client disconnects
        // - llama-server errors
        stream.once('stop', (result: proto.Result<proto.CompletionResponse, Error>) => {
            logger?.logs.push({
                request: request,
                response: result.ok ? result.value : result.value.message
            });

            // On success, end response and track stats for logs
            if (result.ok) {
                const tps = result.value.timings?.predicted_per_second;
                const tokensOut = result.value.timings?.predicted_n;
                const cacheIn = result.value.timings?.cache_n ?? 0;
                const promptIn = result.value.timings?.prompt_n ?? 0;
                const tokensIn = cacheIn + promptIn;

                (res.locals.llama as LlamaStatus).usage = {
                    tps: tps ?? 0,
                    inputTokens: tokensIn ?? 0,
                    outputTokens: tokensOut ?? 0,
                }

                res.end();
            } else {
                next(result.value);
            }
        });
    } catch (err: any) {
        return next(err);
    }
});

// If web browser is enabled, start it and define an endpoint
let browser: Browser.Browser | undefined = undefined;
if (cfg.web.enable) {
    browser = await Browser.init(
        cfg.web.braveAPIKey,
        cfg.web.runDangerouslyWithoutSandbox,
        cfg.web.screenshotWebpages,
    );

    app.post('/web/search', async (
        req: RequestBody<Browser.SearchRequest>,
        res,
        next
    ) => {
        const request: Browser.SearchRequest = req.body;

        // Perform web search and start loading pages in background
        let response: Browser.SearchResponse[];
        try { response = await browser!.search(request, true) } catch (err: any) {
            return next(new Error(`/web/search failed: ${err}`));
        }

        const searchStatus: SearchStatus = {
            query: request.query,
            results: response.length,
        };
        res.locals.search = searchStatus;
        res.send(response);
    });

    app.post('/web/load', async (
        req: RequestBody<Browser.LoadRequest>,
        res,
        next
    ) => {
        const request: Browser.LoadRequest = req.body;

        // Convert input url strings to URLs
        const urls: URL[] = [];
        request.urls.forEach(url => {
            try { urls.push(new URL(url)) } catch (err: any) {
                console.log(`/web/load: malformed url ${url}; skipping`);
            }
        });

        // Should never hit this but it satisfies TS typechecker
        if (!browser) return next(new Error(`no existing browser instance`));

        // Wait for the browser to finish loading pages from a prior /web/search
        // (fetchContent(true, ...) tells the browser the task must have been created already)
        const response: Browser.LoadResponse[] = [];
        (await Promise.allSettled(browser.fetchContent(true, ...urls))).forEach(result => {
            if (result.status === 'fulfilled') {
                response.push({
                    page_content: result.value.content,
                    metadata: result.value.metadata,
                });
            } else {
                console.log(`/web/load: rejected promise: ${result.reason}`);
            }
        });

        if (response.length === 0) {
            return next(new Error(`returned 0 successful results`));
        }

        const loadStatus: LoadStatus = {
            successful: response.length,
            total: request.urls.length,
        };
        res.locals.load = loadStatus;
        res.send(response);
    });
}

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

const tools = new ToolServer(app, { browser: browser });
await tools.serve();

// Start llama-server
const llama = new LlamaManager({
    llamaServerIP: HOST_IP, llamaServerPort: INTERNAL_PORT, llamaServerVerbose: LLAMA_SERVER_VERBOSITY,
    logDirectory: cfg.logs.path, logFilePrefix: logFilePrefix,
    sleepAfterXSeconds: cfg.llamaCpp.sleepAfterXSeconds,
    models: cfg.models,
});

app.listen(EXTERNAL_PORT, () => {
    console.log(`llama-shim listening on ${chalk.cyan(LLAMA_SHIM_URL)}`);
});

app.all('/{*splat}', async (req, res) => {
    console.log(`got unknown request to: ${req.originalUrl}`);
    console.log(`headers: ${JSON.stringify(req.headers, null, 2)}`);
    console.log(`method: ${req.method}`);
    // console.log(`body: ${req.body}`);

    console.log(`${JSON.stringify(JSON.parse(req.body.toString('utf8')), null, 2)}`);

    res.send('result text');
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.locals.error = {
        message: err?.message,
    };

    if (res.headersSent) return next(err);

    res.status(500).json({ error: `error: ${err?.message || 'unknown error'}` });
    res.end();
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