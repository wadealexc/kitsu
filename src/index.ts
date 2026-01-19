import * as fs from 'fs';
import path from 'path';

import express from 'express';
import chalk from 'chalk';
import bytes from 'bytes';

import { readConfig } from './config.js';
import * as proto from './protocol.js';
import * as middleware from './server/middleware.js';
import { type RequestBody } from './server/middleware.js';
import { LlamaManager, type LlamaResponse } from './llama/llamaManager.js';
import * as Browser from './browser/browser.js';
import { ToolServer } from './tools/server.js';
import authsRouter from './routes/auths.js';
import configsRouter from './routes/configs.js';
import usersRouter from './routes/users.js';
import modelsRouter from './routes/models.js';
import chatsRouter from './routes/chats.js';
import foldersRouter from './routes/folders.js';

/* -------------------- CONFIG -------------------- */

// Check for 'verbose' option for llama-server verbosity
const LLAMA_SERVER_VERBOSITY = process.argv.slice(2).includes('-vb');

const CONFIG_PATH = './config.json';
const cfg = await readConfig(CONFIG_PATH);

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

const app = express();

app.use(middleware.logging);
app.use(express.json({ type: (() => true), limit: '50mb' }));

/* -------------------- LLAMA, BROWSER, TOOL SERVER -------------------- */

// If enabled, start web browser and web browser API
let browser: Browser.Browser | undefined = undefined;
if (cfg.web.enable) {
    browser = await Browser.init(
        app,
        cfg.web.braveAPIKey,
        cfg.web.runDangerouslyWithoutSandbox,
        cfg.web.screenshotWebpages,
    );

    browser.serve();
}

// Start tool server and tool server API
const tools = new ToolServer(app, { browser: browser });
tools.serve();

// Start llama-server
const llama = new LlamaManager({
    ports: cfg.ports.llamaCpp, llamaServerVerbose: LLAMA_SERVER_VERBOSITY,
    logDirectory: cfg.logs.path, logFilePrefix: logFilePrefix,
    sleepAfterXSeconds: cfg.llamaCpp.sleepAfterXSeconds,
    models: cfg.models,
});
// await llama.startDefault(); TODO - don't start llm while we work on routes

/* -------------------- ROUTES - API -------------------- */

app.use('/api/v1/auths', authsRouter);
app.use('/api/v1/configs', configsRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/models', modelsRouter);
app.use('/api/v1/chats', chatsRouter);
app.use('/api/v1/folders', foldersRouter);

/* -------------------- ROUTES - OPENAI -------------------- */

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
    const request: proto.CompletionRequest = await tools.beforeRequest(req.body);
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
            body: request,
            signal: ctrl.signal,
        });

        const llamaStatus: middleware.LlamaStatus = {
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

                (res.locals.llama as middleware.LlamaStatus).usage = {
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

/* -------------------- ERROR HANDLING AND SHUTDOWN -------------------- */

const LLAMA_SHIM_URL = `http://${cfg.ports.shim.host}:${cfg.ports.shim.port}`;

app.listen(cfg.ports.shim.port, cfg.ports.shim.host, () => {
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

    if (res.headersSent) {
        console.error(`reached error handler but headers already sent`);
        return next(err);
    }

    res.status(500).json({ error: `error: ${err?.message || 'unknown error'}` });
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