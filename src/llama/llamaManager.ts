import path from 'path';
import * as fs from 'node:fs';
import { spawn, ChildProcess } from 'child_process';
import fetch, { type RequestInit, Response, Headers } from 'node-fetch';
import type { IncomingHttpHeaders } from 'node:http';

import chalk from 'chalk';

import { type ModelConfig } from '../config.js';
import * as proto from '../protocol.js';
import LlamaStream from './llamaStream.js';

// Command to start llama‑server via submodule
const LLAMA_SERVER_BIN = './llama.cpp/build/bin/llama-server';

// How long to wait for a graceful shutdown before sending SIGKILL
const SHUTDOWN_GRACE_MS = 5000;

// How long to wait for a poll to succeed
// (we shouldn't need long since this is all on the same machine)
const POLL_TIMEOUT_MS = 100;

// Frequency of pings sent to `llama-server` on startup
const POLL_INTERVAL_MS = 500;

// Number of times to ping `llama-server` process before giving up on life
// (total wait time ms: NUM_RETRIES * POLL_INTERVAL_MS -> 20 seconds)
const NUM_RETRIES = 40;

type Llama = {
    model: proto.ModelInfo,
    pending: PendingJob[],
    active: {
        requests: number,
        proc: ChildProcess,
        sleepTimer: {
            reset: () => void,
            clear: () => void,
        },
        exited: Promise<void>,
    } | null,
};

type ActiveLlama = {
    [K in keyof Llama]: K extends 'active'
    ? Exclude<Llama[K], null>
    : Llama[K];
}

type InactiveLlama = {
    [K in keyof Llama]: K extends 'active'
    ? Extract<Llama[K], null>
    : Llama[K];
}

type PendingJob = {
    request: LlamaRequest,
    onResponse: (result: proto.Result<LlamaResponse, Error>) => void,
}

type LlamaRequest = {
    originalURL: string,
    headers: IncomingHttpHeaders,
    method: string,
    body: proto.CompletionRequest,
    signal: AbortSignal,
};

export type LlamaResponse = {
    status: number,
    headers: Headers,
    stream: LlamaStream,
};

/**
 * LlamaManager manages llamas.
 * 
 * This thing is basically "in charge" of a single llama.cpp process. It creates the process,
 * handles prompts while the process is alive, and tears down the process when requested.
 */
export class LlamaManager {

    private defaultLlama: Llama;

    // `llamas` maps model names to a Llama we can spin up to handle requests
    // `waitingLlamas` is the set of models that have requests waiting
    // `activeLlama` holds the name of our currently-active llama-server process
    private llamas: Map<string, Llama>;
    private waitingLlamas: string[] = [];
    private activeLlama: string | null = null;

    private sleepAfterMs: number;

    // Number of times we have instantiated a `llama-server` process
    private runCounter = 0;
    private logDirectory: string;
    private logFilePrefix: string;

    private llamaServerIP: string;
    private llamaServerPort: string;
    private llamaServerURL: string;
    private llamaServerVerboseLogs: boolean;

    constructor(params: {
        llamaServerIP: string, llamaServerPort: number, llamaServerVerbose: boolean,
        logDirectory: string, logFilePrefix: string,
        sleepAfterXSeconds: number,
        models: ModelConfig,
    }) {
        // Map models s.t. (key == model name, value == model info)
        this.llamas = new Map(params.models.infos.map(modelInfo => [
            modelInfo.name,
            {
                model: modelInfo,
                pending: [],
                active: null,
            }
        ]));

        const defaultModelName = params.models.onStart;
        this.defaultLlama = this.llamas.get(defaultModelName)
            ?? (() => { throw new Error(`LlamaManager: configured onStart model not found: ${defaultModelName}`) })();

        this.sleepAfterMs = params.sleepAfterXSeconds * 1000;

        this.logDirectory = params.logDirectory;
        this.logFilePrefix = params.logFilePrefix;

        this.llamaServerIP = params.llamaServerIP;
        this.llamaServerPort = params.llamaServerPort.toString();
        this.llamaServerURL = `http://${params.llamaServerIP}:${params.llamaServerPort}`;
        this.llamaServerVerboseLogs = params.llamaServerVerbose;

        // Start llama-server with default model
        this.#start(this.defaultLlama);
    }

    /* -------------------- PUBLIC METHODS -------------------- */

