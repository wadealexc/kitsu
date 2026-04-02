<script lang="ts">
    import { slide } from 'svelte/transition';
    import { quintOut } from 'svelte/easing';
    import { mobile, streamContext } from '$lib/stores';
    import type { ToolCallBlock } from '@backend/routes/types';
    import type { WebSearchProgress } from '$lib/apis/streaming';
    import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
    import ChevronUp from '$lib/components/icons/ChevronUp.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import Modal from '$lib/components/common/Modal.svelte';

    export let block: ToolCallBlock;
    export let progress: WebSearchProgress | undefined = undefined;

    // Start open during streaming (block.done=false), closed on page reload (block.done=true).
    // No reactive auto-close — the block stays open after done until the user closes it.
    let open: boolean = !block.done;

    $: isLive = !block.done;

    // --- Queries ---
    let queries: string[] = [];
    $: {
        if (isLive && progress) {
            queries = progress.queries;
        } else {
            try {
                const args = JSON.parse(block.arguments);
                queries = Array.isArray(args.queries) ? args.queries : [];
            } catch {
                queries = [];
            }
        }
    }

    // --- URL pills ---
    // During streaming: loaded pills appear before still-loading ones (visual cue for load order).
    // Failed pills are removed (filtered out in finalizeToolCalls before block.done is set).
    // On finalization: preserve the last live order so pills don't jump when isLive flips to false.
    // (block.result order is completion-time order, which differs from progress.urls order.)
    type Pill = { url: string; hostname: string; status: 'loading' | 'loaded' };

    let pills: Pill[] = [];
    let pillOrder: string[] = [];
    $: {
        if (isLive && progress) {
            const loaded = progress.urls
                .filter((u) => u.status === 'loaded')
                .map((u): Pill => ({ url: u.url, hostname: u.hostname, status: 'loaded' }));
            const loading = progress.urls
                .filter((u) => u.status === 'loading')
                .map((u): Pill => ({ url: u.url, hostname: u.hostname, status: 'loading' }));
            pills = [...loaded, ...loading];
            pillOrder = pills.map((p) => p.url);
        } else {
            try {
                const result: { url: string }[] = JSON.parse(block.result ?? '[]');
                const mapped = result.map((r) => {
                    let hostname = r.url;
                    try {
                        hostname = new URL(r.url).hostname;
                    } catch {}
                    return { url: r.url, hostname, status: 'loaded' as const };
                });
                if (pillOrder.length > 0) {
                    const orderMap = new Map(pillOrder.map((url, i) => [url, i]));
                    mapped.sort(
                        (a, b) =>
                            (orderMap.get(a.url) ?? Infinity) - (orderMap.get(b.url) ?? Infinity)
                    );
                }
                pills = mapped;
            } catch {
                pills = [];
            }
        }
    }

    // --- Ingestion progress bar (live only, while result is set but block not yet done) ---
    $: showIngestion =
        isLive && block.result !== undefined && $streamContext?.promptProcessing !== undefined;
    $: ingestionPct = $streamContext?.promptProcessing
        ? Math.round(
              ($streamContext.promptProcessing.processed / $streamContext.promptProcessing.total) *
                  100
          )
        : 0;

    // Strip the generic `www.` prefix from a hostname; preserve other subdomains.
    const displayHostname = (hostname: string) =>
        hostname.startsWith('www.') ? hostname.slice(4) : hostname;

    // --- Result modal ---
    let selectedResult: { url: string; content: string } | null = null;
    let showResultModal = false;

    const handlePillClick = (pillUrl: string) => {
        try {
            const results: { url: string; content: string }[] = JSON.parse(block.result ?? '[]');
            const match = results.find((r) => r.url === pillUrl);
            if (match) {
                selectedResult = match;
                showResultModal = true;
            }
        } catch {}
    };

    // --- Header text ---
    $: headerText = isLive
        ? 'Searching the web...'
        : `Fetched ${pills.length} page${pills.length !== 1 ? 's' : ''} via webSearch${
              block.duration === undefined
                  ? ''
                  : $mobile
                    ? ` (${block.duration}s)`
                    : ` in ${block.duration} seconds`
          }`;
