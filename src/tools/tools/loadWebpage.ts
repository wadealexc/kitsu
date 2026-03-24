import { z } from 'zod';

import type { Tool, ToolContext, BeforeRequestOptions } from '../types.js';
import type { Browser } from '../../browser/browser.js';
import * as proto from '../../protocol.js';

const MAX_PAGES_ALLOWED = 3;

const InputSchema = z.object({
    urls: z.array(z.url({
        protocol: /^https?$/,
        hostname: z.regexes.domain
    }))
}).describe(`a list of up to ${MAX_PAGES_ALLOWED} web pages to fetch content from`);

const OutputSchema = z.array(z.object({
    url: z.string(),
    content: z.string(),
})).describe(`an array of loaded web pages. if any pages fail to load, they will not be included in the output.`);

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

class LoadWebpage implements Tool<Input, Output> {

    browser: Browser;

    defaultResultCount: number = 3;

    constructor(browser: Browser) {
        this.browser = browser;
    }

    name(): string {
        return 'loadWebpage';
    }

    description(): string {
        return (
`If the user provides a URL and specifically requests you to load a webpage, use this tool to fetch that page's content.`
        );
    }

    inputSchema(): z.ZodType<Input> {
        return InputSchema;
    }

    beforeRequest(req: proto.CompletionRequest, opts: BeforeRequestOptions): proto.CompletionRequest {
        if (!opts.webSearchEnabled) {
            return { ...req, tools: req.tools?.filter(t => t.function.name !== 'loadWebpage') };
        }
        return req;
    }

    async call(input: Input, signal: AbortSignal): Promise<Output> {
        const urls: URL[] = input.urls.slice(0, MAX_PAGES_ALLOWED).map(url => new URL(url));
        const results: Output = [];

        (await Promise.allSettled(this.browser.fetchContent(false, signal, ...urls))).forEach(result => {
            if (result.status === 'fulfilled') {
                results.push({
                    content: result.value.content,
                    url: result.value.metadata.source.toString(),
                });
            } else {
                console.log(`/tools/loadWebpage: rejected promise: ${result.reason}`);
            }
        });

        return results;
    }
}

export default function loadWebpage(ctx: ToolContext): Tool<Input, Output> {
    if (!ctx.browser) throw new Error(`loadWebpage: no browser available`);

    return new LoadWebpage(ctx.browser);
}