<script lang="ts">
    /**
     * One tool call from an MCP server. What it shows depends on the result's
     * shape rather than the tool's name, so any server's tools display sensibly:
     * - search results (`structured.results`: url, title) as links
     * - pages (progress `page` events, or `structured.pages`) as pills
     * - anything else as a one-line summary, with the raw result on request
     */
    import { slide } from 'svelte/transition';
    import { quintOut } from 'svelte/easing';
    import { mobile, streamContext } from '$lib/stores';
    import type { ToolCallBlock } from '@backend/routes/types';
    import type { ToolProgressState, UrlStatus } from '$lib/apis/completions';
    import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
    import ChevronUp from '$lib/components/icons/ChevronUp.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import Modal from '$lib/components/common/Modal.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';

    export let block: ToolCallBlock;
    export let progress: ToolProgressState | undefined = undefined;

    // Open while running; closed when reloaded from history.
    let open: boolean = !block.done;

    $: isLive = !block.done;

    const hostnameOf = (url: string): string => {
        try {
            const host = new URL(url).hostname;
            return host.startsWith('www.') ? host.slice(4) : host;
        } catch {
            return url;
        }
    };

    const record = (value: unknown): Record<string, unknown> =>
        value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

    let args: Record<string, unknown> = {};
    $: {
        try {
            args = record(JSON.parse(block.arguments || '{}'));
        } catch {
            args = {};
        }
    }

    $: structured = record(block.structured);

    // Arguments as the model sent them, indented for reading
    $: prettyArguments = (() => {
        try {
            return JSON.stringify(JSON.parse(block.arguments || '{}'), null, 2);
        } catch {
            return block.arguments;
        }
    })();

    type Result = { url: string; title: string; snippet?: string };
    $: results = (Array.isArray(structured.results) ? structured.results : [])
        .map(record)
        .filter((r) => typeof r.url === 'string')
        .map((r): Result => ({
            url: r.url as string,
            title: typeof r.title === 'string' && r.title ? r.title : hostnameOf(r.url as string),
            ...(typeof r.snippet === 'string' ? { snippet: r.snippet } : {})
        }));

    $: query =
        typeof structured.query === 'string'
            ? structured.query
            : typeof args.query === 'string'
              ? args.query
              : undefined;

    // A page pill. `range` is where the page's text sits in the result, if the server says;
    // `content` is the page's text in results from kitsu's old built-in tools.
    type Page = UrlStatus & { title?: string; range?: [number, number]; content?: string };

    /**
     * Chats from before MCP have calls to the old built-in webSearch/loadWebpage
     * tools: arguments {queries} or {urls}, result a JSON list of {url, content}.
     */
    $: legacyPages = (() => {
        if (block.structured || !block.result || block.failed) return null;
        try {
            const parsed = JSON.parse(block.result);
            if (!Array.isArray(parsed) || !parsed.every((p) => p && typeof p.url === 'string')) return null;
            return parsed as { url: string; content?: string }[];
        } catch {
            return null;
        }
    })();
    $: legacyQueries = Array.isArray(args.queries) ? args.queries.filter((q): q is string => typeof q === 'string') : [];

    // Pages: from the result once it's in, live from progress until then
    let pages: Page[] = [];
    $: {
        const finished = (Array.isArray(structured.pages) ? structured.pages : []).map(record);
        if (finished.length > 0) {
            pages = finished
                .filter((p) => typeof p.url === 'string')
                .map((p): Page => {
                    const url = (typeof p.finalUrl === 'string' ? p.finalUrl : p.url) as string;
                    const ok = p.outcome === 'ok' || p.outcome === 'low_quality';
                    const range = Array.isArray(p.textRange) && p.textRange.length === 2 &&
                        p.textRange.every((n) => typeof n === 'number')
                        ? (p.textRange as [number, number])
                        : undefined;
                    return {
                        url,
                        hostname: hostnameOf(url),
                        status: ok ? 'loaded' : 'failed',
                        ...(typeof p.title === 'string' && p.title ? { title: p.title } : {}),
                        ...(range ? { range } : {})
                    };
                });
        } else if (legacyPages && !isLive) {
            const loaded = legacyPages.map((p): Page => ({
                url: p.url,
                hostname: hostnameOf(p.url),
                status: 'loaded',
                content: p.content ?? ''
            }));
            // Old loadWebpage: requested pages missing from the result failed
            const requested = Array.isArray(args.urls) ? args.urls.filter((u): u is string => typeof u === 'string') : [];
            const failed = requested
                .filter((u) => !legacyPages!.some((p) => p.url === u))
                .map((u): Page => ({ url: u, hostname: hostnameOf(u), status: 'failed' }));
            pages = [...loaded, ...failed];
        } else if (isLive && progress && progress.pages.length > 0) {
            pages = progress.pages;
        } else if (!isLive && Array.isArray(args.urls)) {
            pages = args.urls
                .filter((u): u is string => typeof u === 'string')
                .map((url) => ({ url, hostname: hostnameOf(url), status: block.failed ? 'failed' : 'loaded' }));
        } else {
            pages = progress?.pages ?? [];
        }
    }

    $: loadedCount = pages.filter((p) => p.status === 'loaded').length;
    $: failedCount = pages.filter((p) => p.status === 'failed').length;
    $: plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

    $: duration =
        block.duration === undefined ? '' : $mobile ? ` (${block.duration}s)` : ` in ${block.duration}s`;

    $: headerText = isLive
        ? (progress?.message ?? (query ? `Searching for “${query}”` : `Running ${block.name}`))
        : results.length > 0
          ? `${plural(results.length, 'result')} for “${query ?? ''}”${duration}`
          : legacyQueries.length > 0 && pages.length > 0
            ? `Read ${plural(loadedCount, 'page')} for “${legacyQueries.join('”, “')}”${duration}`
          : pages.length > 0
            ? loadedCount > 0
                ? `Read ${plural(loadedCount, 'page')}${failedCount ? ` · ${failedCount} failed` : ''}${duration}`
                : `Couldn't load ${plural(pages.length, 'page')}${duration}`
            : block.failed
              ? `${block.name} failed${duration}`
              : `Used ${block.name}${duration}`;

    // While the model reads a large result
    $: showIngestion =
        isLive && block.result !== undefined && $streamContext?.promptProcessing !== undefined;
    $: ingestionPct = $streamContext?.promptProcessing
        ? Math.round(
              ($streamContext.promptProcessing.processed / $streamContext.promptProcessing.total) * 100
          )
        : 0;

    // The page whose text is open, or 'raw' for the whole result
    let viewing: Page | 'raw' | null = null;
    let showViewer = false;
    const view = (what: Page | 'raw') => {
        viewing = what;
        showViewer = true;
    };

    /** One page's text: its slice of the result, or all of it for a single page. */
    const pageContent = (page: Page): string => {
        if (page.content !== undefined) return page.content;
        const result = block.result ?? '';
        if (page.range) return result.slice(page.range[0], page.range[1]).trim();
        return pages.length === 1 ? result : '';
    };
    const canOpen = (page: Page) => !!block.result && !!pageContent(page);

    const pillClass: Record<UrlStatus['status'], string> = {
        loaded: 'bg-green-100 dark:bg-green-900/40 !text-green-700 dark:!text-green-300 hover:bg-green-200 dark:hover:bg-green-900/70',
        loading: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 animate-pulse',
        failed: 'bg-red-100 dark:bg-red-900/30 !text-red-600 dark:!text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50'
    };
