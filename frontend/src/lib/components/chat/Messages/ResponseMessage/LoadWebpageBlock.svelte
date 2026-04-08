<script lang="ts">
    import { slide } from 'svelte/transition';
    import { quintOut } from 'svelte/easing';
    import { mobile, streamContext } from '$lib/stores';
    import type { ToolCallBlock } from '@backend/routes/types';
    import type { LoadWebpageProgress } from '$lib/apis/completions';
    import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
    import ChevronUp from '$lib/components/icons/ChevronUp.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import Modal from '$lib/components/common/Modal.svelte';

    export let block: ToolCallBlock;
    export let progress: LoadWebpageProgress | undefined = undefined;

    // Start open during streaming (block.done=false), closed on page reload (block.done=true).
    let open: boolean = !block.done;

    $: isLive = !block.done;
    $: isFailed = block.failed;

    // --- URL pills ---
    // Pills always derive from block.arguments
    // Live progress overlays status; after done, result tells us which loaded.
    type Pill = { url: string; hostname: string; status: 'loading' | 'loaded' | 'failed' };

    // Parse input URLs once from arguments — these never change.
    const parseHostname = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

    let inputUrls: { url: string; hostname: string }[] = [];
    try {
        const args = JSON.parse(block.arguments);
        inputUrls = (Array.isArray(args.urls) ? args.urls : [])
            .map((u: string) => ({ url: u, hostname: parseHostname(u) }));
    } catch {}

    let pills: Pill[] = [];
    $: {
        if (isLive && progress) {
            // Overlay live status from progress events
            const statusMap = new Map(progress.urls.map((u) => [u.url, u.status]));
            pills = inputUrls.map((u) => ({ ...u, status: statusMap.get(u.url) ?? 'loading' }));
        } else if (!isLive) {
            // After done: URLs in result are loaded, the rest failed
            const loadedUrls = new Set<string>();
            try {
                const result: { url: string }[] = JSON.parse(block.result ?? '[]');
                result.forEach((r) => loadedUrls.add(r.url));
            } catch {}
            pills = inputUrls.map((u) => ({ ...u, status: loadedUrls.has(u.url) ? 'loaded' : 'failed' }));
        } else {
            pills = inputUrls.map((u) => ({ ...u, status: 'loading' }));
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
    $: loadedCount = pills.filter((p) => p.status === 'loaded').length;
    $: headerText = isLive
        ? 'Loading pages...'
        : isFailed
          ? `loadWebpage failed`
          : `Loaded ${loadedCount} page${loadedCount !== 1 ? 's' : ''} via loadWebpage${
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
        {#if isFailed}
            <div class="flex flex-wrap gap-1 items-center">
                <span class="text-xs text-red-500 dark:text-red-400">Error:</span>
                <span class="text-xs text-red-600 dark:text-red-300"
                    >{block.result ?? 'Unknown error'}</span
                >
            </div>
        {/if}

        {#if pills.length > 0}
            <div class="flex flex-wrap gap-1 items-center">
                <span class="text-xs text-gray-400 dark:text-gray-500">Pages:</span>
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
                    {:else if pill.status === 'failed'}
                        <span
                            class="text-xs rounded px-1.5 py-0.5 font-medium transition-colors duration-300 bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400"
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
