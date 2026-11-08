<script lang="ts">
    /**
     * A run of tool calls in one box of limited height. New calls come in at the
     * bottom and older ones scroll off the top, like a terminal. The reasoning
     * between them is in the full trace, next to the header.
     */
    import { afterUpdate, onDestroy } from 'svelte';
    import { slide } from 'svelte/transition';
    import { quintOut } from 'svelte/easing';
    import type { ToolProgressState } from '$lib/apis/completions';
    import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
    import ChevronUp from '$lib/components/icons/ChevronUp.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import Modal from '$lib/components/common/Modal.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import ToolCall from './ToolCall.svelte';
    import ReasoningTail from './ReasoningTail.svelte';
    import { singleCallTitle, type RunBlock } from './toolRuns';
    import type { ReasoningBlock, ToolCallBlock } from '@backend/routes/types';

    export let blocks: RunBlock[];
    export let toolProgress: Map<string, ToolProgressState> | undefined = undefined;
    export let live = false;

    // Open while running; closed when reloaded from history.
    let open = live;

    $: tools = blocks.filter((b): b is ToolCallBlock => b.type === 'tool_call');
    $: count = `${tools.length} tool call${tools.length === 1 ? '' : 's'}`;
    $: last = blocks.at(-1);
    $: thinking = live && last?.type === 'reasoning' && !last.done ? (last as ReasoningBlock) : null;

    const reasoningSeconds = (list: RunBlock[]) =>
        list.reduce((sum, b) => sum + (b.type === 'reasoning' ? (b.duration ?? 0) : 0), 0);

    /** From the first activity to the last, including time the model spent writing each call. */
    const totalSeconds = (list: RunBlock[], toolList: ToolCallBlock[]): number => {
        const first = toolList[0];
        const final = toolList.at(-1);
        if (!first || !final) return 0;
        if (first.startedAt === undefined || final.startedAt === undefined) {
            return reasoningSeconds(list) + toolList.reduce((sum, t) => sum + (t.duration ?? 0), 0);
        }
        const before = reasoningSeconds(list.slice(0, list.indexOf(first)));
        const after = reasoningSeconds(list.slice(list.indexOf(final) + 1));
        return Math.round(before + (final.startedAt - first.startedAt) / 1000 + (final.duration ?? 0) + after);
    };

    let now = Date.now();
    let ticker: ReturnType<typeof setInterval> | undefined;
    $: if (live && !ticker) {
        ticker = setInterval(() => (now = Date.now()), 1000);
    } else if (!live && ticker) {
        clearInterval(ticker);
        ticker = undefined;
    }
    onDestroy(() => clearInterval(ticker));

    $: firstStart = tools[0]?.startedAt;
    $: liveSeconds = firstStart === undefined ? 0 : Math.max(0, Math.round((now - firstStart) / 1000));
    $: seconds = totalSeconds(blocks, tools);
    $: single = tools.length === 1 ? singleCallTitle(tools[0]!) : null;
    $: header =
        live
            ? `Working · ${count}${liveSeconds ? ` · ${liveSeconds}s` : ''}`
            : `Ran ${count}${seconds ? ` in ${seconds} second${seconds === 1 ? '' : 's'}` : ''}`;

    let box: HTMLDivElement | undefined;
    let following = true;
    let scrolledDown = false;
    const onScroll = () => {
        if (!box) return;
        following = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
        scrolledDown = box.scrollTop > 4;
    };
    afterUpdate(() => {
        if (box && following) {
            box.scrollTop = box.scrollHeight;
            scrolledDown = box.scrollTop > 4;
        }
    });

    let showTrace = false;
    const label = 'text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400';
    const pre =
        'whitespace-pre-wrap break-words rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono';
    const pretty = (args: string) => {
        try {
            return JSON.stringify(JSON.parse(args || '{}'), null, 2);
        } catch {
            return args;
        }
    };
</script>

<div class="group flex items-center gap-1.5 max-w-full">
    <div
        class="w-fit min-w-0 max-w-full text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition cursor-pointer"
        role="button"
        tabindex="0"
        on:click={() => (open = !open)}
        on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (open = !open)}
    >
        <div class="font-medium flex items-center gap-2 {live ? 'shimmer' : ''}">
            {#if live}
                <div class="shrink-0"><Spinner className="size-4" /></div>
            {/if}
            {#if single}
                <div class="flex items-baseline gap-1.5 min-w-0">
                    <span class="shrink-0">{single.verb}</span>
                    <span class="truncate font-mono text-[0.85em] font-normal">{single.target}</span>
                </div>
            {:else}
                <div class="truncate">{header}</div>
            {/if}
            <div class="flex self-center translate-y-[1px] shrink-0">
                {#if open}
                    <ChevronUp strokeWidth="3.5" className="size-3.5" />
                {:else}
                    <ChevronDown strokeWidth="3.5" className="size-3.5" />
                {/if}
            </div>
        </div>
    </div>
    <Tooltip content="View raw" placement="top">
        <button
            type="button"
            aria-label="View raw"
            class="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity opacity-0 group-hover:opacity-100 focus:opacity-100 {open
                ? '[@media(hover:none)]:opacity-100'
                : '[@media(hover:none)]:hidden'}"
            on:click|stopPropagation={() => (showTrace = true)}
        >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="size-3.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
            </svg>
        </button>
    </Tooltip>
</div>

{#if open}
    <div
        transition:slide={{ duration: 200, easing: quintOut, axis: 'y' }}
        class="mt-1.5 border-s-2 border-dotted border-s-gray-100 dark:border-gray-800 ps-3"
    >
        <div
            bind:this={box}
            on:scroll={onScroll}
            class="max-h-64 overflow-y-auto flex flex-col gap-1.5 {scrolledDown
                ? '[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]'
                : ''}"
        >
            {#each tools as block (block.id)}
                <ToolCall {block} progress={toolProgress?.get(block.id)} />
            {/each}
        </div>
    </div>
{/if}

{#if thinking}
    <ReasoningTail text={thinking.content} />
{/if}

{#if showTrace}
    <Modal size="lg" bind:show={showTrace}>
        <div class="flex flex-col">
            <div class="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
                <div class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">Full trace</div>
                <button aria-label="Close" class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition" on:click={() => (showTrace = false)}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-4">
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                </button>
            </div>
            <div class="max-h-[70vh] overflow-y-auto px-5 py-4 flex flex-col gap-3">
                {#each blocks as block, i (block.type === 'tool_call' ? block.id : `reasoning-${i}`)}
                    {#if block.type === 'reasoning'}
                        <section class="flex flex-col gap-1.5">
                            <div class={label}>Reasoning</div>
                            <div class="whitespace-pre-wrap break-words text-xs leading-5 text-gray-600 dark:text-gray-400">{block.content}</div>
                        </section>
                    {:else}
                        <section class="flex flex-col gap-1.5">
                            <div class={label}>{block.name} input</div>
                            <pre class={pre}>{pretty(block.arguments)}</pre>
                        </section>
                        <section class="flex flex-col gap-1.5">
                            <div class="flex items-center gap-2 {label}">
                                Result
                                {#if block.failed}
                                    <span class="normal-case tracking-normal font-medium rounded px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">Error</span>
                                {/if}
                            </div>
                            <pre class={pre}>{block.result ?? ''}</pre>
                        </section>
                    {/if}
                {/each}
            </div>
        </div>
    </Modal>
{/if}
