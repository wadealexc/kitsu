import { z } from 'zod';

import type { Tool, ToolContext, ToolSession, BeforeRequestOptions, ToolEmit } from '../types.js';
import type { Browser } from '../../browser/browser.js';
import type { LlamaManager } from '../../llama/llamaManager.js';
import * as proto from '../../protocol/index.js';

const MAX_SEARCH_TERMS = 3;

// Number of pages per query to return to the model
const RETURN_COUNT_PER_QUERY = 3;

const InputSchema = z.object({
    queries: z.array(z.string())
}).describe(`a list of up to ${MAX_SEARCH_TERMS} search terms to query`);

const OutputSchema = z.array(z.object({
    url: z.string(),
    content: z.string(),
})).describe(`an array of loaded web page results`);

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

class WebSearch implements Tool<Input, Output> {

    browser: Browser;
    llama: LlamaManager;

    constructor(browser: Browser, llama: LlamaManager) {
        this.browser = browser;
        this.llama = llama;
    }

    name(): string {
        return 'webSearch';
    }

    description(): string {
        return (
            `Search the web using the configured search API and return content loaded from relevant webpages`
        );
    }

    // Added to system prompt
    systemPromptSnippet(): string {
        return (
            `

#### webSearch

- Allows the assistant to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Use this tool for accessing information beyond your knowledge cutoff
- If the results retrieved are insufficient, the assistant can use the webSearch tool again.

IMPORTANT - Use the correct year in search queries:
  - The current date is provided in your system prompt. You MUST use this year when searching for recent information.
  - Example: If the user asks for "latest React docs", search for "React documentation" with the current year, NOT last year

REQUIREMENT - You MUST follow this when using the webSearch tool:
  - After answering the user's question, you MUST include a "Sources:" section at the end of your response
  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)
  - Example format:

    [Your answer here]

    Sources:
    - [Source Title 1](https://example.com/1)
    - [Source Title 2](https://example.com/2)
`
        );
    }

    inputSchema(): z.ZodType<Input> {
        return InputSchema;
    }

    beforeRequest(req: proto.CompletionRequest, opts: BeforeRequestOptions): proto.CompletionRequest {
        if (!opts.webSearchEnabled) {
            return { ...req, tools: req.tools?.filter(t => t.function.name !== 'webSearch') };
        }

        let newReq: proto.CompletionRequest = req;

        const snippet = this.systemPromptSnippet();
        let systemPrompt = newReq.messages.at(0);

        // If the request has no system prompt, ... that's weird. Panic. Run.
        if (systemPrompt === undefined || systemPrompt.role !== 'system') {
            throw new Error(`no system prompt`);
        } else if (typeof systemPrompt.content !== 'string') {
            throw new Error(`system prompt contains text chunks`);
        }

        // Add the system prompt snippet
        systemPrompt.content += snippet;
        newReq.messages[0] = systemPrompt;

        return newReq;
    }

    /**
     * Search for input queries via browser search API, then fetch webpages
     * and extract content.
     * 
     * Fetched pages are tokenized to check against context limits, and dropped
     * if adding them would exceed available context.
     * 
     * @returns extracted webpages for ingestion by llm
     */
    async call(input: Input, session: ToolSession, signal: AbortSignal, emit: ToolEmit): Promise<Output> {
        const queries: string[] = input.queries.slice(0, MAX_SEARCH_TERMS);

        const results = await this.browser.searchMulti({
            queries,
            count: RETURN_COUNT_PER_QUERY,
            filter: session.seenUrls,
            signal,
        });

        // Build URL entry list for fetch
        const urls: URL[] = results.map(r => r.url);

        // Emit search results so the frontend can display the query and target URLs
        emit({
            type: 'search_results',
            data: {
                queries,
                urls: urls.map(e => ({ url: e.toString(), hostname: e.hostname })),
            },
        });

        // Race-style fetch: return pages as they load
        const pages = await fetchPagesRace({
            urls,
            returnCount: queries.length * RETURN_COUNT_PER_QUERY,
            session,
            browser: this.browser,
            llama: this.llama,
            signal,
            emit,
        });

        if (pages.length === 0) {
            throw new Error('Context window is nearly full. Complete your answer without additional web searches.');
        }

        return pages;
    }
}

export default function webSearch(ctx: ToolContext): Tool<Input, Output> {
    if (!ctx.browser) throw new Error(`webSearch: no browser available`);

    return new WebSearch(ctx.browser, ctx.llama);
}

/* -------------------- FETCH HELPERS -------------------- */

/**
 * Fetch pages from a list of URLs using a race-style settlement queue.
 *
 * As pages load, each is tokenized and checked against the context budget.
 * Pages that fit within budget (and under returnCount) are added to results.
 *
 * When contextBudget is undefined (no context limit configured), pages are
 * returned in arrival order up to returnCount with no budget checking.
 *
 * @returns array of up to returnCount pages that fit within budget
 */
async function fetchPagesRace(params: {
    urls: URL[];
    returnCount: number;
    session: ToolSession;
    browser: Browser;
    llama: LlamaManager;
    signal: AbortSignal;
    emit: ToolEmit;
}): Promise<Array<{ url: string; content: string }>> {
    const { urls, returnCount, session, browser, llama, signal, emit } = params;

    // Early bail if no urls, or context is already exhausted
    if (urls.length === 0) return [];
    if (session.contextBudget !== undefined && session.contextBudget <= 0) return [];

    /* -------------------- SETTLEMENT QUEUE -------------------- */

    type SettledPage = { url: string; content: string };

    const settledQueue: Array<SettledPage | null> = [];
    let notifyWaiter: (() => void) | undefined;
    let inFlightCount = urls.length;

    const signalSettled = (item: SettledPage | null): void => {
        settledQueue.push(item);
        inFlightCount--;
        const n = notifyWaiter;
        notifyWaiter = undefined;
        n?.();
    };

    // Launch all fetches
    const fetchPromises = browser.fetchContent(false, signal, ...urls);

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i]!;
        const promise = fetchPromises[i]!;
        promise
            .then(doc => signalSettled({ url: url.toString(), content: doc.content }))
            .catch(() => signalSettled(null));
    }

    /* -------------------- CONSUMER LOOP -------------------- */

    const results: Array<{ url: string; content: string }> = [];

    while (results.length < returnCount) {
        // Wait for at least one settled item if the queue is empty
        if (settledQueue.length === 0) {
            if (inFlightCount === 0) break;
            await new Promise<void>(resolve => { notifyWaiter = resolve; });
        }

        // Drain currently available settled items
        while (settledQueue.length > 0 && results.length < returnCount) {
            const item = settledQueue.shift()!;

            if (item === null) continue;  // Page load failed

            // Check whether the page fits within the remaining context budget
            let fitsInBudget = true;
            if (session.contextBudget !== undefined) {
                if (session.contextBudget <= 0) {
                    fitsInBudget = false;
                } else {
                    const tokenCount = await llama.tokenize(item.content, session.model, signal);
                    if (tokenCount > session.contextBudget) {
                        fitsInBudget = false;
                    } else {
                        session.contextBudget -= tokenCount;
                    }
                }
            }

            const hostname = (() => {
                try { return new URL(item.url).hostname; } catch { return item.url; }
            })();

            if (!fitsInBudget) {
                emit({ type: 'page_loaded', data: { url: item.url, hostname } });
                continue;
            }

            results.push({ url: item.url, content: item.content });
            session.seenUrls.add(item.url);
            emit({ type: 'page_loaded', data: { url: item.url, hostname } });
        }
    }

    return results;
}