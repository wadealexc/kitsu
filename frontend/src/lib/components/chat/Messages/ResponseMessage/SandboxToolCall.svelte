<script lang="ts">
    /** A sandbox tool call: what it did, the last of its output, and whether it worked. */
    import type { ToolCallBlock } from '@backend/routes/types';
    import type { ToolProgressState } from '$lib/apis/completions';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import Modal from '$lib/components/common/Modal.svelte';
    import { displayPath } from './toolRuns';

    export let block: ToolCallBlock;
    export let progress: ToolProgressState | undefined = undefined;

    const PREVIEW_LINES = 4;

    // Pulled out as strings so a large write is only parsed when it actually changes,
    // not each time the message around it updates.
    $: rawArguments = block.arguments;
    let args: Record<string, unknown> = {};
    $: {
        try {
            const parsed = JSON.parse(rawArguments || '{}');
            args = parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            args = {};
        }
    }
    const text = (value: unknown) => (typeof value === 'string' ? value : '');

    $: running = block.result === undefined && !block.done;
    $: stopped = block.result === undefined && block.done;

    /** As a terminal shows it: no colour codes, and a redrawn line is only its last version. */
    const cleanLines = (output: string): string[] =>
        output
            // eslint-disable-next-line no-control-regex
            .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
            .split('\n')
            .map((line) => line.replace(/\r+$/, '').split('\r').at(-1) ?? '');
    const firstLines = (output: string) => cleanLines(output).filter((l) => l.trim()).slice(0, PREVIEW_LINES);
    const lastLines = (output: string) => cleanLines(output).filter((l) => l.trim()).slice(-PREVIEW_LINES);

    $: path = displayPath(text(args.path));
    $: command = text(args.command);
    $: commandLines = command.split('\n').filter((l) => l.trim());
    $: writtenLines = text(args.content).split('\n').length;
    $: diffLines = (typeof block.structured?.diff === 'string' ? block.structured.diff : '')
        .split('\n')
        .filter((l) => l.startsWith('+') || l.startsWith('-'));
    $: added = diffLines.filter((l) => l.startsWith('+')).length;
    $: removed = diffLines.length - added;

    $: summary =
        block.name === 'bash'
            ? `$ ${commandLines[0] ?? ''}`
            : block.name === 'read'
              ? `read ${path}${typeof args.offset === 'number' ? `:${args.offset}` : ''}`
              : `${block.name} ${path}`;
    $: detail =
        block.name === 'bash' && commandLines.length > 1
            ? `+${commandLines.length - 1} lines`
            : block.name === 'write' && !block.failed
              ? `${writtenLines} line${writtenLines === 1 ? '' : 's'}`
              : block.name === 'edit' && !block.failed && !running && diffLines.length
                ? `+${added} −${removed}`
                : '';

    $: preview = block.failed
        ? lastLines(block.result ?? '')
        : block.name === 'bash'
          ? lastLines(running ? (progress?.output ?? '') : (block.result ?? '').replace(/^\(no output\)$/, ''))
          : block.name === 'read'
            ? block.images?.length ? [] : firstLines(block.result ?? '')
            : block.name === 'write'
              ? firstLines(text(args.content))
              : [];

    $: tint = running || stopped
        ? 'border-gray-200/70 dark:border-gray-800'
        : block.failed
          ? 'border-red-500/25 bg-red-500/[0.06]'
          : 'border-green-500/20 bg-green-500/[0.05]';

    let showRaw = false;
</script>

<button
    type="button"
    title="View details"
    class="block w-full max-w-full text-left rounded-lg border {tint} px-2.5 py-1.5 font-mono text-xs transition-colors hover:border-gray-300 dark:hover:border-gray-700"
    on:click={() => (showRaw = true)}
>
    <div class="flex items-center gap-2 min-w-0 text-gray-700 dark:text-gray-300">
        {#if running}
            <div class="shrink-0"><Spinner className="size-3.5" /></div>
        {/if}
        <span class="truncate min-w-0">{summary}</span>
        {#if detail}
            <span class="shrink-0 ml-auto text-[11px] text-gray-500 dark:text-gray-400">{detail}</span>
        {/if}
        {#if stopped}
            <span class="shrink-0 ml-auto text-[11px] text-gray-500 dark:text-gray-400">stopped</span>
        {/if}
    </div>

    {#if block.images?.length}
        <div class="mt-1.5 flex flex-wrap gap-1.5">
            {#each block.images as image}
                <img src={`data:${image.mimeType};base64,${image.data}`} alt={path} class="max-h-40 max-w-full rounded" />
            {/each}
        </div>
    {/if}

    {#if diffLines.length && !block.failed}
        <div class="mt-1 text-[11px] leading-4">
            {#each diffLines.slice(0, PREVIEW_LINES + 2) as line}
                <div class="truncate {line.startsWith('+') ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">{line}</div>
            {/each}
        </div>
    {:else if preview.length}
        <div class="mt-1 text-[11px] leading-4 {block.failed ? 'text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}">
            {#each preview as line}
                <div class="truncate whitespace-pre">{line}</div>
            {/each}
        </div>
    {/if}
</button>

{#if showRaw}
    <Modal size="lg" bind:show={showRaw}>
        <div class="flex flex-col">
            <div class="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-800">
                <div class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{block.name}{block.server ? ` · ${block.server}` : ''}</div>
                <button aria-label="Close" class="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition" on:click={() => (showRaw = false)}>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-4">
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                </button>
            </div>
            <div class="max-h-[70vh] overflow-y-auto px-5 py-4 flex flex-col gap-3">
                <section class="flex flex-col gap-1.5">
                    <div class="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Input</div>
                    <pre class="whitespace-pre-wrap break-words rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono">{block.name === 'bash' ? command : JSON.stringify(args, null, 2)}</pre>
                </section>
                <section class="flex flex-col gap-1.5">
                    <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Result
                        {#if block.failed}
                            <span class="normal-case tracking-normal font-medium rounded px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300">Error</span>
                        {/if}
                    </div>
                    <pre class="whitespace-pre-wrap break-words rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-850 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 font-mono">{running ? (progress?.output ?? '') : (block.result ?? '')}</pre>
                </section>
            </div>
        </div>
    </Modal>
{/if}
