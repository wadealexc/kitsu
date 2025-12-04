import chalk from 'chalk';
import puppeteer from 'puppeteer';

import EventEmitter from 'events';
import * as Task from './taskManager.js';

// from: open_webui/retrieval/web/external.py
// NOTE: supports optional ChatID input, could use to link requests with other tasks
export type SearchRequest = {
    query: string,
    count: number,
};

type BraveSearchResult = {
    title: string,
    url: string,
    description: string,
}

export type SearchResponse = {
    link: string,
    title: string,
    snippet: string,
};

// from: open_webui/retrieval/loaders/external_web.py
export type LoadRequest = {
    urls: string[],
};

export type LoadResponse = {
    page_content: string,
    metadata: {},
};

const BRAVE_SEARCH_API = 'https://api.search.brave.com/res/v1/web/search';

// The max number of times we'll try to fetch from a given host each minute.
// This exists as a 'polite' request rate to ensure we don't clobber any website.
//
// e.g. if we try to load `youtube.com/kitty` and `youtube.com/doggo`, both
// apply towards the `youtube.com` rate limit.
const MAX_REQUESTS_PER_HOST_PER_MIN = 5;

// The max number of pages we'll try to load at once. This caps the number of
// `page.goto` tasks we have active at any given moment.
const MAX_CONCURRENT_PAGE_LOADS = 10;

// If a page load fails, we retry it up to this number of times
const MAX_RETRIES_PER_PAGE = 3;

// If a page load takes longer than this amount of time, we mark it "failed" and retry
const PAGE_LOAD_TIMEOUT_MS = 30000;

// How often we check for outstanding work
const PROCESS_TASKS_INTERVAL_MS = 100;

export type Document = {
    content: string,
    metadata: {
        source: URL
    }
};

type BrowserEvents = {
    done: () => void,
};

/**
 * `Browser` handles web search, page loading, and text extraction
 */
export class Browser {

    private emitter = new EventEmitter();

    private braveAPIKey: string;

    // TODO - we may want a browser pool to handle concurrent page loads better
    private browser: puppeteer.Browser;
    private rateLimits: Map<string, number> = new Map();

    // Active tasks (or those still relevant to rate-limiting)
    // - New tasks are added to `tasks.waiting` until a worker is assigned
    // - Tasks are moved to `tasks.active` when a worker is loading the page
    // - When a page is fully loaded and text is extracted, it is added to `this.documents`
    //   Also, the task is moved to `tasks.complete` so it can continue counting towards
    //   rate limiting for a minute. After a minute, the task will be removed from `tasks.complete`.
    private documents: Map<URL, Document> = new Map();
    private tasks = new Task.TaskManager<Document>(MAX_CONCURRENT_PAGE_LOADS);
    private taskLoop: {
        interval: NodeJS.Timeout,
        successes: number,
        total: number,
    } | undefined = undefined;

    // If we specifically get HTTP 429 - Too Many Requests, the host is added
    // to a blacklist so that we don't try to load it again until I can investigate
    // and figure out why we're triggering host-side ratelimiting.
    private hostBlacklist: Set<string> = new Set();

    private screenshotWebpages: boolean;

