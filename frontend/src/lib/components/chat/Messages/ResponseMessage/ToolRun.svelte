<script lang="ts">
    /**
     * A run of reasoning and tool calls in one box of limited height. New activity
     * comes in at the bottom and older activity scrolls off the top, like a terminal.
     */
    import { afterUpdate, onDestroy } from 'svelte';
    import { slide } from 'svelte/transition';
    import { quintOut } from 'svelte/easing';
    import type { ToolProgressState } from '$lib/apis/completions';
    import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
    import ChevronUp from '$lib/components/icons/ChevronUp.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import ToolCall from './ToolCall.svelte';
    import type { RunBlock } from './toolRuns';
    import type { ToolCallBlock } from '@backend/routes/types';

    export let blocks: RunBlock[];
    export let toolProgress: Map<string, ToolProgressState> | undefined = undefined;
    export let live = false;

    // Open while running; closed when reloaded from history.
    let open = live;

    $: tools = blocks.filter((b): b is ToolCallBlock => b.type === 'tool_call');
    $: failed = tools.filter((t) => t.failed).length;
    $: count = `${tools.length} tool call${tools.length === 1 ? '' : 's'}`;

    const reasoningSeconds = (list: RunBlock[]) =>
        list.reduce((sum, b) => sum + (b.type === 'reasoning' ? (b.duration ?? 0) : 0), 0);

    /** From the first activity to the last, including time the model spent writing each call. */
    const totalSeconds = (list: RunBlock[], toolList: ToolCallBlock[]): number => {
        const first = toolList[0];
        const last = toolList.at(-1);
        if (!first || !last) return 0;
        const before = reasoningSeconds(list.slice(0, list.indexOf(first)));
        const after = reasoningSeconds(list.slice(list.indexOf(last) + 1));
        if (first.startedAt === undefined || last.startedAt === undefined) {
            return reasoningSeconds(list) + toolList.reduce((sum, t) => sum + (t.duration ?? 0), 0);
        }
        return Math.round(before + (last.startedAt - first.startedAt) / 1000 + (last.duration ?? 0) + after);
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
    $: header = live
        ? `Working · ${count}${liveSeconds ? ` · ${liveSeconds}s` : ''}`
        : `Ran ${count} in ${seconds} second${seconds === 1 ? '' : 's'}`;

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
</script>

<div
    class="w-fit max-w-full text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition cursor-pointer"
    role="button"
    tabindex="0"
    on:click={() => (open = !open)}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (open = !open)}
>
    <div class="font-medium flex items-center gap-2 {live ? 'shimmer' : ''}">
        {#if live}
            <div class="shrink-0"><Spinner className="size-4" /></div>
        {/if}
        <div class="truncate">
            {header}{#if failed > 0}<span class="text-red-600 dark:text-red-400">&nbsp;· {failed} failed</span>{/if}
        </div>
        <div class="flex self-center translate-y-[1px] shrink-0">
            {#if open}
                <ChevronUp strokeWidth="3.5" className="size-3.5" />
            {:else}
                <ChevronDown strokeWidth="3.5" className="size-3.5" />
            {/if}
        </div>
    </div>
</div>

{#if open}
    <div transition:slide={{ duration: 200, easing: quintOut, axis: 'y' }} class="mt-1.5">
        <div
            bind:this={box}
            on:scroll={onScroll}
            class="max-h-64 overflow-y-auto flex flex-col gap-1.5 rounded-lg bg-gray-50 dark:bg-gray-850/60 p-2 {scrolledDown
                ? '[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]'
                : ''}"
        >
            {#each blocks as block, i (block.type === 'tool_call' ? block.id : `reasoning-${i}`)}
                {#if block.type === 'reasoning'}
                    <div class="text-xs leading-5 text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words">{block.content}</div>
                {:else}
                    <ToolCall {block} progress={toolProgress?.get(block.id)} />
                {/if}
            {/each}
        </div>
    </div>
{/if}
