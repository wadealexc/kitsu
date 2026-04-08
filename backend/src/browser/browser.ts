import chalk from 'chalk';
import { chromium, type Browser as PlaywrightBrowser, type Page, type BrowserContext } from 'playwright';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import EventEmitter from 'events';
import * as Task from './taskManager.js';

export type SearchRequest = {
    query: string,
    count: number,
    offset?: number,
};

type BraveSearchResult = {
    title: string,
    url: string,
    description: string,
}

export type SearchResult = {
    url: URL,
    title: string,
    snippet: string,
};

const BRAVE_SEARCH_API = 'https://api.search.brave.com/res/v1/web/search';

// Over-request from Brave to absorb filtering losses without needing a backfill round
const SEARCH_FETCH_MULTIPLIER = 2;

// Maximum number of paginated fetch rounds in searchMulti before giving up
const MAX_BACKFILL_ATTEMPTS = 5;

// The max number of times we'll try to fetch from a given host each minute.
// This exists as a 'polite' request rate to ensure we don't clobber any website.
//
// e.g. if we try to load `youtube.com/kitty` and `youtube.com/doggo`, both
// apply towards the `youtube.com` rate limit.
const MAX_REQUESTS_PER_HOST_PER_MIN = 20;

// The max number of pages we'll try to load at once. This caps the number of
// `page.goto` tasks we have active at any given moment.
const MAX_CONCURRENT_PAGE_LOADS = 20;

// If a page load fails, we retry it up to this number of times
const MAX_RETRIES_PER_PAGE = 3;

// If a page load takes longer than this amount of time, we mark it "failed" and retry
const PAGE_LOAD_TIMEOUT_MS = 10000;

// How often we check for outstanding work
const PROCESS_TASKS_INTERVAL_MS = 100;

// Resource types to block — we only need HTML text, not images/styles/fonts/media
const BLOCKED_RESOURCE_TYPES = ['image', 'stylesheet', 'font', 'media'];

// If Readability extracts less than this fraction of the raw page text, fall back to innerText.
// Prevents Readability from silently discarding most content on non-article pages
// (e.g. index pages, Q&A sites, SPAs where it grabs a small fragment instead of everything).
const READABILITY_MIN_RATIO = 0.2;

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
 * `Browser` handles web search, page loading, and text extraction.
 *
 * Search results come from the Brave Search API. Page content is loaded
 * via a Playwright-managed Chromium browser and extracted using Mozilla
 * Readability (with a textContent fallback for non-article pages).
 */
export class Browser {

    private emitter = new EventEmitter();

    private braveAPIKey: string;

    private browser: PlaywrightBrowser;
    private context: BrowserContext;
    private rateLimits: Map<string, number> = new Map();

    // Active tasks (or those still relevant to rate-limiting)
    // - New tasks are added to `tasks.waiting` until a worker is assigned
    // - Tasks are moved to `tasks.active` when a worker is loading the page
    // - Once a task completes, it is moved to `tasks.complete` so it can continue
    //   counting towards rate limiting for a minute.
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