    constructor(
        browser: puppeteer.Browser,
        braveAPIKey: string,
        screenshotWebpages: boolean,
    ) {
        this.browser = browser;
        this.braveAPIKey = braveAPIKey;
        this.screenshotWebpages = screenshotWebpages;

        // When we receive a new task, spawn a worker if possible
        this.tasks.on('newTask', () => this.#startTaskLoop());
    }

    /* -------------------- SEARCH/TASK CREATION -------------------- */

    /**
     * Send a query to the brave search API and return the top `count` results.
     * 
     * If `loadPages` is true, `Browser.search` also starts background jobs to load
     * each returned webpage and extract the text into `Browser.documents`.
     * 
     * @param req the query and number of requested results
     * @param loadPages if true, start background job to load pages and extract text
     * @returns A list of URLs fetched from the Brave API
     */
    async search(req: SearchRequest, loadPages?: boolean): Promise<SearchResponse[]> {
        const searchResponses: SearchResponse[] = [];
        const urls: URL[] = [];

        // Search via brave search api
        const url = `${BRAVE_SEARCH_API}?q=${encodeURIComponent(req.query)}&count=${req.count}`;
        const response = await fetch(url, {
            method: 'get',
            headers: {
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'X-Subscription-Token': this.braveAPIKey,
            }
        });

        if (!response.ok) {
            const errorMsg = await response.text();
            throw new Error(`Browser.search: Brave API error: ${response.status}: ${errorMsg}`);
        }

        // Parse/collect responses
        const results = await response.json();
        for (const item of (results.web?.results as BraveSearchResult[])) {
            let url: URL;
            try { url = new URL(item.url) } catch (err: any) {
                console.error(`Browser.search: error parsing returned URL ${item.url}; skipping. Error: ${err}`);
                continue;
            }

            // Skip results that we won't be able to load
            // TODO - a bit leaky; should combine with canCreateTask somehow
            if (this.hostBlacklist.has(url.hostname)) continue;

            urls.push(url);
            searchResponses.push({
                link: url.toString(),
                title: item.title,
                snippet: item.description,
            });
        }

        // Start background jobs if requested
        if (loadPages) this.fetchContent(false, ...urls).forEach(promise => promise.catch(() => {}));
        return searchResponses;
    }

    /**
     * Start background jobs to load each page, assuming the url is eligible to be loaded
     * 
     * @returns a list of promises that resolve to each page's content
     */
    fetchContent(mustHaveTask: boolean, ...urls: URL[]): Promise<Document>[] {
        const results: Promise<Document>[] = [];

        for (const url of urls) {
            if (this.isHostBlacklisted(url)) {
                results.push(Promise.reject(`err: url is on host blacklist: ${url}`));
            } else {
                // 1. If we already have this content, resolve immediately
                // 2. If we're currently fetching this content, resolve when we fetch it
                // 3. Otherwise, create a new task and resolve when it's complete
                if (this.documents.has(url)) {
                    results.push(Promise.resolve(this.documents.get(url)!));
                } else if (this.tasks.has(url)) {
                    results.push(this.tasks.get(url)!.promise);
                } else {
                    if (mustHaveTask) {
                        results.push(Promise.reject(`required task did not exist for url: ${url}`));
                    } else {
                        results.push(this.tasks.create(url).promise);
                    }
                }
            }
        }

        return results;
    }

    /* -------------------- TASK MANAGEMENT -------------------- */

    /**
     * Calls `this.processTasks` in a regular interval.
     * 
     * Does nothing if an interval is already present.
     */
    #startTaskLoop() {
        if (this.taskLoop) {
            return;
        }

        this.taskLoop = {
            interval: setInterval(() => {
                this.processTasks();
            }, PROCESS_TASKS_INTERVAL_MS).unref(),
            successes: 0,
            total: 0,
        };
    }

    #stopTaskLoop() {
        if (!this.taskLoop) {
            return;
        }

