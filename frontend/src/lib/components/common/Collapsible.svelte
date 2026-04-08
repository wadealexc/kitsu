<script lang="ts">
    import { decodeHtmlEntities as decode } from '$lib/utils';

    import dayjs from '$lib/dayjs';
    import duration from 'dayjs/plugin/duration';
    import relativeTime from 'dayjs/plugin/relativeTime';

    dayjs.extend(duration);
    dayjs.extend(relativeTime);

    interface CollapsibleAttributes {
        type?: 'tool_calls' | 'reasoning' | 'code_interpreter' | string;
        id?: string;
        name?: string;
        done?: string;
        failed?: string;
        duration?: number;
        arguments?: string;
        result?: string;
        files?: string;
    }

    import { slide } from 'svelte/transition';
    import { quintOut } from 'svelte/easing';

    import ChevronUp from '../icons/ChevronUp.svelte';
    import ChevronDown from '../icons/ChevronDown.svelte';
    import Spinner from './Spinner.svelte';
    import Markdown from '../chat/Messages/Markdown.svelte';
    import Image from './Image.svelte';

    export let open = false;

    export let className = '';
    export let buttonClassName =
        'w-fit text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition';

    export let id = '';
    export let title: string | null = null;
    export let attributes: CollapsibleAttributes | null = null;

    export let chevron = false;
    export let grow = false;

    export let disabled = false;
    export let hide = false;

    export let onChange: Function = () => {};

    $: onChange(open);

    const collapsibleId = crypto.randomUUID();

    function parseJSONString(str: string): any {
        try {
            return parseJSONString(JSON.parse(str));
        } catch (e) {
            return str;
        }
    }

    function formatJSONString(str: string): string {
        try {
            const parsed = parseJSONString(str);
            // If parsed is an object/array, then it's valid JSON
            if (typeof parsed === 'object') {
                return JSON.stringify(parsed, null, 2);
            } else {
                // It's a primitive value like a number, boolean, etc.
                return `${JSON.stringify(String(parsed))}`;
            }
        } catch (e) {
            // Not valid JSON, return as-is
            return str;
        }
    }
</script>