    completions(req: LlamaRequest): Promise<LlamaResponse> {

        const llama = this.getLlamaForModel(req.body.model, req.body.messages);

        // Create a promise that will be fulfilled when the server responds
        const promise = new Promise<LlamaResponse>((resolve, reject) => {
            const job: PendingJob = {
                request: req,
                onResponse: (result: proto.Result<LlamaResponse, Error>) => {
                    result.ok ? resolve(result.value) : reject(result.value);
                }
            }

            llama.pending.push(job);
        });

        // If our requested llama is currently active, tell it about the new work
        if (llama.active) {
            this.#doPending(llama as ActiveLlama);
            return promise;
        }

        // If there's no llama active, start one; it'll see the pending job automatically
        if (!this.activeLlama) {
            this.#start(llama);
            return promise;
        }

        // If there's a different llama active:
        // - if it's working on something, just add our llama to `this.waitingLlamas`
        // - otherwise, swap the active llama for ours
        if (this.isBusy(this.activeLlama)) {
            if (!this.waitingLlamas.includes(llama.model.name)) {
                this.waitingLlamas.push(llama.model.name);
            }
        } else {
            this.#swap(llama);
        }

        return promise;
    }

    /**
     * Kill the llama-server process, if it's running. Attempts a graceful shutdown,
     * using SIGTERM and waiting `SHUTDOWN_GRACE_MS`. If this does not succeed, this
     * method sends SIGKILL and waits `2 * SHUTDOWN_GRACE_MS`.
     * 
     * If the process is still running, throws an error.
     */
    async stopServer() {        
        await Promise.all(
            this.llamas.values()
                .map(llama => this.#stop(llama))
                .toArray()
        );
    }

    /**
     * Immediately SIGKILL any llama-server process (or its children), if they exist
     * Returns without cleanup/checking to see if the process ended.
     */
    forceStopServer() {
        for (const llama of this.llamas.values()) {
            if (!llama.active) continue;

            const pid = llama.active.proc.pid!;
            // we need an immediate exit, show no mercy
            console.log(chalk.dim(`killing llama-server process (pid ${pid}) (${chalk.yellow('SIGKILL')})...`));
            try { process.kill(-pid, 'SIGKILL') } catch { };
        }
    }

    /* -------------------- PRIVATE METHODS -------------------- */

    async #doPending(llama: ActiveLlama) {
        const allPending = llama.pending;
        llama.pending = [];

        for (const pending of allPending) {
            let response: LlamaResponse;
            try {
                response = await this.#send(llama, pending.request);
            } catch (err: any) {
                pending.onResponse({
                    ok: false,
                    value: err,
                });

                continue;
            }

            pending.onResponse({ ok: true, value: response });
        }
    }

    /**
     * Given a running llama-server process, sends an HTTP request to the server and
     * returns the server's response.
     * 
     * @throws if the request to llama-server fails
     */
    async #send(llama: Llama, req: LlamaRequest): Promise<LlamaResponse> {
        if (!llama.active) throw new Error(`LlamaManager.#send: llama not active`);

        // Serialize request body back into buffer form
        const bodyRaw = Buffer.from(JSON.stringify(req.body), 'utf8');

