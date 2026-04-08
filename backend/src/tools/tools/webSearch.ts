import { z } from 'zod';

import type { Tool, ToolContext, ToolSession, BeforeRequestOptions, ToolEmit } from '../types.js';
import type { Browser } from '../../browser/browser.js';
import type { LlamaManager } from '../../llama/llamaManager.js';
import * as proto from '../../protocol/index.js';

// Number of pages per query to return to the model
const RETURN_COUNT_PER_QUERY = 3;

const InputSchema = z.object({
    queries: z.array(z.string())
}).describe(`a list of search terms to query`);

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
        const { queries } = input;

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

        // Early bail if context is already exhausted
        if (session.contextBudget !== undefined && session.contextBudget <= 0) {
            throw new Error('Context window is nearly full. Complete your answer without additional web searches.');
        }

        // Derivative signal so we can abort in-flight fetches (and kill the
        // generator promptly) without affecting the parent request.
        const fetchCtrl = new AbortController();
        signal.addEventListener('abort', () => fetchCtrl.abort(), { once: true });

        const returnCount = queries.length * RETURN_COUNT_PER_QUERY;
        const pages: Output = [];

        for await (const result of this.browser.fetchContentRace(fetchCtrl.signal, ...urls)) {
            if (!result.ok) {
                _emitPageFailed(emit, result.url);
                continue;
            }

            const doc = result.doc;
            const url = doc.metadata.source;

            // Budget check: tokenize page and verify it fits
            if (session.contextBudget !== undefined) {
                if (session.contextBudget <= 0) {
                    _emitPageFailed(emit, url);
                    fetchCtrl.abort();
                    break;
                }

                const tokenCount = await this.llama.tokenize(doc.content, session.model, signal);
                if (tokenCount > session.contextBudget) {
                    _emitPageFailed(emit, url);
                    continue;
                }

                session.contextBudget -= tokenCount;
            }

            pages.push({ url: url.toString(), content: doc.content });
            session.seenUrls.add(url.toString());
            _emitPageLoaded(emit, url);

            if (pages.length >= returnCount) {
                fetchCtrl.abort();
                break;
            }
        }

        if (pages.length === 0) {
            const budgetExhausted = session.contextBudget !== undefined && session.contextBudget <= 0;
            if (budgetExhausted) {
                throw new Error('Context window is nearly full. Complete your answer without additional web searches.');
            }
            throw new Error('No pages could be loaded from the search results.');
        }

        return pages;
    }
}

function _emitPageLoaded(emit: ToolEmit, url: URL) {
    emit({
        type: 'page_loaded',
        data: {
            url: url.toString(),
            hostname: url.hostname,
        }
    });
}

function _emitPageFailed(emit: ToolEmit, url: URL) {
    emit({
        type: 'page_failed',
        data: {
            url: url.toString(),
            hostname: url.hostname,
        }
    });
}

export default function webSearch(ctx: ToolContext): Tool<Input, Output> {
    if (!ctx.browser) throw new Error(`webSearch: no browser available`);

    return new WebSearch(ctx.browser, ctx.llama);
}