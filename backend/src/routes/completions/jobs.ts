import { Writable } from 'node:stream';

/**
 * Generations that outlive the HTTP request that started them.
 *
 * A reply used to exist only inside its streaming request: when the connection
 * dropped (on iOS, whenever the app is suspended) the generation was aborted.
 * Now each reply runs as a job tied to its chat. Everything it streams is kept,
 * so any client can attach later, get the whole stream replayed, and follow the
 * rest live. Only an explicit stop (or the backend shutting down) aborts it.
 */

/** Something SSE text can be written to: an Express response, or a job. */
export type Sink = { write(chunk: string): unknown };

/** How long a finished job stays around so a returning client can replay its end. */
const KEEP_FINISHED_MS = 60_000;

export type JobStatus = 'running' | 'done' | 'stopped' | 'error';

type Subscriber = { write: (chunk: string) => void; end: () => void };

export class GenerationJob implements Sink {

    readonly startedAt = Date.now();
    readonly controller = new AbortController();
    status: JobStatus = 'running';

    private frames: string[] = [];
    private subscribers = new Set<Subscriber>();
    private finishedListeners: (() => void)[] = [];

    constructor(
        readonly chatId: string,
        readonly userId: string,
        /** The assistant message being written */
        readonly messageId: string | null,
    ) { }

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    write(chunk: string): void {
        this.frames.push(chunk);
        for (const s of this.subscribers) s.write(chunk);
    }

    /** A Writable for piping the model's stream into the job. */
    writable(): Writable {
        return new Writable({
            write: (chunk, _encoding, callback) => {
                this.write(chunk.toString());
                callback();
            },
        });
    }

    /**
     * Sends everything streamed so far, then the rest as it comes, ending when
     * the job finishes. Returns a function that stops following (the client left).
     */
    subscribe(subscriber: Subscriber): () => void {
        for (const frame of this.frames) subscriber.write(frame);
        if (this.status !== 'running') {
            subscriber.end();
            return () => { };
        }
        this.subscribers.add(subscriber);
        return () => this.subscribers.delete(subscriber);
    }

    stop(): void {
        if (this.status !== 'running') return;
        this.status = 'stopped';
        this.controller.abort();
    }

    finish(status: Exclude<JobStatus, 'running'>): void {
        if (this.status === 'running') this.status = status;
        for (const s of this.subscribers) s.end();
        this.subscribers.clear();
        for (const listener of this.finishedListeners) listener();
    }

    onFinished(listener: () => void): void {
        this.finishedListeners.push(listener);
    }
}

/** Jobs by chat id: one reply at a time per chat. */
export class JobRegistry {

    private jobs = new Map<string, GenerationJob>();

    get(chatId: string): GenerationJob | undefined {
        return this.jobs.get(chatId);
    }

    /** Starts a job for a chat; throws if one is already running there. */
    start(chatId: string, userId: string, messageId: string | null): GenerationJob {
        const existing = this.jobs.get(chatId);
        if (existing?.status === 'running') throw new JobConflict();

        const job = new GenerationJob(chatId, userId, messageId);
        this.jobs.set(chatId, job);
        job.onFinished(() => {
            setTimeout(() => {
                if (this.jobs.get(chatId) === job) this.jobs.delete(chatId);
            }, KEEP_FINISHED_MS).unref();
        });
        return job;
    }

    /** Chats this user has a reply running in. */
    running(userId: string): { chatId: string; messageId: string | null; startedAt: number }[] {
        return [...this.jobs.values()]
            .filter(j => j.userId === userId && j.status === 'running')
            .map(j => ({ chatId: j.chatId, messageId: j.messageId, startedAt: j.startedAt }));
    }

    /** Stops everything, e.g. on shutdown. */
    stopAll(): void {
        for (const job of this.jobs.values()) job.stop();
    }
}

export class JobConflict extends Error {
    constructor() {
        super('A reply is already being generated in this chat');
    }
}

export const jobs = new JobRegistry();
