import type { Tool, JsonSchema, ToolContext } from './toolServer.js';
import * as browser from '../browser/browser.js';

// type WebResult = browser.LoadResponse;


type Input = {
    terms: string[],
};

type LoadedPage = {
    url: string,
    content: string,
}

type Output = LoadedPage[];

const inputSchema: JsonSchema = {
    type: 'object',
    description: 'List of search terms to query the web search API',
    properties: {
        terms: {
            type: 'array',
            description: 'Search terms',
            items: { type: 'string' },
            // minItems: 1, TODO
            // maxItems: 3,
        },
    },
    required: ['terms'],
    additionalProperties: false,
};

const outputSchema: JsonSchema = {
    type: 'array',
    description: 'Array of loaded web search results',
    items: {
        type: 'object',
        description: 'A single web page result',
        properties: {
            url: {
                type: 'string',
                description: 'URL of the webpage',
            },
            content: {
                type: 'string',
                description: 'Content of the webpage',
            },
        },
        required: ['url', 'content'],
        additionalProperties: false,
    },
};

export default function webSearch(ctx: ToolContext): Tool<Input, Output> {
    const browser = ctx.browser;
    const defaultCount = 3;
    if (!browser) throw new Error(`webSearch: no browser configured`);

    return {
        name(): string {
            return 'webSearch';
        },

        description(): string {
            return 'Search the web using the configured search API and return a list of loaded webpages';
        },

        strict(): boolean {
            return false;
        },

        inputSchema(): JsonSchema {
            return inputSchema;
        },

        outputSchema(): JsonSchema {
            return outputSchema;
        },

        async call(input: Input): Promise<Output> {
            const responses = await browser.searchMulti(input.terms, defaultCount, true);
            const pages: LoadedPage[] = [];

            const urls: URL[] = [];
            responses.forEach(response => {
                try { urls.push(new URL(response.link)) } catch (err: any) {
                    console.log(`/tools/webSearch: malformed url ${response.link}; skipping`);
                }
            });

            (await Promise.allSettled(browser.fetchContent(true, ...urls))).forEach(result => {
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
        },
    };
}
