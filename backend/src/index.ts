import * as fs from 'fs';
import path from 'path';

import express from 'express';
import cookieParser from 'cookie-parser';
import chalk from 'chalk';

import { readConfig } from './config.js';
import * as middleware from './server/middleware.js';
import { LlamaManager } from './llama/llamaManager.js';
import * as Browser from './browser/browser.js';
import { ToolRegistry } from './tools/registry.js';
import authsRouter from './routes/auths.js';
import configsRouter from './routes/configs.js';
import usersRouter from './routes/users.js';
import modelsRouter from './routes/models.js';
import chatRouter from './routes/completions/index.js';
import chatsRouter from './routes/chats.js';
import foldersRouter from './routes/folders.js';
import filesRouter from './routes/files.js';
import versionRouter from './routes/version.js';
import healthRouter from './routes/health.js';
import { MockLlama } from '../test/mockLlama.js';
import { RoutedLlama } from '../test/routedLlama.js';

/* -------------------- CONFIG -------------------- */

// Check for 'verbose' option for llama-server verbosity
const LLAMA_SERVER_VERBOSITY = process.argv.slice(2).includes('-vb');

const CONFIG_PATH = '../config.json';
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
app.use(cookieParser());
app.use(express.json({ type: 'application/json', limit: '50mb' }));
app.use('/static', express.static(path.resolve('static')));

/* -------------------- LLAMA, BROWSER, TOOL SERVER -------------------- */

// If enabled, start web browser and web browser API
let browser: Browser.Browser | undefined = undefined;
if (cfg.web.enable) {
    browser = await Browser.init(
        cfg.web.braveAPIKey,
        cfg.web.blacklistHosts,
    );
}

// Note - temp/routed llamas for testing while prod is running
// const llama = new RoutedLlama(cfg.models) as unknown as LlamaManager;
// const llama = new MockLlama() as unknown as LlamaManager;

// Start llama-server
const llama = new LlamaManager({
    ports: cfg.ports.llamaCpp,
    llamaServerVerbose: LLAMA_SERVER_VERBOSITY,
    logDirectory: cfg.logs.path, logFilePrefix: logFilePrefix,
    sleepAfterXSeconds: cfg.llamaCpp.sleepAfterXSeconds,
    models: cfg.models,
});
llama.startDefault();

// Initialize tool registry
const tools = new ToolRegistry({ browser, llama });

/* -------------------- APP STATE -------------------- */

// Store application state in app.locals for access in routers
app.locals.llama = llama;
app.locals.tools = tools;

/* -------------------- ROUTES - API -------------------- */

app.use('/api/v1/auths', authsRouter);
app.use('/api/v1/configs', configsRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/models', modelsRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/chats', chatsRouter);
app.use('/api/v1/folders', foldersRouter);
app.use('/api/v1/files', filesRouter);
app.use('/api/version', versionRouter);
app.use('/health', healthRouter);

/* -------------------- ERROR HANDLING AND SHUTDOWN -------------------- */

const BACKEND_URL = `http://${cfg.ports.backend.host}:${cfg.ports.backend.port}`;

app.listen(cfg.ports.backend.port, cfg.ports.backend.host, () => {
    console.log(`kitsu-backend listening on ${chalk.cyan(BACKEND_URL)}`);
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
        console.error(`error: ${err}`)
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