    constructor(
        browser: PlaywrightBrowser,
        context: BrowserContext,
        braveAPIKey: string,
    ) {
        this.browser = browser;
        this.context = context;
        this.braveAPIKey = braveAPIKey;

        // When we receive a new task, spawn a worker if possible
        this.tasks.on('newTask', () => this.#startTaskLoop());
    }

    /* -------------------- SEARCH/TASK CREATION -------------------- */

    /**
     * Send a query to the Brave Search API and return the top `count` results.
     *
     * @param req the query and number of requested results
     * @param signal optional AbortSignal to cancel the request
     * @returns a list of search results from the Brave API
     */
    async search(req: SearchRequest, signal?: AbortSignal): Promise<SearchResult[]> {
        const searchResults: SearchResult[] = [];

        // Search via Brave Search API
        const url = `${BRAVE_SEARCH_API}?q=${encodeURIComponent(req.query)}&count=${req.count}&offset=${req.offset ?? 0}`;
        const response = await fetch(url, {
            method: 'get',
            signal,
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
            let itemUrl: URL;
            try { itemUrl = new URL(item.url) } catch (err: any) {
                console.error(`Browser.search: error parsing returned URL ${item.url}; skipping. Error: ${err}`);
                continue;
            }

            // Skip results that we won't be able to load
            if (this.hostBlacklist.has(itemUrl.hostname)) continue;

            searchResults.push({
                url: itemUrl,
                title: item.title,
                snippet: item.description,
            });
        }

        return searchResults;
    }

    /**
     * Run multiple search queries in parallel, dedup, filter against `filter` set,
     * and do one backfill round if results fall short of target.
     *
     * @param params.queries list of search queries to run in parallel
     * @param params.count desired number of results per query after filtering
     * @param params.filter URLs to exclude
     * @param params.signal optional AbortSignal to cancel requests
     * @returns flat, deduplicated, filtered array of SearchResult
     */
    async searchMulti(params: {
        queries: string[];
        count: number;
        filter?: Set<string>;
        signal?: AbortSignal;
    }): Promise<SearchResult[]> {
        const { queries, count, filter, signal } = params;
        const fetchSize = count * SEARCH_FETCH_MULTIPLIER;

        const fetchBatch = async (offset: number): Promise<SearchResult[]> => {
            const settled = await Promise.allSettled(
                queries.map(query => this.search({ query, count: fetchSize, offset }, signal))
            );

            const batch: SearchResult[] = [];
            for (const result of settled) {
                if (result.status === 'fulfilled') {
                    batch.push(...result.value);
                } else {
                    console.log(`searchMulti: skipping failed search; err: ${result.reason}`);
                }
            }

            return batch;
        };

        const results: SearchResult[] = [];
        const seen = new Set<string>(filter);

        const addResults = (batch: SearchResult[]) => {
            for (const r of batch) {
                const key = r.url.toString();
                if (!seen.has(key)) {
                    seen.add(key);
                    results.push(r);
                }
            }
        };

        const target = count * queries.length;
        let offset = 0;
        let attempts = 0;

        // Fetch URLs from search API until we hit our target result count
        // (or we exceed our attempt quota)
        while (results.length < target && attempts < MAX_BACKFILL_ATTEMPTS) {
            addResults(await fetchBatch(offset));
            offset += fetchSize;
            attempts++;
        }

        return results;
    }

    /**
     * Start background jobs to load each page, assuming the url is eligible to be loaded.
     *
     * @param mustHaveTask if true, only return promises for tasks that were already created
     * @param signal optional AbortSignal to cancel page loads
     * @param urls the URLs to fetch
     * @returns a list of promises that resolve to each page's content
     */
    fetchContent(mustHaveTask: boolean, signal: AbortSignal | undefined, ...urls: URL[]): Promise<Document>[] {
        const results: Promise<Document>[] = [];

        for (const url of urls) {
            if (this.isHostBlacklisted(url)) {
                results.push(Promise.reject(`err: url is on host blacklist: ${url}`));
            } else {
                // 1. If we're currently fetching this content, resolve when we fetch it
                // 2. Otherwise, create a new task and resolve when it's complete
                if (this.tasks.has(url)) {
                    results.push(this.tasks.get(url)!.promise);
                } else {
                    if (mustHaveTask) {
                        results.push(Promise.reject(`required task did not exist for url: ${url}`));
                    } else {
                        results.push(this.tasks.create(url, signal).promise);
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

        while (this.tasks.hasWorker() && this.tasks.hasNext()) {
            const task = this.tasks.getNext()!;

            // Skip if needed (blacklist or rate limit)
            if (this.isHostBlacklisted(task.url)) {
                console.log(`Blacklisted host found in task list; skipping url: ${task.url}`);
                this.tasks.drop(task, `url is blacklisted: ${task.url}`);
                continue;
            } else if (this.getRateLimit(task.url) > MAX_REQUESTS_PER_HOST_PER_MIN) {
                console.log(`Rate limit encountered for url ${task.url}; dropping`);
                this.tasks.drop(task, `url is self-ratelimited: ${task.url}`);
                continue;
            }

            // Update rate limit and move task to active state
            this.incRateLimit(task.url);
            if (this.taskLoop) this.taskLoop.total++;

            this.tasks.start(task);
            this.#loadPage(task.url, task.signal)
                .then((result: Document) => {
                    if (this.taskLoop) this.taskLoop.successes++;
                    this.tasks.finish(task, result);
                })
                .catch((reason: any) => {
                    const retryable = !(reason instanceof PageLoadError && !reason.retryable);
                    const retriesLeft = task.loadAttempts < MAX_RETRIES_PER_PAGE;

                    if (retryable && retriesLeft) {
                        console.log(`loading page failed for url ${task.url} (attempt ${task.loadAttempts}/${MAX_RETRIES_PER_PAGE}, will retry). reason: ${reason}`);
                        this.tasks.defer(task);
                    } else {
                        console.log(`loading page failed for url ${task.url} (dropping). reason: ${reason}`);
                        this.tasks.drop(task, reason);
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
     * Use `this.context` to navigate to a page and extract text content.
     *
     * Tries Mozilla Readability first for clean article extraction. Falls back to
     * stripping nav/header/footer/aside and grabbing innerText for non-article
     * pages (index pages, Q&A sites, SPAs, etc.).
     *
     * Readability is skipped if its output is less than READABILITY_MIN_RATIO of the
     * raw page text — this catches cases where it grabs a small article fragment
     * instead of the full page content.
     */
    async #loadPage(url: URL, signal?: AbortSignal): Promise<Document> {
        const page: Page = await this.context.newPage();

        try {
            await this.#gotoPage(page, url, signal);

            const html = await page.content();

            // Parse HTML twice: once to measure raw text length (before Readability
            // mutates the document), and once to feed Readability.
            // We use linkedom textContent throughout — page.evaluate + innerText is
            // unreliable when stylesheets are blocked (Chromium treats text as invisible).
            const rawLength = parseHTML(html).document.body?.textContent?.trim().length ?? 0;

            const { document: readabilityDoc } = parseHTML(html);
            const article = new Readability(readabilityDoc as any).parse();
            const articleLength = article?.textContent?.trim().length ?? 0;

            const useReadability = article !== null
                && articleLength > 0
                && (rawLength === 0 || articleLength / rawLength >= READABILITY_MIN_RATIO);

            let text: string;
            if (useReadability) {
                // Re-parse Readability's cleaned HTML for heading pre-processing.
                // textContent concatenates all text nodes with no block-level separation,
                // so we inject newlines + markdown markers on headings before extraction.
                const { document: articleDoc } = parseHTML(article!.content);
                for (const h of articleDoc.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
                    const level = parseInt(h.tagName[1]!);
                    const hashes = '#'.repeat(Math.min(level, 4));
                    (h as any).textContent = `\n\n${hashes} ${(h as any).textContent}\n`;
                }
                text = articleDoc.body?.textContent
                    || articleDoc.documentElement?.textContent
                    || article!.textContent
                    || '';
            } else {
                // Fallback: strip structural chrome from the raw HTML and extract text
                const { document: fallbackDoc } = parseHTML(html);
                for (const el of fallbackDoc.querySelectorAll('nav, header, footer, aside, script, style')) {
                    el.remove();
                }
                text = fallbackDoc.body?.textContent ?? '';
            }

            await page.close();

            return {
                content: normalizeWhitespace(text),
                metadata: { source: url },
            };
        } catch (err: any) {
            await page.close();
            throw err;
        }
    }

    /**
     * Navigate `page` to `url`, waiting for DOM content to load.
     *
     * Uses domcontentloaded (not networkidle2) for speed — resource blocking on
     * the context means there is little remaining network activity after DOM load.
     *
     * If `signal` is aborted, closes the page (which causes goto to reject).
     */
    async #gotoPage(page: Page, url: URL, signal?: AbortSignal): Promise<void> {
        const abortHandler = () => page.close();
        signal?.addEventListener('abort', abortHandler, { once: true });

        try {
            const response = await page.goto(url.toString(), {
                timeout: PAGE_LOAD_TIMEOUT_MS,
                waitUntil: 'domcontentloaded',
            });

            if (!response) throw new PageLoadError(`null response from page.goto`, false);
            if (!response.ok()) {
                const code = response.status();
                if (code === 429) this.hostBlacklist.add(url.hostname);
                throw new PageLoadError(`http error: ${code}`, false);
            }
        } catch (err: any) {
            // Playwright timeout → non-retryable
            if (err.name === 'TimeoutError') {
                throw new PageLoadError(`timeout loading ${url}`, false);
            }
            throw err;
        } finally {
            signal?.removeEventListener('abort', abortHandler);
        }
    }

    /* -------------------- STATUS -------------------- */

    printStatus() {
        const pages = this.context.pages();
        this.tasks.printInfo();

        console.log(chalk.dim(` - pages open: ${pages.length}`));

        const rateLimitStr = `[\n  ${Array.from(this.rateLimits)
            .map(([key, value]) => `  { "${key}": ${value} }`)
            .join(",\n  ")}\n]`;

        console.log(chalk.dim(` - rate limits:\n${rateLimitStr}`));
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

        // Close all open pages, then context, then browser
        await Promise.all(this.context.pages().map(page => page.close()));
        await this.context.close();
        await this.browser.close();

        console.log(chalk.green(`...done!`));

        // Print url blacklist to console for further investigation
        if (this.hostBlacklist.size !== 0) {
            const hosts = [...this.hostBlacklist.values()];
            console.log(`Host Blacklist contains elements; printing:\n ${JSON.stringify(hosts, null, 2)}`);
        }
    }
}

/**
 * Launch a Playwright Chromium browser and return an initialized Browser instance.
 *
 * Resource blocking (images, stylesheets, fonts, media) is set up on the context
 * so all pages automatically skip these resource types during load.
 */
export async function init(
    braveAPIKey: string,
    runDangerouslyWithoutSandbox: boolean,
): Promise<Browser> {
    if (runDangerouslyWithoutSandbox) {
        console.log(chalk.red(`Browser.init: warning - starting browser process without sandbox`));
    } else {
        console.log(`Browser.init: starting browser...`);
    }

    const browser = await chromium.launch({
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        chromiumSandbox: !runDangerouslyWithoutSandbox,
        args: [
            '--disable-http2',
        ],
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0',
    });

    // Block resources we don't need for text extraction
    await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (BLOCKED_RESOURCE_TYPES.includes(type)) {
            return route.abort();
        }
        return route.continue();
    });

    process.stdout.write(chalk.dim.green(`web browser running!\n`));
    return new Browser(browser, context, braveAPIKey);
}

/* -------------------- ERRORS -------------------- */

/**
 * Error thrown during page loading. `retryable` indicates whether the task
 * manager should re-queue this task or drop it immediately.
 */
class PageLoadError extends Error {
    retryable: boolean;

    constructor(message: string, retryable: boolean) {
        super(message);
        this.retryable = retryable;
    }
}

/* -------------------- HELPERS -------------------- */

/**
 * Normalize extracted page text before returning it to callers.
 *
 * - Trims trailing whitespace from each line
 * - Collapses runs of more than 2 consecutive blank lines into one
 * - Trims leading/trailing whitespace from the whole string
 *
 * Keeps legitimate paragraph breaks and code block spacing intact while
 * removing the redundant whitespace that both Readability and innerText
 * commonly produce.
 */
function normalizeWhitespace(text: string): string {
    const lines = text.split('\n').map(l => l.trimEnd());

    const result: string[] = [];
    let blankRun = 0;
    for (const line of lines) {
        if (line === '') {
            blankRun++;
            if (blankRun <= 1) result.push(line);
        } else {
            blankRun = 0;
            result.push(line);
        }
    }

    return result.join('\n').trim();
}