        // Convert IncomingHttpHeaders to HeadersInit
        const llamaURL = this.llamaServerURL + req.originalURL;
        const headers: HeadersInit = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers[key] = value;
            else if (Array.isArray(value)) headers[key] = value.join(', ');
        }

        // ensure Host header matches target and construct request
        headers["host"] = this.llamaServerURL;
        const init: RequestInit = {
            method: req.method,
            headers,
            body: !(req.method === 'GET' || req.method === 'HEAD') ? bodyRaw : null,
            signal: req.signal,
        };

        // Increment active requests, preventing calls to `prepareModel` until this request is processed
        // Note: this does NOT prevent direct calls to `stopServer` or `forceStopServer`, as we don't want
        // to block shutdown.
        llama.active.requests++;
        llama.active.sleepTimer.reset();

        // console.log(`starting request to ${chalk.dim.magenta(llama.model.name)} (${llama.active.requests} active requests)`);

        let stream: LlamaStream | null = null;

        // When running close to context window limit, a prompt will sometimes crash
        // the llama-server process without correctly closing the response.
        //
        // We add a listener here that is cleaned up when the stream stops naturally.
        const prematureExit = ((code: number | null, signal: NodeJS.Signals | null) => {
            stream?.destroy(new Error(`llama-server crashed; code=${code} signal=${signal}`));
        });

        llama.active.proc.once('exit', prematureExit);

        // Send request to `llama-server` and throw if we're unhappy
        let response: Response;
        let contentType: string | null;
        try {
            response = await fetch(llamaURL, init);
            contentType = response.headers.get('content-type');

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`llama-server returned error: ${errText}`);
            } else if (response.body === null) {
                throw new Error(`llama-server returned null response.body`);
            } else if (contentType === null) {
                throw new Error(`llama-server did not return expected header: content-type`);
            }
        } catch (err: any) {
            llama.active.requests--;
            throw new Error(err);
        }

        // Create a PassThrough stream we can listen to to know when the request is done
        stream = new LlamaStream(response.body, contentType, req.signal);
        stream.once('stop', () => {
            if (llama.active) {
                // console.log(`ending request to ${chalk.dim.magenta(llama.model.name)} (${llama.active!.requests} active requests)`);
                llama.active.requests--;
                llama.active.proc.removeListener('exit', prematureExit);
            }

            const activeRequests = llama.active?.requests ?? 0;
            if (activeRequests === 0 && this.waitingLlamas.length !== 0) {
                const waitingLlama = this.waitingLlamas.shift()!;
                const nextLlama = this.llamas.get(waitingLlama)
                    ?? (() => { throw new Error(`LlamaManager.#send: nextLlama not found: ${waitingLlama}`) })();
                console.log(chalk.dim(
                    ` -> switching to next llama: ${chalk.magenta(nextLlama)} (${nextLlama.pending.length} pending requests)`
                ));

                this.#swap(nextLlama);
            }
        });

        return {
            status: response.status,
            headers: response.headers,
            stream: stream,
        };
    }

    #swap(newLlama: Llama) {
        if (newLlama.active) throw new Error(`LlamaManager.#swap: newLlama is already active: ${newLlama.model.name}`);
        if (!this.activeLlama) throw new Error(`LlamaManager.#swap: expected existing active llama`);

        const curLlama = this.llamas.get(this.activeLlama)!;
        console.log(`curLlama: ${curLlama.model.name} | active: ${curLlama.active === null}`);

        curLlama.active?.exited
            .then(() => this.#start(newLlama))
            .catch((err: any) => {
                console.error(`LlamaManager.#swap: error starting new llama: ${newLlama.model.name}; err: ${err}`);
            });

        this.#stop(curLlama)
            .catch((err: any) => {
                console.error(`LlamaManager.#swap: error stopping existing llama: ${curLlama.model.name}; err: ${err}`);
            });
            
    }

    async #stop(llama: Llama): Promise<void> {
        if (!llama.active) return;

        // Shutdown handler that sends a kill signal to the process group, then waits
        // for a grace period. Resolves with `true` if shutdown occurred, `false` if
        // the grace period expired.
        const shutdownWithgracePeriod = (async (
            llama: ActiveLlama,
            signal: string,
            pid: number,
            gracePeriodMS: number
        ) => {
            try { process.kill(-pid, signal) } catch { };

            return Promise.race([
                new Promise<boolean>(async (resolve) => {
                    await llama.active.exited;
                    resolve(true);
                }),
                new Promise<boolean>((resolve) => {
                    setTimeout(() => resolve(false), gracePeriodMS);
                })
            ])
        });

        const pid = llama.active.proc.pid!;

        // try a graceful shutdown first (SIGTERM)
        console.log(chalk.dim(`killing llama-server process (pid ${pid}) (${chalk.yellow('SIGTERM')})...`));
        if (await shutdownWithgracePeriod(llama as ActiveLlama, 'SIGTERM', pid, SHUTDOWN_GRACE_MS)) {
            console.log(chalk.green('done! (graceful shutdown)'));
            return;
        }

        // grace period's up, now it's business (SIGKILL)
        //
        // *teleports behind you* "nothin personnel, kid"
        console.log(`failed to stop process gracefully, sending ${chalk.yellow('SIGKILL')}...`);
        if (await shutdownWithgracePeriod(llama as ActiveLlama, 'SIGKILL', pid, 2 * SHUTDOWN_GRACE_MS)) {
            console.log(chalk.yellow(`done! (forced shutdown)`));
            return;
        }

        // if we don't get a shutdown, burn it all to the ground
        // TODO - switch to something closer to Promise.allSettled rather than throwing on first fail
        throw new Error(`failed to kill llama-server (pid ${pid}) (model ${llama.model.name})`);
    }

    /**
     * Start a new `llama-server` process, loading any required GGUFs specified by `model`,
     * and appending any `model.params` to the default `llama-server` args.
     * 
     * `llama-server` is started as a detached process in its own process group. A logfile
     * is opened that collects stdout/stderr; this is closed when the process exits.
     * 
     * @param model The model to load into llama-server
     */
    #start(llama: Llama) {
        if (this.activeLlama) throw new Error(`LlamaManager.#startLlama: llama process already running!`);

        const model: proto.ModelInfo = llama.model;

        // Open log file for `llama-server` stdout/stderr
        // File name example: `llama-{timestamp}_r0_gpt-oss-20b.log`
        this.runCounter++;
        const logFileName =
            this.logFilePrefix +
            '_r' + this.runCounter.toString() +
            '_' + model.name + '.log';
        const logPath = path.join(this.logDirectory, logFileName);

        // Open log file for child process stdout/stderr
        console.log(`\n[Run: ${this.runCounter}] starting llama-server with model: ${chalk.magenta(model.name)}`);
        console.log(chalk.dim(` - using log file: ${logPath}`));
        console.log(chalk.dim(` - llama server command: ${LLAMA_SERVER_BIN}`));
        const out = fs.openSync(logPath, 'a');
        const err = fs.openSync(logPath, 'a');

        let args = [
            '--host', this.llamaServerIP,
            '--port', this.llamaServerPort,
            '--jinja',
            '-fa', '1',
            '--no-webui',                   // turn off webui, since the auto-shutdown feature makes this unreliable                             
            '-m', model.path,
        ];

        // If we have an mmproj, add to args
        if (model.mmprojPath) {
            args = [...args, '--mmproj', model.mmprojPath];
        }

        // Add any extra params
        if (model.params) {
            args = [...args, ...model.params];
        }

        // log verbosity ("messages with a higher verbosity will be ignored")
        // this gets _really_ verbose so we only want it enabled sometimes
        if (this.llamaServerVerboseLogs) {
            console.log(chalk.dim(` - verbose logging enabled`));
            args.push('-lv', '999');
        }

        // Spawn llama-server as a detached process, making it the leader of a new
        // process group. This means that we can send a kill signal to `-pid` to also
        // send a signal to any child processes it spawns.
        const proc = spawn(LLAMA_SERVER_BIN, args, {
            stdio: ['ignore', out, err],
            detached: true,
        });

        // 'error' is emitted when:
        // - process could not be spawned
        // - process could not be killed
        // - sending a message/signal to the process failed
        // - process was aborted via signal
        //
        // ... since this handles a lot of scenarios, we just log here.
        proc.once('error', (err) => {
            console.error('llama-server process error:', err);
        });

        // Activate llama:
        // - create a promise that resolves and cleans up when the process exits
        // - start a timer that will kill the process if it doesn't get activity
        //   before `this.sleepAfterMs`
        this.activeLlama = llama.model.name;
        llama.active = {
            requests: 0,
            proc: proc,
            sleepTimer: this.#newSleepTimer(llama as ActiveLlama, this.sleepAfterMs),
            // 'close' will only be emitted once the process exits AND all stdio streams
            // have been closed. 'exit' will be emitted once the process exits.
            //
            // `exit` will always be emitted before `close`. If we run into issues with zombies,
            // resolving/cleaning up on `close` might be better, as it should guarantee no I/O
            // is occuring.
            exited: new Promise<void>((resolve) => {
                // proc.once('close', () => resolve());
                proc.once('exit', (code, signal) => {
                    console.log(`llama-server exited code=${code} signal=${signal}`);

                    // clear auto-sleep timeout
                    llama.active!.sleepTimer.clear();

                    // clean up log files
                    try { fs.closeSync(out) } catch { };
                    try { fs.closeSync(err) } catch { };

                    this.activeLlama = null;
                    llama.active = null;
                    resolve();
                });
            }),
        };

        // Poll llama-server instance
        this.#pollServer(llama)
            .then(() => {
                this.#doPending(llama as ActiveLlama);
            })
            .catch((err: any) => {
                console.error(`LlamaManager.#start: error when polling: ${err}`);
                this.activeLlama = null;
            });
    }

    /**
     * Ping `llamaServerURL` until we get a success, indicating the HTTP server is running
     */
    async #pollServer(llama: Llama): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            if (!llama.active) {
                reject(`LlamaManager.#pollServer: process died before polling`);
                return;
            }

            process.stdout.write(chalk.dim(` - loading model: ${chalk.magenta(llama.model.name)}\n`));

            let retriesLeft = NUM_RETRIES;

            while (retriesLeft !== 0) {
                if (!llama.active) {
                    reject(`LlamaManager.#pollServer: process died while polling`);
                    return;
                }

                // Create per-request timeout
                const reqCtrl = new AbortController();
                const reqTimeout = setTimeout(() => reqCtrl.abort(), POLL_TIMEOUT_MS);
                reqTimeout.unref();

                let success = false;
                try {
                    // What we want: to return success when the model is loaded.
                    //
                    // From `server.cpp#main - middleware_server_state`, querying `/models`, or `/v1/models`
                    // will return 200 OK, even if the model is loading. `/v1/health` will error until
                    // the model is loaded, so we use that.
                    const res = await fetch(`${this.llamaServerURL}/v1/health`, { signal: reqCtrl.signal });
                    success = res.ok;
                } catch {
                    // swallow err - we expect failure while the server is still booting up
                } finally {
                    // Clean up timeout
                    clearTimeout(reqTimeout);

                    // Add a '.' to output for each time we ping
                    process.stdout.write(chalk.dim('.'));

                    if (success) {
                        process.stdout.write(
                            `${chalk.dim.green(`model loaded!`)} ${chalk.magenta(llama.model.name)} ` +
                            `is listening on port ${chalk.cyan(this.llamaServerPort)} ` +
                            `(pid ${llama.active.proc.pid}) ` +
                            '\n'
                        );
                        resolve();
                        return;
                    }
                }

                // sleep half a second, then retry
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS)).then(() => undefined);
                retriesLeft--;
            }
        });
    }

    #newSleepTimer(llama: ActiveLlama, delayMs: number): {
        reset: () => void,
        clear: () => void,
    } {
        let timer: NodeJS.Timeout | null = null;

        const start = () => {
            timer = setTimeout(async () => {
                await this.#sleep(llama);
            }, delayMs); // NOTE: add unref() ?
        };

        start();
        return {
            reset: () => {
                if (timer !== null) clearTimeout(timer);
                start();
            },
            clear: () => {
                if (timer !== null) clearTimeout(timer);
                timer = null;
            },
        }
    }

    async #sleep(llama: ActiveLlama) {
        // No need to stop server if we're actually doing things
        if (llama.pending.length !== 0 || llama.active.requests !== 0) {
            console.log(`sleep timer elapsed, but llama seems busy; skipping (${llama.pending.length} / ${llama.active.requests} pending / active)`);
            return;
        }

        // If you can't handle my logging code at its worst, you don't deserve
        // my logging output at its best
        let seconds = Math.floor(this.sleepAfterMs / 1000);
        const minutes = Math.floor(seconds / 60);
        if (minutes !== 0) seconds = seconds % 60;

        const minutesStr = minutes > 0 ? ` ${minutes} min` : '';
        const secondsStr = seconds > 0 ? ` ${seconds} sec` : '';

        console.log(`no activity after${minutesStr}${secondsStr}; going to sleep...`);
        await this.stopServer();
    }

    /* -------------------- GETTERS -------------------- */

    getAllModelNames(): string[] {
        return [
            'auto',
            ...this.getBaseLlamas().map(llama => llama.model.name),
            ...this.getVisionLlamas().map(llama => llama.model.name),
        ]
    }

    getBaseLlamas(): Llama[] {
        return [
            ...this.llamas.values()
                .filter(v => v.model.mmprojPath === undefined)
        ];
    }

    getVisionLlamas(): Llama[] {
        return [
            ...this.llamas.values()
                .filter(v => typeof v.model.mmprojPath === 'string')
        ];
    }

    getLlamaForModel(modelName: string, messages: proto.Message[]): Llama {
        if (modelName === 'auto') {
            if (hasVisionContent(messages)) {
                return this.getVisionLlamas().at(0)
                    ?? (() => { throw new Error(`getLlamaForModel: vision model required, but none loaded`) })();
            } else if (this.activeLlama) {
                return this.llamas.get(this.activeLlama)
                    ?? (() => { throw new Error(`getLlamaForModel: this.activeLlama not found in this.llamas: ${this.activeLlama}`) })();
            } else {
                return this.defaultLlama;
            }
        } else {
            return this.llamas.get(modelName)
                ?? (() => { throw new Error(`getLlamaForModel: requested model not found: ${modelName}`) })();
        }
    }

    isBusy(model: Llama | string): boolean {
        const llama: Llama | undefined = typeof model === 'string'
            ? this.llamas.get(model)
            : model;

        return llama !== undefined &&
            (llama.pending.length !== 0 || llama.active?.requests !== 0);
    }
}

function hasVisionContent(messages: proto.Message[]): boolean {
    const has = messages.findIndex(msg => {
        if (typeof msg.content === 'string') return false;
        return msg.content.find(part => part.type === 'image_url');
    }) !== -1;

    return has;
}