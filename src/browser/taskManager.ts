import chalk from 'chalk';

import EventEmitter from 'events';

import type { Prettify } from '../utils.js';

/**
 * The most basic browser task represents a request to load a page
 */
export type PageLoad<T> = {
    url: URL,
    loadAttempts: number,
    promise: Promise<T>,
    resolveFn: (result: T) => void,
    rejectFn: (err: any) => void,
    signal?: AbortSignal,
};

/**
 * Once a page has been loaded, we keep it around for a period of time
 * to include it in rate limit calculations. `Expiry` defines that time.
 */
export type Expiry<T> = Prettify<PageLoad<T> & {
    expiryTime: number,
}>;

/**
 * If we give up on loading a page and want to try again later, we can
 * use `Deferred`.
 */
export type Deferred<T> = Prettify<PageLoad<T> & {
    retryTime?: number,
}>;

type TaskEvents<T> = {
    newTask: () => void,
};

export class TaskManager<T> {

    private emitter = new EventEmitter();

    private maxWorkers: number;

    private active: PageLoad<T>[] = [];
    private waiting: PageLoad<T>[] = [];
    private deferred: Deferred<T>[] = [];
    private complete: Expiry<T>[] = [];

    constructor(maxWorkers: number) {
        this.maxWorkers = maxWorkers;
    }

    /**
     * Create a new `waiting` task for a url
     *
     * @emits `create` after adding tasks to `this.waiting`
     */
    create(url: URL, signal?: AbortSignal): PageLoad<T> {
        let resolveFn: ((result: T) => void);
        let rejectFn: ((err: any) => void);

        const promise = new Promise<T>((resolve, reject) => {
            resolveFn = resolve;
            rejectFn = reject;
        });

        const task: PageLoad<T> = {
            url: url,
            loadAttempts: 0,
            promise,
            resolveFn: resolveFn!,
            rejectFn: rejectFn!,
            signal,
        };

        this.waiting.push(task);
        this.emitter.emit('newTask');
        return task;
    }

    /* -------------------- INCOMPLETE TASKS -------------------- */

    /**
     * Removes a task from `this.waiting/this.deferred` and places it into `this.active`
     * 
     * @throws if the task was not found in either `this.waiting` or `this.deferred`
     */
    start(task: PageLoad<T>) {
        task.loadAttempts++;
        this.#mustRemoveTask(task, ...[this.waiting, this.deferred]);

        this.active.push(task);
    }

    /**
     * Moves a task from `this.active` and into `this.complete`
     * 
     * @throws if the task is not in `this.active`
     */
    finish(task: PageLoad<T>, result: T) {
        this.#mustRemoveTask(task, this.active);
        
        this.complete.push({
            ...task,
            expiryTime: Date.now() + 60000
        });

        task.resolveFn(result);
    }

    /**
     * Remove a task from `this.active|this.waiting`, and place it in `this.deferred`
     * 
     * @throws if the task was not found in `this.active|this.waiting`
     */
    defer(task: PageLoad<T>, retryTime?: number) {
        this.#mustRemoveTask(task, ...[this.active, this.waiting]);

        this.deferred.push({
            ...task,
            retryTime: retryTime ?? Date.now(),
        });
    }

    /**
     * Remove a task from any incomplete task buckets, and don't add it back to any queue
     * 
     * @throws if the task is not found
     * @effect calls `task.rejectFn`
     */
    drop(task: PageLoad<T>, err: any) {
        this.#mustRemoveTask(task, ...[this.active, this.waiting, this.deferred]);

        task.rejectFn(err);
    }

    /* -------------------- COMPLETED TASKS -------------------- */

    /**
     * Iterate over `this.complete`, calling the callback function for any
     * task that has reached its expiry.
     * 
     * @effect once this method completes, any expired tasks are removed from `this.complete`
     */
    forEachExpired(cb: (task: Expiry<T>) => void) {
        const newArray = this.complete.filter((task) => {
            if (Date.now() > task.expiryTime) {
                cb(task);
                return false; // Remove task
            }

            return true; // Keep task
        });

        this.complete = newArray;
    }

    /* -------------------- HELPERS -------------------- */

    /**
     * Attempt to remove a task from one or more queues. If the task is not found in any
     * queue, returns false. Otherwise, returns true.
     *
     * @returns true if the task was removed from at least one queue
     */
    #tryRemoveTask(task: PageLoad<T>, ...queues: PageLoad<T>[][]): boolean {
        let removed = false;

        for (const queue of queues) {
            const idx = queue.findIndex(t => t.url.toString() === task.url.toString());
            if (idx === -1) continue;

            queue.splice(idx, 1);
            removed = true;
        }

        return removed;
    }

    /**
     * Remove a task from one or more queues, throwing an error if the task
     * was not removed from any queues
     *
     * @throws if the task was not removed from any queues
     */
    #mustRemoveTask(task: PageLoad<T>, ...queues: PageLoad<T>[][]) {
        if (!this.#tryRemoveTask(task, ...queues)) {
            throw new Error(`TaskManager.mustRemoveTask: task not found in queue`);
        }
    }

    /* -------------------- EVENTS/GETTERS -------------------- */

    on<E extends keyof TaskEvents<T>>(event: E, listener: TaskEvents<T>[E]): this {
        this.emitter.on(event, listener as (...args: any[]) => void);
        return this;
    }

    removeAllListeners<E extends keyof TaskEvents<T>>(event: E): this {
        this.emitter.removeAllListeners(event);
        return this;
    }

    /**
     * Returns true if any of our task buckets has the input url
     */
    has(url: URL): boolean {
        return this.get(url) ? true : false;
    }

    get(url: URL): PageLoad<T> | undefined {
        const match = (task: PageLoad<T>): boolean => {
            return task.url.toString() === url.toString();
        }

        return (
            this.complete.find(match) ||
            this.active.find(match) ||
            this.waiting.find(match) ||
            this.deferred.find(match)
        );
    }

    hasWorker(): boolean {
        return this.workersAvailable() > 0;
    }

    workersAvailable(): number {
        return this.maxWorkers - this.active.length;
    }

    /**
     * @returns true if there are tasks that can be assigned workers in
     * either `this.waiting` or `this.deferred`
     */
    hasNext(): boolean {
        const next = this.getNext();

        return this.getNext() ? true : false;
    }

    /**
     * Returns an assignable task from either `this.waiting` or `this.deferred`
     * Prefers tasks in `this.deferred`, since we want to prioritize older jobs
     * 
     * @returns an assignable task, if one exists (undefined otherwise)
     */
    getNext(): PageLoad<T> | undefined {
        let task = this.deferred.find(task => Date.now() > (task.retryTime ?? 0));
        if (task) return task;

        return this.waiting.at(0);
    }

    /**
     * @returns true if we have no work in `this.active`, and nothing pending
     * in `this.waiting/this.deferred`
     */
    allFinished(): boolean {
        return this.active.length === 0 && this.waiting.length === 0 && this.deferred.length === 0;
    }

    printInfo() {
        process.stdout.write(`===TaskState===` + chalk.dim(` 
 - workers (active: ${this.active.length} | available: ${this.workersAvailable()})
 - inactive tasks (waiting: ${this.waiting.length} | deferred: ${this.deferred.length})            
 - keeping ${this.complete.length} complete tasks for rate limit calcs\n`
        ));
    }
}