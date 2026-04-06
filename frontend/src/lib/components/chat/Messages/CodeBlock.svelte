<script lang="ts">
    import hljs from 'highlight.js';
    import { copyToClipboard } from '$lib/utils';

    import 'highlight.js/styles/github-dark.min.css';

    import ChevronUpDown from '$lib/components/icons/ChevronUpDown.svelte';

    export let lang = '';
    export let code = '';
    export let done = true;
    export let collapsed = false;

    const escapeHtml = (text: string): string => {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    };

    let highlightedHtml = '';
    $: {
        if (lang && hljs.getLanguage(lang)) {
            highlightedHtml = hljs.highlight(code, { language: lang }).value;
        } else if (done) {
            highlightedHtml = hljs.highlightAuto(code).value;
        } else {
            highlightedHtml = escapeHtml(code);
        }
    }

    let copied = false;

    const collapseCodeBlock = () => {
        collapsed = !collapsed;
    };

    const copyCode = async () => {
        copied = true;
        await copyToClipboard(code);

        setTimeout(() => {
            copied = false;
        }, 1000);
    };
</script>

<div
    class="flex flex-col rounded-xl border border-gray-100/30 dark:border-gray-850/30 my-0.5 overflow-hidden"
    dir="ltr"
>
    <div class="flex items-center justify-between px-4 py-2 bg-white dark:bg-black text-xs text-black dark:text-white">
        <span class="font-medium">{lang}</span>
        <div class="flex items-center gap-0.5">
            <button
                class="flex gap-1 items-center transition rounded-md px-1.5 py-0.5"
                on:click={collapseCodeBlock}
            >
                <div class="-translate-y-[0.5px]">
                    <ChevronUpDown className="size-3" />
                </div>
                <div>{collapsed ? 'Expand' : 'Collapse'}</div>
            </button>

            <button
                class="transition rounded-md px-1.5 py-0.5"
                on:click={copyCode}
            >{copied ? 'Copied' : 'Copy'}</button>
        </div>
    </div>

    {#if !collapsed}
        <pre class="hljs p-4 px-5 overflow-x-auto m-0"><code class="language-{lang} whitespace-pre text-sm">{@html highlightedHtml}</code></pre>
    {:else}
        <div class="bg-white dark:bg-black dark:text-white py-3 px-4 text-xs">
            <span class="text-gray-500 italic">{code.split('\n').length} hidden lines</span>
        </div>
    {/if}
</div>