        clearTimeout(this.taskLoop.interval);
        this.taskLoop = undefined;
    }

    /**
     * Main page load processing loop
     */
    async processTasks() {
        // End early if we don't have workers or work to do
        if (!this.tasks.hasNext()) return;
        if (!this.tasks.hasWorker()) return;

        // For each expired task, decrease the corresponding rate limit
        this.tasks.forEachExpired((task: Task.Expiry<Document>) => this.decRateLimit(task.url));
        // this.tasks.printInfo();

        while (this.tasks.hasWorker() && this.tasks.hasNext()) {
            const task = this.tasks.getNext()!;

            // Skip if needed (blacklist or rate limit)
            if (this.isHostBlacklisted(task.url)) {
                console.log(`Blacklisted host found in task list; skipping url: ${task.url}`);
                this.tasks.drop(task, `url is blacklisted: ${task.url}`);
                continue;
            } else if (this.getRateLimit(task.url) > MAX_REQUESTS_PER_HOST_PER_MIN) {
                console.log(`Rate limit encountered for url ${task.url}; deferring`);
                this.tasks.defer(task);
                continue;
            }

            // Update rate limit and page load attempts
            task.loadAttempts++;
            this.incRateLimit(task.url);
            if (this.taskLoop) this.taskLoop.total++;

            // Start task. If the task fails, defer it to be retried later.
            this.tasks.start(task);
            this.#loadPage(task.url)
                .then((result: Document) => {
                    if (this.taskLoop) this.taskLoop.successes++;
                    this.tasks.finish(task, result);
                })
                .catch((reason: any) => {
                    console.log(`loading page failed for url ${task.url}. reason: ${reason}`);

                    // Only retry up to MAX_RETRIES_PER_PAGE
                    if (task.loadAttempts >= MAX_RETRIES_PER_PAGE) {
                        console.log(` - max retries exceeded; dropping`);
                        this.tasks.drop(task, `max retries exceeded for ${task.url}`);
                    } else {
                        this.tasks.defer(task);
                    }
                })
                .finally(() => {
                    // If we have no pending and no active tasks, cancel the task loop interval
                    // ... it will restart if we push anything to `this.tasks.active`
                    if (this.tasks.allFinished()) {
                        this.#stopTaskLoop();
                        this.emitter.emit('done');
                    }
                });
        }
    }

    /**
     * Use `this.browser` to navigate to a page and extract text.
     * 
     * Steps:
     * - Create a new browser page and set the user agent
     * - Go to the webpage and wait for the main body to load
     * - Trim some unneeded elements
     * - Grab+return innerText (similar to "Ctrl A + Ctrl C")
     */
    async #loadPage(url: URL): Promise<Document> {
        const page: puppeteer.Page = await this.browser.newPage();
        await page.setUserAgent({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0' });

        return new Promise<Document>(async (resolve, reject) => {
            try {
                await this.#gotoPage(page, url);
                await page.waitForSelector('body');

                // Remove some elements we probably don't need
                await page.evaluate(() => {
                    document.body
                        .querySelectorAll('nav, header, footer, aside')
                        .forEach(element => element.remove());
                });

                // This is pretty close to the text you'd get from "Ctrl+A"
                const text = await page.evaluate(() => {
                    return document.body.innerText ?? '';
                });

                if (this.screenshotWebpages) {
                    await page.screenshot({ path: `./screenshots/${url.hostname}_${Date.now()}.png` });
                }

                // Cleanup!
                await page.close();

                // We're done - create a document with the fetched content
                const result: Document = {
                    content: text,
                    metadata: {
                        source: url
                    }
                }

                this.documents.set(url, result);
                resolve(result);
            } catch (err: any) {
                // Cleanup!
                await page.close();

                reject(err);
            }
        });
    }

    async #gotoPage(page: puppeteer.Page, url: URL): Promise<void> {
        const response = await page.goto(url.toString(), {
            timeout: PAGE_LOAD_TIMEOUT_MS,
            waitUntil: 'networkidle2', // wait until we there are no more than 2 network requests for 500 ms
            // waitUntil: 'domcontentloaded', // finish as soon as the DOM is built (does not wait for css/images/...)
            // signal: TODO - can add AbortSignal
        });

        if (!response) throw new Error(`null response from page.goto`);
        if (!response.ok()) {
            const code = response.status();
            const errText = await response?.text();

            // TODO - handle other 400-level codes
            if (code === 429) this.hostBlacklist.add(url.hostname);
            throw new Error(`error: ${code}`);
        }
    }

    async printStatus() {
        const pages = await this.browser.pages();
        this.tasks.printInfo();

        console.log(chalk.dim(` - pages open: ${pages.length}`));
        // if (pages.length !== 0) console.log(JSON.stringify(pages.map(page => page.url()), null, 2));

        const rateLimitStr = `[\n  ${Array.from(this.rateLimits)
            .map(([key, value]) => `  { "${key}": ${value} }`)
            .join(",\n  ")}\n]`;

        console.log(chalk.dim(` - rate limits:\n${rateLimitStr}`));
        console.log(chalk.dim(` - documents fetched for:\n${JSON.stringify(Array.from(this.documents.keys()), null, 2)}`))
    }

    isHostBlacklisted(url: URL): boolean {
        return this.hostBlacklist.has(url.hostname);
    }

    getRateLimit(url: URL): number {
        return this.rateLimits.get(url.hostname) ?? 0;
    }

    incRateLimit(url: URL) {
        this.rateLimits.set(url.hostname, this.getRateLimit(url) + 1);
    }

    decRateLimit(url: URL) {
        this.rateLimits.set(url.hostname, this.getRateLimit(url) - 1);
    }

    /* -------------------- EVENTS -------------------- */

    on<E extends keyof BrowserEvents>(event: E, listener: BrowserEvents[E]): this {
        this.emitter.on(event, listener as (...args: any[]) => void);
        return this;
    }

    once<E extends keyof BrowserEvents>(event: E, listener: BrowserEvents[E]): this {
        this.emitter.once(event, listener as (...args: any[]) => void);
        return this;
    }

    removeAllListeners<E extends keyof BrowserEvents>(event: E): this {
        this.emitter.removeAllListeners(event);
        return this;
    }

    /* -------------------- SHUTDOWN -------------------- */

    async shutdown() {
        console.log(chalk.dim(`shutting down browser...`));

        this.tasks.removeAllListeners('newTask');
        this.#stopTaskLoop();

        // Close pages individually before closing the browser
        const pages = await this.browser.pages();
        await Promise.all(pages.map(page => page.close()));
        await this.browser.close();

        console.log(chalk.green(`...done!`));

        // Print url blacklist to console for further investigation
        if (this.hostBlacklist.size !== 0) {
            const hosts = this.hostBlacklist.values().toArray();
            console.log(`Host Blacklist contains elements; printing:\n ${JSON.stringify(hosts, null, 2)}`);
        }
    }
}

// TODO - option for "run dangerously without sandbox", useful if someone
// wants to try out the project without extra effort
//
// ... then again, if i just dockerize this, that should fix it
export async function init(
    braveAPIKey: string,
    runDangerouslyWithoutSandbox: boolean,
    screenshotWebpages: boolean,
): Promise<Browser> {
    let puppet: puppeteer.Browser;
    if (runDangerouslyWithoutSandbox) {
        console.log(chalk.red(`Browser.browserInit: warning - starting browser process without sandbox`));

        puppet = await puppeteer.launch({
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false,
            args: [
                '--disable-http2',
                '--no-sandbox'
            ]
        });
    } else {
        console.log(`Browser.browserInit: starting browser...`);

        puppet = await puppeteer.launch({
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false,
            args: [
                '--disable-http2',
            ]
        });
    }

    process.stdout.write(chalk.dim.green(`web browser running!\n`));
    return new Browser(puppet, braveAPIKey, screenshotWebpages);
}