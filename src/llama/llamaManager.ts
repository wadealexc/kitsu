import path from 'path';
import * as fs from 'node:fs';
import http from 'node:http';
import { spawn, execSync, ChildProcess } from 'child_process';
import fetch, { Headers } from 'node-fetch';

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
const NUM_RETRIES = 200;

// How often the main dispatch loop ticks
const LOOP_INTERVAL_MS = 100;

// Disable HTTP keep-alive for llama-server requests. Without this, node-fetch pools
// TCP connections, and llama-server may close an idle connection between tool-call
// rounds, causing a "socket hang up" on the next round's fetch.
const LLAMA_HTTP_AGENT = new http.Agent({ keepAlive: false });

type Llama = {
    model: proto.ModelInfo,
    serverHost: string,
    serverPort: string,
    active: {
        requests: number,
        proc: ChildProcess,
        exited: Promise<void>,
    } | null,
};

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
    used: number,
    total: number,
};

type Job = {
    request: LlamaRequest,
    promise: Promise<LlamaResponse>,
    resolve: (value: LlamaResponse) => void,
    reject: (err: unknown) => void,
};

type RequestQueueItem = {
    llama: Llama,
    jobs: Job[],
};

/**
 * LlamaManager manages llamas.
 *
 * This thing is in charge of llama.cpp processes. It shells out to spawn llama-server
 * instances, handles prompts while the process is alive, and tears down the process 
 * when requested.
 * 
 * A single global `requestQueue` is driven by a polling loop (`startLoop`). The loop
 * handles model start/stop/swap and job dispatch.
 *
 * An optional task model runs on a dedicated port alongside the main model. It never
 * participates in swap/queue logic and is started/stopped with the main model.
 */
export class LlamaManager {

    private defaultLlama: Llama;

    // Main models we can spin up to handle requests
    private llamas: Map<string, Llama>;
    private requestQueue: RequestQueueItem[] = [];

    // Optional task model to handle tasks
    private taskLlama: Llama | null = null;
    private taskQueue: Job[] = [];

    private sleepAfterMs: number;
    private sleepTimer: { reset: () => void } | null = null;

    // Logging
    private runCounter = 0;
    private logDirectory: string;
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

