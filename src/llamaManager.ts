import path from 'path';
import * as fs from 'node:fs';
import { spawn, ChildProcess } from 'child_process';
import fetch, { type RequestInit, Response } from 'node-fetch';
import type { IncomingHttpHeaders } from 'node:http';

import chalk from 'chalk';

import * as utils from './utils.js';
import { type ModelConfig, type ModelInfo } from './config.js';

// Command to start llama‑server via submodule
const DEFAULT_LLM_COMMAND = './llama.cpp/build/bin/llama-server';

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

// How often to check `lastActiveMs` to trigger auto-sleep
const SLEEP_MONITOR_INTERVAL_MS = 500;

type ActiveProcess = {
    proc: ChildProcess,
    currentModel: ModelInfo,
    sleepTimer: {
        reset: () => void,
        clear: () => void,
    },
    exited: Promise<void>,
};

/**
 * LlamaManager manages llamas.
 * 
 * This thing is basically "in charge" of a single llama.cpp process. It creates the process,
 * handles prompts while the process is alive, and tears down the process when requested.
 */
export class LlamaManager {

    private llamaServerCommand: string;
    private llamaServerIP: string;
    private llamaServerPort: string;
    private llamaServerURL: string;
    private llamaServerVerboseLogs: boolean;

    private llama: ActiveProcess | null = null;
    private defaultModel: string;
    private models: Map<string, ModelInfo>;

    private runCounter = 0;
    private activeRequests = 0;
    private restartInProgress: Promise<void> | null = null;
    private sleepAfterMs: number;

    private logDirectory: string;
    private logFilePrefix: string;

    constructor(params: {
        llamaServerIP: string, llamaServerPort: number, llamaServerVerbose: boolean,
        logDirectory: string, logFilePrefix: string,
        sleepAfterXSeconds: number,
        models: ModelConfig,
    }) {
        this.llamaServerCommand = DEFAULT_LLM_COMMAND;
        this.llamaServerIP = params.llamaServerIP;
        this.llamaServerPort = params.llamaServerPort.toString();
        this.llamaServerURL = `http://${params.llamaServerIP}:${params.llamaServerPort}`;
        this.llamaServerVerboseLogs = params.llamaServerVerbose;

        // Map models s.t. (key == model name, value == model info)
        this.defaultModel = params.models.onStart;
        this.models = new Map(params.models.infos.map(model => [
            model.name,
            model,
        ]));

        if (!this.models.has(this.defaultModel)) {
            throw new Error(`LlamaManager.constructor: onStart model not found ${this.defaultModel}`);
        }

        this.sleepAfterMs = params.sleepAfterXSeconds * 1000;

        this.logDirectory = params.logDirectory;
        this.logFilePrefix = params.logFilePrefix;

        // Start llama-server with default model
        this.ready(params.models.onStart);
    }

    /* -------------------- PUBLIC METHODS -------------------- */

    /**
     * Prepare a llama-server process using the requested model.
     * 
     * If there's an existing process and it's using a different model, kill it first.
     * This can take some time, because the old server needs to be shut down and the
     * new model needs to be loaded.
     * 
     * This method will throw if:
     * - we have an active `forwardRequest` (TODO - have it wait?)
     * - we're currently 
     * - we don't have a GGUF corresponding to `modelName`
     * 
     * @param modelName The name of the model for which we should have a corresponding GGUF
     */
    async ready(modelName: string, useVision?: boolean) {
        if (this.restartInProgress) await this.restartInProgress;

        // If we need vision, switch the requested modelName for our vision model
        if (modelName === 'auto') {
            if (useVision) {
                modelName = this.getVisionModels().at(0)
                    ?? (() => { throw new Error(`vision model auto-requested, but none loaded`) })();
            } else {
                modelName = this.defaultModel;
            }

            console.log(chalk.dim(`(auto) routing request to model: ${modelName}`));
        }

        if (this.llama?.currentModel.name === modelName) return; // no work needed
        // If we have any outstanding requests, throw (TODO - wait here)
        if (this.activeRequests !== 0) throw new Error(`LlamaManager.ready: attempted restart while requests active`);

        // We need to start a new llama-server process for the model, and maybe
        // shut down an existing process. Create a promise that will be resolved
        // when this is complete.
        this.runCounter++;
        this.restartInProgress = new Promise<void>(async (resolve) => {
            try {
                await this.stopServer();
                await this.#startServer(this.models.get(modelName)!);
                await this.#pollServer();
            } finally {
                this.restartInProgress = null;
                resolve();
            }
        });

        await this.restartInProgress;
    }

