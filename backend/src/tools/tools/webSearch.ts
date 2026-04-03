import { z } from 'zod';

import type { Tool, ToolContext, BeforeRequestOptions, ToolEmit } from '../types.js';
import type { Browser } from '../../browser/browser.js';
import * as proto from '../../protocol/index.js';

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

#### webSearch

- Allows the assistant to search the web and use the results to inform responses
- Provides up-to-date information for current events and recent data
- Use this tool for accessing information beyond your knowledge cutoff

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