        // Build task llama if configured - both taskModel and taskModelPorts must be provided together
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
        this.llamaServerVerboseLogs = params.llamaServerVerbose;
    }

    /* -------------------- MAIN LOOP -------------------- */

    /**
     * Dispatch loop. Loads/swaps models if needed, then dispatches tasks to models.
     * 
     * Waits for models to be loaded before task dispatch.
     */
    async #loop(): Promise<void> {
        await this.#startModels();
        await this.#swapOnIdle();

        const jobsDispatched = this.#dispatchJobs();
        const tasksDispatched = this.#dispatchTasks();
        if (jobsDispatched || tasksDispatched) this.sleepTimer?.reset();
    }

    /**
     * Start any inactive models, if needed. Starts both the current
     * requested model and the task model. Does nothing if a model is
     * already running.
     */
    async #startModels(): Promise<void> {
        const promises: Promise<void>[] = [];
        const cur = this.requestQueue.at(0);
        
        if (cur && !cur.llama.active) {
            promises.push(this.#start(cur.llama));

            // Start task model alongside main model
            if (this.taskLlama && !this.taskLlama.active)
                promises.push(this.#start(this.taskLlama));
        }

        await Promise.all(promises);
    }

    /**
     * If the currently-requested model is idle and we have a model queued up,
     * stop the current model and start the queued model.
     * 
     * Waits until the "next" model is running before returning.
     */
    async #swapOnIdle(): Promise<void> {
        const cur = this.requestQueue.at(0);
        const next = this.requestQueue.at(1);
        if (!cur || !next) return;

        // Current model is busy - don't swap
        if (cur.jobs.length > 0) return;
        if (cur.llama.active && cur.llama.active.requests !== 0) return;

        // Current model is idle - shift it off and swap to next
        this.requestQueue.shift();

        await this.#stop(cur.llama);
        await this.#start(next.llama);
    }

    /**
     * Dispatch all queued jobs for the current model to llama-server
     * 
     * @returns true if any jobs were dispatched
     */
    #dispatchJobs(): boolean {
        const cur = this.requestQueue.at(0);
        if (!cur || !cur.llama.active || cur.jobs.length === 0) 
            return false;

        const jobs = cur.jobs;
        cur.jobs = [];
        for (const job of jobs) {
            this.#send(cur.llama, job);
        }

        return jobs.length > 0;
    }

    /**
     * Dispatch all queued tasks for the task model to llama-server
     * 
     * @returns true if any tasks were dispatched
     */
    #dispatchTasks(): boolean {
        if (!this.taskLlama || !this.taskLlama.active || this.taskQueue.length === 0) 
            return false;

        const tasks = this.taskQueue;
        this.taskQueue = [];
        for (const task of tasks) {
            this.#send(this.taskLlama, task);
        }

        return tasks.length > 0;
    }

    /* -------------------- PUBLIC METHODS -------------------- */

    /**
     * Push the default model into the queue and start the dispatch loop.
     * Models are loaded asynchronously by the first loop tick.
     */
    startDefault(): void {
        console.log(`LlamaManager: starting`);
        this.#logVRAM();

        this.requestQueue.push({ llama: this.defaultLlama, jobs: [] });
        this.sleepTimer = this.#newSleepTimer();

        const tick = async () => {
            try {
                await this.#loop();
            } catch (err) {
                console.error(`LlamaManager: loop error: ${err}`);
            }
            setTimeout(tick, LOOP_INTERVAL_MS);
        };
        tick();
    }

    /**
     * Request that a model should be made active. Pushes the model into the queue,
     * to be picked up by the main loop. No-op if the model is already in the queue.
     */
    wake(modelName: string): 'idle' | 'queued' | 'active' {
        const llama = this.llamas.get(modelName);
        if (!llama) throw new Error(`wake: model not found: ${modelName}`);
        
        // Already in queue - no action needed
        if (this.requestQueue.some(item => item.llama === llama)) 
            return 'queued';

        // Add to queue - loop will handle start/swap
        this.requestQueue.push({ llama, jobs: [] });
        this.sleepTimer?.reset();
        return this.getStatus(llama);
    }

    /**
     * Submit a completion request. Returns a promise that resolves with the response
     * once the model is active and the request is dispatched.
     */
    completions(req: LlamaRequest, opts?: { taskModel?: boolean }): Promise<LlamaResponse> {
        const job: Job = initJob(req);

        // For tasks, ensure we have a task model configured, then push to its queue
        if (opts?.taskModel) {
            if (!this.taskLlama) throw new Error(`LlamaManager: task model not configured`);
            this.taskQueue.push(job);
            return job.promise;
        }

        const llama: Llama | undefined = this.llamas.get(req.body.model);
        if (!llama) throw new Error(`LlamaManager: model not found: ${req.body.model}`);

        // Push job to existing queue entry or create a new one
        let found = false;
        for (const item of this.requestQueue) {
            if (item.llama === llama) {
                found = true;
                item.jobs.push(job);
                break;
            }
        }

        // Model not in queue: push job as new queue entry
        if (!found) this.requestQueue.push({ llama, jobs: [job] });

        return job.promise;
    }

    /**
     * Stop all active llama-server processes. Clears all queues and rejects any
     * pending jobs.
     */
    async stopServer(): Promise<void> {
        // Reject all pending jobs before clearing queues
        for (const item of this.requestQueue) {
            for (const job of item.jobs) {
                job.reject(new Error(`LlamaManager: server stopped`));
            }
        }

        for (const job of this.taskQueue) {
            job.reject(new Error(`LlamaManager: server stopped`));
        }

        this.requestQueue = [];
        this.taskQueue = [];

        const allLlamas = [...this.llamas.values()];
        if (this.taskLlama) allLlamas.push(this.taskLlama);
        await Promise.all(allLlamas.map(llama => this.#stop(llama)));
    }

    /**
     * Immediately SIGKILL any llama-server process (or its children), if they exist.
     * Returns without cleanup/checking to see if the process ended.
     */
    forceStopServer(): void {
        const allLlamas = [...this.llamas.values()];
        if (this.taskLlama) allLlamas.push(this.taskLlama);

        for (const llama of allLlamas) {
            if (!llama.active) continue;

            const pid = llama.active.proc.pid!;
            // we need an immediate exit, show no mercy
            console.log(chalk.dim(`killing llama-server process (pid ${pid}) (${chalk.yellow('SIGKILL')})...`));
            try { process.kill(-pid, 'SIGKILL') } catch { }
        }
    }

    /* -------------------- PRIVATE METHODS -------------------- */

    /**
     * Given a running llama-server process, sends an HTTP request to the server and
     * resolves/rejects the job with the result.
     */
    async #send(llama: Llama, job: Job): Promise<void> {
        if (!llama.active) return;

        const llamaURL = `http://${llama.serverHost}:${llama.serverPort}` + '/v1/chat/completions';

        // Increment active requests, preventing model swaps until this request is processed
        llama.active.requests++;

        let stream: LlamaStream | null = null;

        const { system: _system, ...inferenceParams } = llama.model.params;
        const body = {
            ...inferenceParams,
            ...job.request.body,
            timings_per_token: true,
            return_progress: true,
        };

        // When running close to context window limit, a prompt will sometimes crash
        // the llama-server process without correctly closing the response.
        //
        // We add a listener here that is cleaned up when the stream stops for any reason.
        const prematureExit = ((code: number | null, signal: NodeJS.Signals | null) => {
            stream?.destroy(new Error(`llama-server crashed; code=${code} signal=${signal}`));
        });

        llama.active.proc.once('exit', prematureExit);

        try {
            const response = await fetch(llamaURL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: job.request.signal,
                agent: LLAMA_HTTP_AGENT,
            });

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
            stream = new LlamaStream(response.body, expectSSE, job.request.signal);

            stream.once('stop', () => {
                if (llama.active) {
                    llama.active.requests--;
                    llama.active.proc.removeListener('exit', prematureExit);
                }
            });

            job.resolve({
                status: response.status,
                headers: response.headers,
                stream,
            });
        } catch (err: any) {
            if (llama.active) {
                llama.active.requests--;
                llama.active.proc.removeListener('exit', prematureExit);
            }
            
            job.reject(new Error(err));
        }
    }

    async #stop(llama: Llama): Promise<void> {
        if (!llama.active) return;

        // Shutdown handler that sends a kill signal to the process group, then waits
        // for a grace period. Resolves with `true` if shutdown occurred, `false` if
        // the grace period expired.
        const shutdownWithGracePeriod = async (
            pid: number,
            exited: Promise<void>,
            signal: string,
            gracePeriodMS: number,
        ): Promise<boolean> => {
            try { process.kill(-pid, signal) } catch { }

            return Promise.race([
                exited.then(() => true),
                new Promise<boolean>((resolve) => {
                    setTimeout(() => resolve(false), gracePeriodMS);
                }),
            ]);
        };

        const pid = llama.active.proc.pid!;
        const exited = llama.active.exited;

        // try a graceful shutdown first (SIGTERM)
        console.log(chalk.dim(`killing llama-server process (pid ${pid}) (${chalk.yellow('SIGTERM')})...`));
        if (await shutdownWithGracePeriod(pid, exited, 'SIGTERM', SHUTDOWN_GRACE_MS)) {
            console.log(chalk.green('done! (graceful shutdown)'));
            this.#logVRAM();
            return;
        }

        // grace period's up, now it's business (SIGKILL)
        //
        // *teleports behind you* "nothin personnel, kid"
        console.log(`failed to stop process gracefully, sending ${chalk.yellow('SIGKILL')}...`);
        if (await shutdownWithGracePeriod(pid, exited, 'SIGKILL', 2 * SHUTDOWN_GRACE_MS)) {
            console.log(chalk.yellow(`done! (forced shutdown)`));
            this.#logVRAM();
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
     * Sets `llama.active` synchronously, then polls until ready. On failure, kills the
     * process and resets `llama.active = null` before rejecting.
     *
     * @param llama The llama to start
     */
    #start(llama: Llama): Promise<void> {
        if (llama.active) throw new Error(`LlamaManager.#start: llama ${llama.model.name} already running`);

        const model: proto.ModelInfo = llama.model;

        // Open log file for `llama-server` stdout/stderr
        this.runCounter++;
        const [logPath, out, err] = createLogFiles(this.logDirectory, this.runCounter, llama);

        console.log(`\n[Run: ${this.runCounter}] starting llama-server with model: ${chalk.magenta(model.name)}`);
        console.log(chalk.dim(` - using log file: ${logPath}`));
        console.log(chalk.dim(` - llama server command: ${LLAMA_SERVER_BIN}`));

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
            console.error(`llama-server proc (${model.name}) err: ${err}`);
        });

        // Activate llama synchronously: create a promise that resolves and cleans up
        // when the process exits.
        llama.active = {
            requests: 0,
            proc: proc,
            // 'close' will only be emitted once the process exits AND all stdio streams
            // have been closed. 'exit' will be emitted once the process exits.
            //
            // `exit` will always be emitted before `close`. If we run into issues with zombies,
            // resolving/cleaning up on `close` might be better, as it should guarantee no I/O
            // is occurring.
            exited: new Promise<void>((resolve) => {
                proc.once('exit', (code, signal) => {
                    console.log(`llama-server exited code=${code} signal=${signal}`);

                    // clean up log files
                    try { fs.closeSync(out) } catch { }
                    try { fs.closeSync(err) } catch { }

                    llama.active = null;
                    resolve();
                });
            }),
        };

        // Poll llama-server instance
        return new Promise<void>((resolve, reject) => {
            this.#pollServer(llama)
                .then(async () => {
                    resolve();
                    this.#logVRAM();
                })
                .catch((err: any) => {
                    console.error(`LlamaManager.#start(${llama.model.name}): error when polling: ${err}`);
                    // Kill the process and reset active so the model can be retried
                    if (llama.active) {
                        try { process.kill(-llama.active.proc.pid!, 'SIGKILL') } catch { }
                    }
                    llama.active = null;
                    reject(err);
                });
        });
    }

    /**
     * Ping llama-server until we get a success, indicating the HTTP server is running.
     */
    async #pollServer(llama: Llama): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
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
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                retriesLeft--;
            }

            reject(`LlamaManager.#pollServer: timed out waiting for ${llama.model.name}`);
        });
    }

    #newSleepTimer(): { reset: () => void } {
        let timer: NodeJS.Timeout | null = null;

        const start = () => {
            timer = setTimeout(async () => {
                await this.#sleep();
            }, this.sleepAfterMs); // NOTE: add unref() ?
        };

        start();
        return {
            reset: () => {
                if (timer !== null) clearTimeout(timer);
                start();
            },
        };
    }

    async #sleep(): Promise<void> {
        // Check if any queued model is busy (has jobs or active requests)
        const mainBusy = this.requestQueue.some(item =>
            item.jobs.length > 0 || (item.llama.active?.requests ?? 0) > 0
        );
        const taskBusy = this.taskQueue.length > 0 || (this.taskLlama?.active?.requests ?? 0) > 0;

        if (mainBusy || taskBusy) {
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
            // nvidia-smi unavailable - skip silently
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
        ];
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

    getStatus(model: Llama | string): 'idle' | 'queued' | 'active' {
        const llama = typeof model === 'string' ? this.llamas.get(model) : model;
        if (!llama) {
            return 'idle';
        }

        if (llama.active) {
            return 'active';
        }

        if (this.requestQueue.some(l => l.llama === llama)) {
            return 'queued';
        }
        
        return 'idle';
    }
}

function initJob(request: LlamaRequest): Job {
    let resolve!: (value: LlamaResponse) => void;
    let reject!: (err: unknown) => void;
    const promise = new Promise<LlamaResponse>((res, rej) => { resolve = res; reject = rej });

    return {
        request,
        promise,
        resolve,
        reject,
    };
}

// File name example: `llama-{timestamp}_r0_gpt-oss-20b.log`
function createLogFiles(
    logDirectory: string,
    runCounter: number,
    llama: Llama,
): [string, number, number] {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const logFileName = `llama-${timestamp}_r${runCounter}_${llama.model.name}.log`;
    const logPath = path.join(logDirectory, logFileName);

    const out = fs.openSync(logPath, 'a');
    const err = fs.openSync(logPath, 'a');

    return [logPath, out, err];
}