</script>

<div
    class="w-fit text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition cursor-pointer"
    role="button"
    tabindex="0"
    on:pointerup={() => (open = !open)}
>
    <div
        class="w-full font-medium flex items-center justify-between gap-2 {isLive ? 'shimmer' : ''}"
    >
        {#if isLive}
            <div>
                <Spinner className="size-4" />
            </div>
        {/if}

        <div>
            {headerText}
        </div>

        <div class="flex self-center translate-y-[1px]">
            {#if open}
                <ChevronUp strokeWidth="3.5" className="size-3.5" />
            {:else}
                <ChevronDown strokeWidth="3.5" className="size-3.5" />
            {/if}
        </div>
    </div>
</div>

{#if open}
    <div
        class="mt-1.5 border-s-2 border-dotted border-s-gray-100 dark:border-gray-800 ps-3 flex flex-col gap-1.5 text-sm"
        transition:slide={{ duration: 300, easing: quintOut, axis: 'y' }}
    >
        {#if queries.length > 0}
            <div class="flex flex-wrap gap-1 items-center">
                <span class="text-xs text-gray-400 dark:text-gray-500">Queries:</span>
                {#each queries as q}
                    <span
                        class="text-xs bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 text-gray-600 dark:text-gray-300"
                        >"{q}"</span
                    >
                {/each}
            </div>
        {/if}

        {#if pills.length > 0}
            <div class="flex flex-wrap gap-1 items-center">
                <span class="text-xs text-gray-400 dark:text-gray-500">
                    {isLive ? 'Fetching:' : 'Fetched:'}
                </span>
                {#each pills as pill (pill.url)}
                    {#if pill.status === 'loaded'}
                        <!-- svelte-ignore a11y-click-events-have-key-events -->
                        <!-- svelte-ignore a11y-no-static-element-interactions -->
                        <span
                            class="text-xs rounded px-1.5 py-0.5 font-medium transition-colors duration-300 cursor-pointer bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900/70"
                            on:click={() => handlePillClick(pill.url)}
                        >
                            {displayHostname(pill.hostname)}
                        </span>
                    {:else}
                        <span
                            class="text-xs rounded px-1.5 py-0.5 font-medium transition-colors duration-300 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 animate-pulse"
                        >
                            {displayHostname(pill.hostname)}
                        </span>
                    {/if}
                {/each}
            </div>
        {/if}

        {#if showIngestion}
            <div class="flex flex-col gap-0.5">
                <span class="text-xs text-gray-400 dark:text-gray-500">
                    Ingesting {$streamContext?.promptProcessing?.total ?? 0} tokens... {ingestionPct}%
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

{#if showResultModal && selectedResult}
    <Modal size="lg" bind:show={showResultModal}>
        <div class="flex flex-col">
            <div
                class="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800"
            >
                <a
                    href={selectedResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline min-w-0"
                >
                    <span class="truncate">{selectedResult.url}</span>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="size-3.5 shrink-0"
                    >
                        <path
                            fill-rule="evenodd"
                            d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z"
                            clip-rule="evenodd"
                        />
                        <path
                            fill-rule="evenodd"
                            d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z"
                            clip-rule="evenodd"
                        />
                    </svg>
                </a>
                <button
                    aria-label="Close"
                    class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition"
                    on:click={() => (showResultModal = false)}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="size-4"
                    >
                        <path
                            d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                        />
                    </svg>
                </button>
            </div>
            <div class="max-h-[70vh] overflow-y-auto px-5 py-4">
                <pre
                    class="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300 font-sans">{selectedResult.content}</pre>
            </div>
        </div>
    </Modal>
{/if}
