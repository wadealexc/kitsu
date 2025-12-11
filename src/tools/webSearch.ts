import { z } from './types.js';

import type { Tool, ToolContext } from './types.js';
import type { Browser } from '../browser/browser.js';

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

    strict(): boolean {
        return false;
    }

    inputSchema(): z.ZodType<Input> {
        return InputSchema;
    }

    outputSchema(): z.ZodType<Output> {
        return OutputSchema;
    }

    async call(input: Input): Promise<Output> {
        if (input.queries.length >= MAX_SEARCH_TERMS) {
            input.queries.slice(0, MAX_SEARCH_TERMS);
        }

        const responses = await this.browser.searchMulti(input.queries, this.defaultResultCount, true);
        const pages: Output = [];

        const urls: URL[] = [];
        responses.forEach(response => {
            try { urls.push(new URL(response.link)) } catch (err: any) {
                console.log(`/tools/webSearch: malformed url ${response.link}; skipping`);
            }
        });

        (await Promise.allSettled(this.browser.fetchContent(true, ...urls))).forEach(result => {
            if (result.status === 'fulfilled') {
                pages.push({
                    content: result.value.content,
                    url: result.value.metadata.source.toString(),
                });
            } else {
                console.log(`/tools/webSearch: rejected promise: ${result.reason}`);
            }
        });

        return pages;
    }
}

export default function webSearch(ctx: ToolContext): Tool<Input, Output> {
    if (!ctx.browser) throw new Error(`webSearch: no browser available`);

    return new WebSearch(ctx.browser);
}