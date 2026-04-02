import { z } from 'zod';

import type { Tool, ToolContext, BeforeRequestOptions, ToolEmit } from '../types.js';
import type { Browser } from '../../browser/browser.js';
import * as proto from '../../protocol.js';

const MAX_SEARCH_TERMS = 3;

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

    defaultResultCount: number = 3;

    constructor(browser: Browser) {
        this.browser = browser;
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

#### Web Search

* Use the web search tool whenever you require up-to-date information, or if you do not have sufficient context to answer a question. 
* Always keep in mind your training cutoff date vs the current date. Your job is to intelligently select whether a web search is needed.
* When referencing information sourced from the web search tool, cite your references using markdown syntax; e.g. "[link text/page title](url)"
* If a web search does not yield sufficient information to answer a query, consider performing a followup search.`
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

    async call(input: Input, signal: AbortSignal, emit: ToolEmit): Promise<Output> {
        const queries: string[] = input.queries.slice(0, MAX_SEARCH_TERMS);

        // 1. Search
        const responses = await this.browser.searchMulti(queries, this.defaultResultCount, true, signal);

        // 2. Build URL list
        const urls: URL[] = [];
        responses.forEach(response => {
            try { urls.push(new URL(response.link)) } catch (err: any) {
                console.log(`/tools/webSearch: malformed url ${response.link}; skipping`);
            }
        });

        // 3. Emit search results
        emit({
            type: 'search_results',
            data: {
                queries,
                urls: urls.map(u => ({ url: u.toString(), hostname: u.hostname })),
            },
        });

        // 4. Track individual page loads with per-page progress
        const pages: Output = [];
        const tracked = this.browser.fetchContent(true, signal, ...urls).map((p, i) => {
            const url = urls[i]!;
            return p
                .then(doc => {
                    emit({ type: 'page_loaded', data: { url: url.toString(), hostname: url.hostname } });
                    pages.push({ content: doc.content, url: doc.metadata.source.toString() });
                })
                .catch(reason => {
                    console.log(`/tools/webSearch: rejected promise: ${reason}`);
                    emit({ type: 'page_failed', data: { url: url.toString(), hostname: url.hostname } });
                });
        });

        await Promise.all(tracked);
        return pages;
    }
}

export default function webSearch(ctx: ToolContext): Tool<Input, Output> {
    if (!ctx.browser) throw new Error(`webSearch: no browser available`);

    return new WebSearch(ctx.browser);
}