<div {id} class={className}>
    {#if attributes?.type === 'tool_calls'}
        {@const args = decode(attributes?.arguments ?? '')}
        {@const result = decode(attributes?.result ?? '')}
        {@const files = parseJSONString(decode(attributes?.files ?? ''))}

        <div
            class="{buttonClassName} cursor-pointer"
            role="button"
            tabindex="0"
            on:pointerup={() => {
                if (!disabled) {
                    open = !open;
                }
            }}
        >
            <div
                class=" w-full font-medium flex items-center justify-between gap-2 {attributes?.done &&
                attributes?.done !== 'true'
                    ? 'shimmer'
                    : ''}
			"
            >
                {#if attributes?.done && attributes?.done !== 'true'}
                    <div>
                        <Spinner className="size-4" />
                    </div>
                {/if}

                <div class="">
                    {#if attributes?.done === 'true' && attributes?.failed === 'true'}
                        <Markdown
                            id={`${collapsibleId}-tool-calls-${attributes?.id}`}
                            content={`**${attributes.name}** failed`}
                        />
                    {:else if attributes?.done === 'true'}
                        <Markdown
                            id={`${collapsibleId}-tool-calls-${attributes?.id}`}
                            content={`View result from **${attributes.name}**`}
                        />
                    {:else}
                        <Markdown
                            id={`${collapsibleId}-tool-calls-${attributes?.id}-executing`}
                            content={`Executing **${attributes.name}**...`}
                        />
                    {/if}
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

        {#if !grow}
            {#if open && !hide}
                <div transition:slide={{ duration: 300, easing: quintOut, axis: 'y' }}>
                    {#if attributes?.type === 'tool_calls'}
                        {#if attributes?.done === 'true' && attributes?.failed === 'true'}
                            <div class="border-s-2 border-dotted border-s-red-200 dark:border-red-800 ps-3 mt-1.5 flex flex-col gap-1 text-sm">
                                <div class="flex flex-wrap gap-1 items-center">
                                    <span class="text-xs text-red-500 dark:text-red-400">Error:</span>
                                    <span class="text-xs text-red-600 dark:text-red-300">{result || 'Unknown error'}</span>
                                </div>
                                <Markdown
                                    id={`${collapsibleId}-tool-calls-${attributes?.id}-result`}
                                    content={`\`\`\`json\n${formatJSONString(args)}\n\`\`\``}
                                />
                            </div>
                        {:else if attributes?.done === 'true'}
                            <div class="mt-1.5 border-s-2 border-dotted border-s-gray-100 dark:border-gray-800 ps-3">
                                <Markdown
                                    id={`${collapsibleId}-tool-calls-${attributes?.id}-result`}
                                    content={`\`\`\`json\n${formatJSONString(args)}\n${formatJSONString(result)}\n\`\`\``}
                                />
                            </div>
                        {:else}
                            <div class="mt-1.5 border-s-2 border-dotted border-s-gray-100 dark:border-gray-800 ps-3">
                                <Markdown
                                    id={`${collapsibleId}-tool-calls-${attributes?.id}-result`}
                                    content={`\`\`\`json\n${formatJSONString(args)}\n\`\`\``}
                                />
                            </div>
                        {/if}
                    {:else}
                        <slot name="content" />
                    {/if}
                </div>
            {/if}
        {/if}

        {#if attributes?.done === 'true'}
            {#if typeof files === 'object'}
                {#each files ?? [] as file, idx}
                    {#if typeof file === 'string'}
                        {#if file.startsWith('data:image/')}
                            <Image src={file} alt="Image" />
                        {/if}
                    {:else if typeof file === 'object'}
                        {#if (file.type === 'image' || (file?.contentType ?? '').startsWith('image/')) && file.url}
                            <Image src={file.url} alt="Image" />
                        {/if}
                    {/if}
                {/each}
            {/if}
        {/if}
    {:else}
        {#if title !== null}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
                class="{buttonClassName} cursor-pointer"
                on:pointerup={() => {
                    if (!disabled) {
                        open = !open;
                    }
                }}
            >
                <div
                    class=" w-full font-medium flex items-center justify-between gap-2 {attributes?.done &&
                    attributes?.done !== 'true'
                        ? 'shimmer'
                        : ''}
			"
                >
                    {#if attributes?.done && attributes?.done !== 'true'}
                        <div>
                            <Spinner className="size-4" />
                        </div>
                    {/if}

                    <div class="">
                        {#if attributes?.type === 'reasoning'}
                            {#if attributes?.done === 'true' && attributes?.duration !== undefined}
                                {#if attributes.duration < 1}
                                    {'Thought for less than a second'}
                                {:else if attributes.duration < 60}
                                    {`Thought for ${attributes.duration} seconds`}
                                {:else}
                                    {`Thought for ${dayjs.duration(attributes.duration, 'seconds').humanize()}`}
                                {/if}
                            {:else}
                                {'Thinking...'}
                            {/if}
                        {:else if attributes?.type === 'code_interpreter'}
                            {#if attributes?.done === 'true'}
                                {'Analyzed'}
                            {:else}
                                {'Analyzing...'}
                            {/if}
                        {:else}
                            {title}
                        {/if}
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
        {:else}
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div
                class="{buttonClassName} cursor-pointer"
                on:click={(e) => {
                    e.stopPropagation();
                }}
                on:pointerup={(e) => {
                    if (!disabled) {
                        open = !open;
                    }
                }}
            >
                <div>
                    <div class="flex items-start justify-between">
                        <slot />

                        {#if chevron}
                            <div class="flex self-start translate-y-1">
                                {#if open}
                                    <ChevronUp strokeWidth="3.5" className="size-3.5" />
                                {:else}
                                    <ChevronDown strokeWidth="3.5" className="size-3.5" />
                                {/if}
                            </div>
                        {/if}
                    </div>

                    {#if grow}
                        {#if open && !hide}
                            <div
                                transition:slide={{ duration: 300, easing: quintOut, axis: 'y' }}
                                on:pointerup={(e) => {
                                    e.stopPropagation();
                                }}
                            >
                                <slot name="content" />
                            </div>
                        {/if}
                    {/if}
                </div>
            </div>
        {/if}

        {#if !grow}
            {#if open && !hide}
                <div transition:slide={{ duration: 300, easing: quintOut, axis: 'y' }}>
                    <slot name="content" />
                </div>
            {/if}
        {/if}
    {/if}
</div>
