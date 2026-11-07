import * as fs from 'fs';
import path from 'path';

import express from 'express';
import cookieParser from 'cookie-parser';
import chalk from 'chalk';

import { readConfig } from './config.js';
import * as middleware from './server/middleware.js';
import { LlamaManagerAdapter } from './llama/llamaManagerAdapter.js';
import type { Llama } from './llama/types.js';
import { McpManager } from './mcp/manager.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { db, McpServers } from './db/index.js';
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
import mcpServersRouter from './routes/mcpServers.js';

/* -------------------- CONFIG -------------------- */

const CONFIG_PATH = process.env.KITSU_CONFIG ?? '../config.json';
const cfg = await readConfig(CONFIG_PATH);

// Bring the database schema up to date (migrations in ./drizzle)
await migrate(db, { migrationsFolder: './drizzle' });

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

/* -------------------- LLAMA, MCP SERVERS, TOOLS -------------------- */

const llama: Llama = new LlamaManagerAdapter({
    managerUrl: cfg.llamaManager.url,
    models: cfg.models,
});

// Connect to the MCP servers an admin has added; their tools are what models can call
const mcp = new McpManager();
await mcp.sync(await McpServers.listServers(db));
const tools = new ToolRegistry(mcp, llama);

/* -------------------- APP STATE -------------------- */

// Store application state in app.locals for access in routers
app.locals.llama = llama;
app.locals.tools = tools;
app.locals.mcp = mcp;

/* -------------------- ROUTES - API -------------------- */

app.use('/api/v1/auths', authsRouter);
app.use('/api/v1/configs', configsRouter);
app.use('/api/v1/users', usersRouter);
app.use('/api/v1/models', modelsRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/chats', chatsRouter);
app.use('/api/v1/folders', foldersRouter);
app.use('/api/v1/files', filesRouter);
app.use('/api/v1/mcp', mcpServersRouter);
app.use('/api/version', versionRouter);
app.use('/health', healthRouter);

/* -------------------- FRONTEND -------------------- */

// In the docker image the backend also serves the built frontend (a static
// SvelteKit app). Unknown non-API paths get index.html so client routes load.
const FRONTEND_DIR = process.env.KITSU_FRONTEND_DIR;
if (FRONTEND_DIR) {
    const indexHtml = path.join(FRONTEND_DIR, 'index.html');
    app.use(express.static(FRONTEND_DIR, {
        index: 'index.html',
        // Hashed build assets never change; everything else is checked each time
        setHeaders: (res, filePath) => {
            res.setHeader('Cache-Control', filePath.includes(`${path.sep}_app${path.sep}immutable${path.sep}`)
                ? 'public, max-age=31536000, immutable'
                : 'no-cache');
        },
    }));
    app.get('/{*splat}', (req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtml);
    });
}

/* -------------------- ERROR HANDLING AND SHUTDOWN -------------------- */

const BACKEND_URL = `http://${cfg.ports.backend.host}:${cfg.ports.backend.port}`;

app.listen(cfg.ports.backend.port, cfg.ports.backend.host, () => {
    console.log(`kitsu-backend listening on ${chalk.cyan(BACKEND_URL)}`);
});

app.all('/{*splat}', (req, res) => {
    console.log(`unknown route: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ detail: 'Not found' });
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
        // 1. Close MCP connections
        mcp.close().catch(err => console.error(`shutdown: mcp.close failed: `, err)),
        // 2. Write chat logs to file
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

// Listen to OS signals and shut down cleanly
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