    /**
     * Kill the llama-server process, if it's running. Attempts a graceful shutdown,
     * using SIGTERM and waiting `SHUTDOWN_GRACE_MS`. If this does not succeed, this
     * method sends SIGKILL and waits `2 * SHUTDOWN_GRACE_MS`.
     * 
     * If the process is still running, throws an error.
     */
    async stopServer() {
        if (!this.llama) return;
        const pid = this.llama.proc.pid!;

        // Shutdown handler that sends a kill signal to the process group, then waits
        // for a grace period. Resolves with `true` if shutdown occurred, `false` if
        // the grace period expired.
        const shutdownWithgracePeriod = (async (signal: string, pid: number, gracePeriodMS: number) => {
            try { process.kill(-pid, signal) } catch { };

            return Promise.race([
                new Promise<boolean>(async (resolve) => {
                    if (this.llama) await this.llama.exited;

                    resolve(true);
                }),
                new Promise<boolean>((resolve) => {
                    setTimeout(() => resolve(false), gracePeriodMS);
                })
            ])
        });

        // try a graceful shutdown first (SIGTERM)
        console.log(chalk.dim(`killing llama-server process (pid ${pid}) (${chalk.yellow('SIGTERM')})...`));
        if (await shutdownWithgracePeriod('SIGTERM', pid, SHUTDOWN_GRACE_MS)) {
            console.log(chalk.green('done! (graceful shutdown)'));
            return;
        }

        // grace period's up, now it's business (SIGKILL)
        //
        // *teleports behind you* "nothin personnel, kid"
        console.log(`failed to stop process gracefully, sending ${chalk.yellow('SIGKILL')}...`);
        if (await shutdownWithgracePeriod('SIGKILL', pid, 2 * SHUTDOWN_GRACE_MS)) {
            console.log(chalk.yellow(`done! (forced shutdown)`));
            return;
        }

        // if we don't get a shutdown, burn it all to the ground
        throw new Error(`failed to kill llama-server (pid ${pid}) (model ${this.llama.currentModel.name})`);
    }

    /**
     * Immediately SIGKILL any llama-server process (or its children), if they exist
     * Returns without cleanup/checking to see if the process ended.
     */
    forceStopServer() {
        if (!this.llama) return;
        const pid = this.llama.proc.pid!;

        // we need an immediate exit, show no mercy
        console.log(chalk.dim(`killing llama-server process (pid ${pid}) (${chalk.yellow('SIGKILL')})...`));
        try { process.kill(-pid, 'SIGKILL') } catch { };
    }

    async forwardRequest(req: {
        originalURL: string,
        headers: IncomingHttpHeaders,
        method: string,
        body: any,
    }): Promise<Response> {
        // If the llama-server process is being restarted, wait for it to complete before continuing
        if (this.restartInProgress) {
            console.log(`LlamaManager.forwardRequest: restart in progress, waiting...`);
            try { await this.restartInProgress }
            catch (err) { console.error(`LlamaManager.forwardRequest: restart failed: ${err}, continuing with model: ${this.llama?.currentModel.name}`) }
        }

        if (!this.llama) throw new Error(`LlamaManager.forwardRequest: no llama process found!`);

        // Increment active requests, preventing calls to `restartServer` until this request is processed
        // Note: this does NOT prevent direct calls to `stopServer` or `forceStopServer`, as we don't want
        // to block shutdown.
        this.activeRequests++;
        this.llama.sleepTimer.reset();

        try {
            const llamaURL = this.llamaServerURL + req.originalURL;

            // Convert IncomingHttpHeaders to HeadersInit
            const headers: HeadersInit = {};
            for (const [key, value] of Object.entries(req.headers)) {
                if (typeof value === 'string') headers[key] = value;
                else if (Array.isArray(value)) headers[key] = value.join(', ');
            }

            // ensure Host header matches target
            headers["host"] = this.llamaServerURL;

            // Construct request
            const init: RequestInit = {
                method: req.method,
                headers,
                body: !(req.method === 'GET' || req.method === 'HEAD') ? req.body : undefined,
            };

            // TODO - wrap with a promise that decrements activeRequests when it ends
            // (currently the finally branch runs while the stream is still ongoing)
            return fetch(llamaURL, init);
        } finally {
            this.activeRequests--;
        }
    }

