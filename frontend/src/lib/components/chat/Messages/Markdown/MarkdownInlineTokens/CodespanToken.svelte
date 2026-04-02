<script lang="ts">
    import { copyToClipboard, unescapeHtml } from '$lib/utils';
    import { toast } from 'svelte-sonner';
    import { fade } from 'svelte/transition';
    import type { Tokens } from 'marked';

    export let token: Tokens.Codespan;
    export let done = true;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
{#if done}
    <code
        class="codespan cursor-pointer"
        on:click={() => {
            copyToClipboard(unescapeHtml(token.text));
            toast.success('Copied to clipboard');
        }}
    >
        {unescapeHtml(token.text)}
    </code>
{:else}
    <code
        transition:fade={{ duration: 100 }}
        class="codespan cursor-pointer"
        on:click={() => {
            copyToClipboard(unescapeHtml(token.text));
            toast.success('Copied to clipboard');
        }}
    >
        {unescapeHtml(token.text)}
    </code>
{/if}
