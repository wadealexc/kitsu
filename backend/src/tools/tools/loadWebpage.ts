import { z } from 'zod';

import type { Tool, ToolContext, ToolSession, BeforeRequestOptions, ToolEmit } from '../types.js';
import type { Browser } from '../../browser/browser.js';
import type { LlamaManager } from '../../llama/llamaManager.js';
import * as proto from '../../protocol/index.js';

const InputSchema = z.object({
    urls: z.array(z.url({
        protocol: /^https?$/,
        hostname: z.regexes.domain
    }))
}).describe(`a list of web pages to fetch content from`);

const OutputSchema = z.array(z.object({
    url: z.string(),
    content: z.string(),
})).describe(`an array of loaded web pages. if any pages fail to load, they will not be included in the output.`);

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

class LoadWebpage implements Tool<Input, Output> {

    browser: Browser;
    llama: LlamaManager;

    constructor(browser: Browser, llama: LlamaManager) {
        this.browser = browser;
        this.llama = llama;
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

    async call(input: Input, session: ToolSession, signal: AbortSignal, emit: ToolEmit): Promise<Output> {
        const urls: URL[] = input.urls.map(url => new URL(url));

        // Emit page list so frontend can show loading pills
        emit({
            type: 'pages',
            data: {
                urls: urls.map(u => ({ url: u.toString(), hostname: u.hostname })),
            },
        });

        // Early bail if context is already exhausted
        if (session.contextBudget !== undefined && session.contextBudget <= 0) {
            throw new Error('Context window is nearly full. Complete your answer without loading additional pages.');
        }

        const fetchCtrl = new AbortController();
        signal.addEventListener('abort', () => fetchCtrl.abort(), { once: true });

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
            _emitPageLoaded(emit, url);
        }

        // Emit page_failed for any URLs not loaded (see webSearch.ts for rationale)
        const loadedUrls = new Set(pages.map(p => p.url));
        for (const url of urls) {
            if (!loadedUrls.has(url.toString())) {
                _emitPageFailed(emit, url);
            }
        }

        if (pages.length === 0) {
            const budgetExhausted = session.contextBudget !== undefined && session.contextBudget <= 0;
            if (budgetExhausted) {
                throw new Error('Context window is nearly full. Complete your answer without loading additional pages.');
            }
            throw new Error('No pages could be loaded.');
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

export default function loadWebpage(ctx: ToolContext): Tool<Input, Output> {
    if (!ctx.browser) throw new Error(`loadWebpage: no browser available`);

    return new LoadWebpage(ctx.browser, ctx.llama);
}
