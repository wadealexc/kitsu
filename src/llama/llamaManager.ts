import path from 'path';
import * as fs from 'node:fs';
import { spawn, execSync, ChildProcess } from 'child_process';
import fetch, { type RequestInit, Response, Headers } from 'node-fetch';
import type { IncomingHttpHeaders } from 'node:http';

import chalk from 'chalk';

import { type ModelConfig, type ModelEntry } from '../config.js';
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
    serverHost: string,
    serverPort: string,
    pending: PendingJob[],
    active: {
        requests: number,
        proc: ChildProcess,
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

export type LlamaRequest = {
    body: proto.CompletionRequest,
    signal: AbortSignal,
};

export type LlamaResponse = {
    status: number,
    headers: Headers,
    stream: LlamaStream,
};

// VRAM usage
type VRAM = {
    used: number;
    total: number;
}

/**
 * LlamaManager manages llamas.
 *
 * This thing is basically "in charge" of a single llama.cpp process. It creates the process,
 * handles prompts while the process is alive, and tears down the process when requested.
 *
 * An optional task model runs on a dedicated port alongside the main model. It never
 * participates in swap/queue logic and is started/stopped with the main model.
 */
export class LlamaManager {

    private defaultLlama: Llama;
    private taskLlama: Llama | null = null;

    // `llamas` maps model names to a Llama we can spin up to handle requests
    // `waitingLlamas` is the set of models that have requests waiting
    // `activeLlama` holds the name of our currently-active llama-server process
    private llamas: Map<string, Llama>;
    private waitingLlamas: string[] = [];
    private activeLlama: string | null = null;

    private sleepAfterMs: number;
    private sleepTimer: { reset: () => void, clear: () => void } | null = null;

    // Number of times we have instantiated a `llama-server` process
    private runCounter = 0;
    private logDirectory: string;
    private logFilePrefix: string;

    private llamaServerVerboseLogs: boolean;

    constructor(params: {
        ports: {
            port: number,
            host: string,
        },
        taskModelPorts?: {
            port: number,
            host: string,
        },
        llamaServerVerbose: boolean,
        logDirectory: string, logFilePrefix: string,
        sleepAfterXSeconds: number,
        models: ModelConfig,
    }) {
        const buildLlama = (
            model: ModelEntry,
            basePath: string,
            host: string,
            port: number,
        ): Llama => {
            const name = model.alias ?? model.gguf;

            const modelPath = path.join(basePath, model.gguf.endsWith('.gguf')
                ? model.gguf
                : model.gguf + '.gguf');

            const mmprojPath = (model.mmproj ? model.mmproj.endsWith('.gguf')
                ? path.join(basePath, model.mmproj)
                : path.join(basePath, model.mmproj + '.gguf')
                : undefined);

            const args = model.args ?? [];
            const ctxIdx = args.indexOf('--ctx-size');
            const contextLength = ctxIdx !== -1 ? Number(args[ctxIdx + 1]) || undefined : undefined;

            return {
                model: {
                    name,
                    path: modelPath,
                    mmprojPath,
                    args,
                    params: model.params ?? {},
                    contextLength,
                },
                serverHost: host,
                serverPort: port.toString(),
                pending: [],
                active: null,
            };
        };

        const basePath = params.models.path;

        // Map models s.t. (key == model name, value == model info)
        this.llamas = new Map(params.models.models.map(model => {
            const llama = buildLlama(model, basePath, params.ports.host, params.ports.port);
            return [llama.model.name, llama];
        }));

        const defaultModelName = params.models.onStart;
        this.defaultLlama = this.llamas.get(defaultModelName)
            ?? (() => { throw new Error(`LlamaManager: configured onStart model not found: ${defaultModelName}`) })();

        // Build task llama if configured — both taskModel and taskModelPorts must be provided together
        const hasTaskModel = !!params.models.taskModel;
        const hasTaskPorts = !!params.taskModelPorts;
        if (hasTaskModel !== hasTaskPorts) {
            throw new Error(`LlamaManager: taskModel and taskModelPorts must both be provided or both omitted`);
        }
        if (params.models.taskModel && params.taskModelPorts) {
            this.taskLlama = buildLlama(
                params.models.taskModel,
                basePath,
                params.taskModelPorts.host,
                params.taskModelPorts.port,
            );
        }

        this.sleepAfterMs = params.sleepAfterXSeconds * 1000;

        this.logDirectory = params.logDirectory;
        this.logFilePrefix = params.logFilePrefix;

        this.llamaServerVerboseLogs = params.llamaServerVerbose;
    }

    /* -------------------- PUBLIC METHODS -------------------- */

    // Start llama-server with default model (and task model if configured)
    async startDefault(): Promise<void> {
        console.log(`LlamaManager: starting models`);
        this.#logVRAM();

        if (this.taskLlama) {
            console.log(`starting task model: ${this.taskLlama.model.name}`);
            await this.#start(this.taskLlama, { isTaskModel: true });
            this.#logVRAM();
        }

        console.log(`starting main model: ${this.defaultLlama.model.name}`);
        await this.#start(this.defaultLlama);
        this.#logVRAM();

        this.sleepTimer = this.#newSleepTimer(this.sleepAfterMs);
    }

    completions(req: LlamaRequest, opts?: { taskModel?: boolean }): Promise<LlamaResponse> {

        let llama: Llama | undefined;
        if (opts?.taskModel) {
            if (!this.taskLlama) throw new Error(`LlamaManager: task model not configured`);
            llama = this.taskLlama;
        } else {
            llama = this.getLlamaForModel(req.body.model, req.body.messages);
        }

        // Create a promise that will be resolved when we get a response
        const promise = new Promise<LlamaResponse>((resolve, reject) => {
            llama.pending.push({
                request: req,
                onResponse: (result) => result.ok ? resolve(result.value) : reject(result.value),
            });
        });

        // If our requested llama is currently active, tell it about the new work
        if (llama.active) {
            this.#doPending(llama as ActiveLlama);
            return promise;
        }

        // Regardless of which model was requested, wake the task model if it's inactive
        // #start will have it work on any pending tasks immediately
        //
        // If we were specifically trying to reach the task model, we're done.
        if (this.taskLlama && !this.taskLlama.active) {
            this.#start(this.taskLlama, { isTaskModel: true });
            if (opts?.taskModel) return promise;
        }

        // From here on, we were trying to reach a non-task model. If there's no llama active,
        // start the requested model. #start will give it its pending tasks.
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
        const allLlamas = [...this.llamas.values()];
        if (this.taskLlama) allLlamas.push(this.taskLlama);
        await Promise.all(allLlamas.map(llama => this.#stop(llama)));
    }

    /**
     * Immediately SIGKILL any llama-server process (or its children), if they exist
     * Returns without cleanup/checking to see if the process ended.
     */
    forceStopServer() {
        const allLlamas = [...this.llamas.values()];
        if (this.taskLlama) allLlamas.push(this.taskLlama);

        for (const llama of allLlamas) {
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

        // TODO - hardcoded completions
        const llamaURL = `http://${llama.serverHost}:${llama.serverPort}` + '/v1/chat/completions';

        // Increment active requests, preventing calls to `prepareModel` until this request is processed
        // Note: this does NOT prevent direct calls to `stopServer` or `forceStopServer`, as we don't want
        // to block shutdown.
        llama.active.requests++;
        this.sleepTimer?.reset();

        let stream: LlamaStream | null = null;

        // When running close to context window limit, a prompt will sometimes crash
        // the llama-server process without correctly closing the response.
        //
        // We add a listener here that is cleaned up when the stream stops for any reason.
        const prematureExit = ((code: number | null, signal: NodeJS.Signals | null) => {
            stream?.destroy(new Error(`llama-server crashed; code=${code} signal=${signal}`));
        });

        llama.active.proc.once('exit', prematureExit);

        try {
            console.log(`starting request to llama: ${llama.model.name}`)
            const { system: _system, ...inferenceParams } = llama.model.params;
            const body = { ...inferenceParams, ...req.body, timings_per_token: true, return_progress: true };
            const response = await fetch(llamaURL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: req.signal,
            });

            console.log(`got res from llama: ${llama.model.name}`)
            const contentType: string | null = response.headers.get('content-type');

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`llama-server returned error: ${errText}`);
            } else if (response.body === null) {
                throw new Error(`llama-server returned null response.body`);
            } else if (contentType === null) {
                throw new Error(`llama-server did not return expected header: content-type`);
            }

            const expectSSE = contentType.includes('text/event-stream');
            console.log(`llamaStream for: ${llama.model.name}, expectSSE: ${expectSSE}`);
            stream = new LlamaStream(
                response.body,
                expectSSE,
                req.signal,
            );

            stream.once('stop', () => {
                console.log(`stop: ${llama.model.name}`);
                if (llama.active) {
                    llama.active.requests--;
                    llama.active.proc.removeListener('exit', prematureExit);
                }

                // Only check swap queue for main models
                if (llama === this.taskLlama) return;

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
        } catch (err: any) {
            llama.active.requests--;
            throw new Error(err);
        }
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
     * @param llama The llama to start
     * @param opts.isTaskModel If true, this is the task model — skips activeLlama guards
     */
    #start(llama: Llama, opts?: { isTaskModel?: boolean }): Promise<void> {
        if (this.activeLlama && !opts?.isTaskModel) {
            throw new Error(`LlamaManager.#startLlama: llama process already running!`);
        }

        const model: proto.ModelInfo = llama.model;

        // Open log file for `llama-server` stdout/stderr
        // File name example: `llama-{timestamp}_r0_gpt-oss-20b.log` or `..._task_...`
        this.runCounter++;
        const taskSuffix = opts?.isTaskModel ? '_task' : '';
        const logFileName =
            this.logFilePrefix +
            '_r' + this.runCounter.toString() +
            taskSuffix +
            '_' + model.name + '.log';
        const logPath = path.join(this.logDirectory, logFileName);

        // Open log file for child process stdout/stderr
        console.log(`\n[Run: ${this.runCounter}] starting llama-server with model: ${chalk.magenta(model.name)}`);
        console.log(chalk.dim(` - using log file: ${logPath}`));
        console.log(chalk.dim(` - llama server command: ${LLAMA_SERVER_BIN}`));
        const out = fs.openSync(logPath, 'a');
        const err = fs.openSync(logPath, 'a');

        let args = [
            '--host', llama.serverHost,
            '--port', llama.serverPort,
            '--jinja',
            '-fa', '1',
            '--no-webui',                   // turn off webui, since the auto-shutdown feature makes this unreliable
            '-m', model.path,
        ];

        // If we have an mmproj, add to args
        if (model.mmprojPath) {
            args = [...args, '--mmproj', model.mmprojPath];
        }

        // Add any extra CLI args
        if (model.args && model.args.length > 0) {
            console.log(chalk.dim(` - extra args: ${model.args}`));
            args = [...args, ...model.args];
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
        if (!opts?.isTaskModel) this.activeLlama = llama.model.name;
        llama.active = {
            requests: 0,
            proc: proc,
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

                    // clean up log files
                    try { fs.closeSync(out) } catch { };
                    try { fs.closeSync(err) } catch { };

                    if (!opts?.isTaskModel) this.activeLlama = null;
                    llama.active = null;
                    resolve();
                });
            }),
        };

        // Poll llama-server instance
        return new Promise<void>((resolve, reject) => {
            this.#pollServer(llama)
                .then(async () => {
                    // Fetch context window size from /props
                    try {
                        const propsRes = await fetch(`http://${llama.serverHost}:${llama.serverPort}/props`);
                        if (propsRes.ok) {
                            const props = await propsRes.json() as Record<string, unknown>;
                            if (typeof props.n_ctx === 'number') {
                                llama.model.contextLength = props.n_ctx;
                                console.log(chalk.dim(` - n_ctx: ${props.n_ctx}`));
                            }
                        }
                    } catch {
                        // Non-critical — proceed without context length
                    }
                    resolve();
                    this.#doPending(llama as ActiveLlama);
                })
                .catch((err: any) => {
                    console.error(`LlamaManager.#start: error when polling: ${err}`);
                    if (!opts?.isTaskModel) this.activeLlama = null;
                    reject(err);
                });
        });
    }

    /**
     * Ping llama-server until we get a success, indicating the HTTP server is running
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
                    const res = await fetch(`http://${llama.serverHost}:${llama.serverPort}/v1/health`, { signal: reqCtrl.signal });
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
                            `is listening on port ${chalk.cyan(llama.serverPort)} ` +
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

    #newSleepTimer(delayMs: number): {
        reset: () => void,
        clear: () => void,
    } {
        let timer: NodeJS.Timeout | null = null;

        const start = () => {
            timer = setTimeout(async () => {
                await this.#sleep();
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

    async #sleep() {
        // Check if any llama (main or task) is busy
        const allLlamas = [...this.llamas.values()];
        if (this.taskLlama) allLlamas.push(this.taskLlama);

        const anyBusy = allLlamas.some(llama =>
            llama.pending.length !== 0 || (llama.active?.requests ?? 0) !== 0
        );

        if (anyBusy) {
            console.log(`sleep timer elapsed, but a llama seems busy; skipping`);
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

    #logVRAM(): void {
        const vram = this.#getVRAM();
        if (vram) {
            const used = (vram.used / 1024).toFixed(2);
            const total = (vram.total / 1024).toFixed(1);
            console.log(chalk.dim(` - VRAM: ${used} / ${total} GiB`));
        }
    }

    #getVRAM(): VRAM | null {
        try {
            const output = execSync(
                'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits',
                { encoding: 'utf-8', timeout: 3000 }
            ).trim();
            const parts = output.split(',').map(s => parseInt(s.trim(), 10));
            const used = parts[0], total = parts[1];
            if (used === undefined || total === undefined) return null;
            return { used, total };
        } catch {
            // nvidia-smi unavailable — skip silently
            return null;
        }
    }

    /* -------------------- GETTERS -------------------- */

    hasTaskModel(): boolean {
        return this.taskLlama !== null;
    }

    getTaskModel(): string | undefined {
        return this.taskLlama?.model.name;
    }

    getTaskModelInfo(): proto.ModelInfo | undefined {
        return this.taskLlama?.model;
    }

    getModelInfo(name: string): proto.ModelInfo | undefined {
        return this.llamas.get(name)?.model;
    }

    getAllModelNames(): string[] {
        return [
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

    getLlamaForModel(modelName: string, messages: proto.Message[], opts?: { taskModel?: boolean }): Llama {
        if (opts?.taskModel) {
            if (!this.taskLlama) throw new Error('task model requested but not configured');
            return this.taskLlama;
        }

        if (modelName === 'auto') {
            if (proto.hasVisionContent(messages)) {
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