    /* -------------------- PRIVATE METHODS -------------------- */

    /**
     * Start a new `llama-server` process, loading the GGUF file located at `modelPath`.
     * Opens a logfile for the process, and starts `llama-server` as a detached process
     * in its own process group.
     * 
     * Also sets up this.llamaExited, which resolves when the process exits.
     * 
     * @param modelPath Path to the GGUF file to load into llama-server
     */
    async #startServer(model: ModelInfo) {
        if (this.llama) throw new Error(`LlamaManager.startServer: llama process already running`);

        // Open log file for `llama-server` stdout/stderr
        // File name example: `llama-{timestamp}_r0_gpt-oss-20b.log`
        const logFileName =
            this.logFilePrefix +
            '_r' + this.runCounter.toString() +
            '_' + model.name + '.log';
        const logPath = path.join(this.logDirectory, logFileName);

        // Open log file for child process stdout/stderr
        console.log(`\n[Run: ${this.runCounter}] starting llama-server with model: ${chalk.magenta(model.name)}`);
        console.log(chalk.dim(` - using log file: ${logPath}`));
        console.log(chalk.dim(` - llama server command: ${this.llamaServerCommand}`));
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
        const proc = spawn(this.llamaServerCommand, args, {
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

        // Setting this.llama:
        // - tells other methods there is an active llama-server process
        // - creates a promise that resolves and cleans up when the process exits
        // - starts a timer that will kill the process if it doesn't get activity
        //   before `this.sleepAfterMs`
        this.llama = {
            proc: proc,
            currentModel: model,
            sleepTimer: this.#newSleepTimer(this.sleepAfterMs),
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
                    this.llama?.sleepTimer.clear();

                    // clean up log files
                    try { fs.closeSync(out) } catch { };
                    try { fs.closeSync(err) } catch { };

                    this.llama = null;
                    resolve();
                });
            }),
        };
    }

    /**
     * Ping `llamaServerURL` until we get a success, indicating the HTTP server is running
     */
    async #pollServer(): Promise<void> {
        return new Promise<void>(async (resolve, reject) => {
            if (!this.llama) {
                reject(`LlamaManager.#pollServer: llama-server died before polling`);
                return;
            }

            process.stdout.write(chalk.dim(` - loading model: ${chalk.magenta(this.llama.currentModel.name)}\n`));

            let retriesLeft = NUM_RETRIES;

            while (retriesLeft !== 0) {
                if (!this.llama) {
                    reject(`LlamaManager.#pollServer: llama-server died while polling`);
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
                            `${chalk.dim.green(`model loaded!`)} ${chalk.magenta(this.llama.currentModel.name)} ` +
                            `is listening on port ${chalk.cyan(this.llamaServerPort)} ` +
                            `(pid ${this.llama.proc.pid}) ` +
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
        // We should be cleaning up properly when our active process exits
        if (!this.llama) {
            console.error(`sleep timer elapsed, but no active process exists!`);
            return;
        }

        // No need to stop server if we're actually doing things
        if (this.restartInProgress) {
            console.log(`sleep timer elapsed, but llama seems busy; skipping (restart)`);
            return;
        } else if (this.activeRequests !== 0) {
            console.log(`sleep timer elapsed, but llama seems busy; skipping (${this.activeRequests} active requests)`)
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

    getFrontendModels(): string[] {
        return [
            'auto',
            ...this.getBaseModels(),
            ...this.getVisionModels(),
        ]
    }

    getBaseModels(): string[] {
        return [
            ...this.models.values()
                .filter(v => v.mmprojPath === undefined)
                .map(model => model.name)
        ];
    }

    getVisionModels(): string[] {
        return [
            ...this.models.values()
                .filter(v => typeof v.mmprojPath === 'string')
                .map(model => model.name)
        ];
    }
}