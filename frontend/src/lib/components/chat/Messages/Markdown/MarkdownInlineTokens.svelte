<script lang="ts">
    import type { Token, Tokens } from 'marked';
    import { goto } from '$app/navigation';

    import { unescapeHtml } from '$lib/utils';

    import Image from '$lib/components/common/Image.svelte';
    import KatexRenderer from './KatexRenderer.svelte';
    import HtmlToken from './HTMLToken.svelte';
    import TextToken from './MarkdownInlineTokens/TextToken.svelte';
    import CodespanToken from './MarkdownInlineTokens/CodespanToken.svelte';

    export let id: string;
    export let done = true;
    export let tokens: Token[];

    /**
     * Handle link clicks - intercept same-origin app URLs for in-app navigation
     */
    const handleLinkClick = (e: MouseEvent, href: string) => {
        try {
            const url = new URL(href, window.location.origin);
            // Check if same origin and an in-app route
            if (url.origin === window.location.origin && url.pathname.startsWith('/c/')) {
                e.preventDefault();
                goto(url.pathname + url.search + url.hash);
            }
        } catch {
            // Invalid URL, let browser handle it
        }
    };
</script>

{#each tokens as token, tokenIdx (tokenIdx)}
    {#if token.type === 'escape'}
        {unescapeHtml(token.text)}
    {:else if token.type === 'html'}
        <HtmlToken {token} />
    {:else if token.type === 'link'}
        {#if token.tokens}
            <a
                href={token.href}
                target="_blank"
                rel="nofollow"
                title={token.title}
                on:click={(e) => handleLinkClick(e, token.href)}
            >
                <svelte:self id={`${id}-a`} tokens={token.tokens} {done} />
            </a>
        {:else}
            <a
                href={token.href}
                target="_blank"
                rel="nofollow"
                title={token.title}
                on:click={(e) => handleLinkClick(e, token.href)}>{token.text}</a
            >
        {/if}
    {:else if token.type === 'image'}
        <Image src={token.href} alt={token.text} />
    {:else if token.type === 'strong'}
        <strong><svelte:self id={`${id}-strong`} tokens={token.tokens} /></strong>
    {:else if token.type === 'em'}
        <em><svelte:self id={`${id}-em`} tokens={token.tokens} /></em>
    {:else if token.type === 'codespan'}
        <CodespanToken token={token as Tokens.Codespan} {done} />
    {:else if token.type === 'br'}
        <br />
    {:else if token.type === 'del'}
        <del><svelte:self id={`${id}-del`} tokens={token.tokens} /></del>
    {:else if token.type === 'inlineKatex'}
        {#if token.text}
            <KatexRenderer content={token.text} displayMode={false} />
        {/if}
    {:else if token.type === 'iframe'}
        <iframe
            src="/api/v1/files/{token.fileId}/content"
            title={token.fileId}
            width="100%"
            frameborder="0"
            on:load={(e) => {
                try {
                    (e.currentTarget as HTMLIFrameElement).style.height =
                        (e.currentTarget as HTMLIFrameElement).contentWindow!.document.body
                            .scrollHeight +
                        20 +
                        'px';
                } catch {}
            }}
        ></iframe>
    {:else if token.type === 'citation'}
        <TextToken {token} {done} />
    {:else if token.type === 'text'}
        <TextToken {token} {done} />
    {/if}
{/each}
