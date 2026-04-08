import { z } from 'zod';

import type { Tool, ToolContext, ToolSession, BeforeRequestOptions, ToolEmit } from '../types.js';
import type { Browser } from '../../browser/browser.js';
import type { LlamaManager } from '../../llama/llamaManager.js';
import * as proto from '../../protocol/index.js';
import { fetchPagesRace, type FetchUrlEntry } from './webSearchUtils.js';

const MAX_SEARCH_TERMS = 3;

// Over-fetch by this multiplier relative to RETURN_COUNT, so we have
// pages to buffer for moreResults follow-ups.
const FETCH_MULTIPLIER = 2;

// Number of pages per query to return to the model
const RETURN_COUNT = 3;

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
- If provided, the moreResults tool can be used to fetch additional pages from the prior queries.

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

    async call(input: Input, session: ToolSession, signal: AbortSignal, emit: ToolEmit): Promise<Output> {
        const queries: string[] = input.queries.slice(0, MAX_SEARCH_TERMS);
        const FETCH_COUNT = FETCH_MULTIPLIER * RETURN_COUNT;

        // Mark webSearch as called so moreResults becomes available this round
        session.webSearchCalled = true;

        // Get the current Brave API offset for these queries (for multi-call pagination)
        const currentOffset = session.searchState.get(queries[0] ?? '') ?? 0;

        // Search with FETCH_COUNT results so we have extras to buffer
        let responses = await this.browser.searchMulti(queries, FETCH_COUNT, false, signal, currentOffset);

        // Filter URLs already seen in this conversation
        let filtered = responses.filter(r => !session.seenUrls.has(r.link));

        // If filtering left us short, do a one-shot backfill from the next offset page
        if (filtered.length < FETCH_COUNT) {
            try {
                const backfillOffset = currentOffset + FETCH_COUNT;
                const backfillResponses = await this.browser.searchMulti(queries, FETCH_COUNT, false, signal, backfillOffset);
                const existingLinks = new Set(filtered.map(r => r.link));
                for (const r of backfillResponses) {
                    if (!session.seenUrls.has(r.link) && !existingLinks.has(r.link)) {
                        filtered.push(r);
                        existingLinks.add(r.link);
                        if (filtered.length >= FETCH_COUNT) break;
                    }
                }
            } catch (err) {
                console.log(`/tools/webSearch: backfill search failed: ${err}`);
            }
        }

        // Build URL entry list, skipping any malformed links
        const urlEntries: FetchUrlEntry[] = [];
        for (const response of filtered) {
            try {
                urlEntries.push({ urlObj: new URL(response.link), query: queries[0] ?? '' });
            } catch {
                console.log(`/tools/webSearch: malformed url ${response.link}; skipping`);
            }
        }

        // Emit search results so the frontend can display the query and target URLs
        emit({
            type: 'search_results',
            data: {
                queries,
                urls: urlEntries.map(e => ({ url: e.urlObj.toString(), hostname: e.urlObj.hostname })),
            },
        });

        // Race-style fetch: return pages as they load, buffer excess for moreResults
        const results = await fetchPagesRace({
            urlEntries,
            returnCount: RETURN_COUNT,
            session,
            browser: this.browser,
            llama: this.llama,
            signal,
            emit,
        });

        // Update per-query offsets so moreResults knows where to continue
        const nextOffset = currentOffset + FETCH_COUNT;
        for (const query of queries) {
            session.searchState.set(query, nextOffset);
        }

        if (results.length === 0) {
            throw new Error('Context window is nearly full. Complete your answer without additional web searches.');
        }

        return results;
    }
}

export default function webSearch(ctx: ToolContext): Tool<Input, Output> {
    if (!ctx.browser) throw new Error(`webSearch: no browser available`);

    return new WebSearch(ctx.browser, ctx.llama);
}