</script>

<div class="group flex items-center gap-1.5 max-w-full">
<div
    class="w-fit min-w-0 max-w-full text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition cursor-pointer"
    role="button"
    tabindex="0"
    on:pointerup={() => (open = !open)}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (open = !open)}
>
    <div class="w-full font-medium flex items-center gap-2 {isLive ? 'shimmer' : ''}">
        {#if isLive}
            <div class="shrink-0">
                <Spinner className="size-4" />
            </div>
        {/if}

        <div class="truncate">{headerText}</div>

        <div class="flex self-center translate-y-[1px] shrink-0">
            {#if open}
                <ChevronUp strokeWidth="3.5" className="size-3.5" />
            {:else}
                <ChevronDown strokeWidth="3.5" className="size-3.5" />
            {/if}
        </div>
    </div>
</div>
{#if block.result && !isLive}
    <!-- Shown on hover; on touch screens (no hover), while the block is open -->
    <Tooltip content="View raw" placement="top">
        <button
            type="button"
            aria-label="View raw"
            class="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100 {open
                ? '[@media(hover:none)]:opacity-100'
                : '[@media(hover:none)]:hidden'}"
            on:click|stopPropagation={() => view('raw')}
        >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="size-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
            </svg>
        </button>
    </Tooltip>
{/if}
</div>

{#if open}
    <div
        class="mt-1.5 border-s-2 border-dotted border-s-gray-100 dark:border-gray-800 ps-3 flex flex-col gap-1.5 text-sm"
        transition:slide={{ duration: 300, easing: quintOut, axis: 'y' }}
    >
        {#if results.length > 0}
            <!-- Search results: pills like the page pills; each opens the site -->
            <div class="flex flex-col items-start gap-1">
                {#each results as r (r.url)}
                    <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={r.snippet ?? r.title}
                        class="group/pill max-w-full inline-flex items-center gap-1.5 text-xs rounded px-1.5 py-0.5 !no-underline transition-colors bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
                    >
                        <span class="shrink-0 font-medium !text-sky-700 dark:!text-sky-300">{hostnameOf(r.url)}</span>
                        <span class="truncate !font-normal !text-gray-600 dark:!text-gray-300">{r.title}</span>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden="true"
                            class="size-3 shrink-0 text-gray-400 dark:text-gray-500 group-hover/pill:text-gray-700 dark:group-hover/pill:text-gray-200"
                        >
                            <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clip-rule="evenodd" />
                            <path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clip-rule="evenodd" />
                        </svg>
                    </a>
                {/each}
            </div>
        {/if}

        {#if pages.length > 0}
            <div class="flex flex-wrap gap-1 items-center">
                {#each pages as page (page.url)}
                    {#if page.status === 'loading' || !canOpen(page)}
                        <span class="text-xs rounded px-1.5 py-0.5 font-medium {pillClass[page.status]}">
                            {hostnameOf(page.url)}
                        </span>
                    {:else}
                        <button
                            type="button"
                            title={page.title ?? page.url}
                            class="text-xs rounded px-1.5 py-0.5 font-medium transition-colors duration-300 cursor-pointer {pillClass[page.status]}"
                            on:click={() => view(page)}
                        >
                            {hostnameOf(page.url)}
                        </button>
                    {/if}
                {/each}
            </div>
        {/if}

        {#if block.failed && pages.length === 0 && block.result}
            <div class="text-xs text-red-600 dark:text-red-300">{block.result}</div>
        {/if}

        {#if showIngestion}
            <div class="flex flex-col gap-0.5">
                <span class="text-xs text-gray-400 dark:text-gray-500">
                    Reading {$streamContext?.promptProcessing?.total ?? 0} tokens… {ingestionPct}%
                </span>
                <div class="h-1 w-48 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                    <div
                        class="h-full bg-blue-400 dark:bg-blue-500 transition-all duration-200"
                        style="width: {ingestionPct}%"
                    ></div>
                </div>
            </div>
        {/if}

    </div>
{/if}

{#if showViewer && viewing}
    <Modal size="lg" bind:show={showViewer}>
        <div class="flex flex-col">
            <div
                class="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800"
            >
                {#if viewing === 'raw'}
                    <div class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                        {block.name}{block.server ? ` · ${block.server}` : ''}
                    </div>
                {:else}
                    <a
                        href={viewing.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline min-w-0"
                    >
                        <span class="truncate">{viewing.url}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-3.5 shrink-0">
                            <path fill-rule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clip-rule="evenodd" />
                            <path fill-rule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clip-rule="evenodd" />
                        </svg>
                    </a>
                {/if}
                <button
                    aria-label="Close"
                    class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
                    on:click={() => (showViewer = false)}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-4">
                        <path
                            d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                        />
                    </svg>
                </button>
            </div>
            <div class="max-h-[70vh] overflow-y-auto px-5 py-4 flex flex-col gap-3">
                {#if viewing === 'raw'}
                    <!-- What the model sent, then what the tool returned -->
                    <section class="flex flex-col gap-1.5">
                        <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {'Input'}
                        </div>
                        <pre
                            class="whitespace-pre-wrap break-words rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono">{prettyArguments}</pre>
                    </section>
                    <section class="flex flex-col gap-1.5">
                        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {'Result'}
                            {#if block.failed}
                                <span class="normal-case tracking-normal font-medium rounded px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">{'Error'}</span>
                            {/if}
                        </div>
                        <pre
                            class="whitespace-pre-wrap break-words rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono">{block.result}</pre>
                    </section>
                {:else}
                    <pre
                        class="whitespace-pre-wrap break-words text-sm text-gray-700 dark:text-gray-300 font-sans">{pageContent(viewing)}</pre>
                {/if}
            </div>
        </div>
    </Modal>
{/if}
