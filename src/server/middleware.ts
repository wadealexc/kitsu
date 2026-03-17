import { Headers } from 'node-fetch';

import express from 'express';
import chalk from 'chalk';
import bytes from 'bytes';

/* -------------------- EXPRESS TYPINGS -------------------- */

export type RequestBody<T> = express.Request<{}, any, T>;

export type LlamaStatus = {
    status: number,
    headers: Headers,
    usage?: {
        tps: number,
        inputTokens: number,
        outputTokens: number,
    }
};

export type SearchStatus = {
    query: string,
    results: number,
};

export type LoadStatus = {
    successful: number,
    total: number,
};

/* -------------------- MIDDLEWARE -------------------- */

// Per-request logging
export const logging = ((req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const start = process.hrtime.bigint();

    // TODO - correlate logs/requests via ID
    // res.locals.logContext = {
    //     requestId: crypto.randomUUID(), 
    // };

    // Fire logs for non-GET requests once the response is 100% complete
    // if (req.method !== 'GET') {
        res.once('finish', () => {
            const end = process.hrtime.bigint();
            const durationSec = Number(end - start) / 1_000_000_000;
            const durationStr = `${durationSec.toFixed(3)} sec`;

            // console.log(JSON.stringify(req.headers, null, 2));

            // Pretty-print request info, e.g:
            // POST: /v1/chat/completions (request: 1.13KB) (elapsed: 1.3 sec)
            //
            // TODO - add response size? output in tokens?
            const requestLen = req.headers['content-length'] ?? '0';
            const requestInfo =
                `${req.method}: ${chalk.yellow(req.originalUrl)}`
                + ` (request: ${bytes(Number(requestLen))})`
                + ` (elapsed: ${durationStr})`
                + ` (HTTP ${res.statusCode})`;

            if (req.method !== 'GET') console.log(requestInfo);

            // // TODO - better typing instead of if/else hell
            // if (res.locals.error) {
            //     const err = res.locals.error?.message;
            //     console.error(chalk.dim.red(` -> error: ${err}`));
            //     // console.error(chalk.dim.red(` -> request:\n${JSON.stringify(req, null, 2)}`));
            // } else if (res.locals.llama) {
            //     const llama = res.locals.llama as LlamaStatus;
            //     console.log(chalk.dim.green(` -> llama response ok (code: ${llama?.status} | ${llama?.headers.get('content-type')})`));
            //     if (llama.usage) {
            //         const tIn = llama.usage.inputTokens;
            //         const tOut = llama.usage.outputTokens;
            //         const total = tIn + tOut;
            //         console.log(chalk.dim.green(` -> usage: (in: ${tIn} + out: ${tOut} = ${total} tokens) (tps: ${llama.usage.tps.toFixed(1)})`));
            //     }

            //     // console.log('llama-server response headers:')
            //     // llama?.headers.forEach((v, k) => console.log(` -> ${k}: ${v}`))
            // } else if (res.locals.search) {
            //     const search = res.locals.search as SearchStatus;
            //     console.log(chalk.dim(` -> got ${search?.results} results for query ${search?.query}`));
            // } else if (res.locals.load) {
            //     const load = res.locals.load as LoadStatus;
            //     console.log(chalk.dim(` -> loaded ${load?.successful} of ${load?.total} pages`));
            // }
        });
    // }

    next();
});

