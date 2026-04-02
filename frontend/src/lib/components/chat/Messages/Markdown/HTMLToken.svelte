<script lang="ts">
    import DOMPurify from 'dompurify';
    import type { Token } from 'marked';

    export let token: Token;

    let html: string | null = null;

    $: if (token.type === 'html' && token?.text) {
        html = DOMPurify.sanitize(token.text);
    } else {
        html = null;
    }
</script>

{#if token.type === 'html'}
    {#if html && html.includes('<video')}
        {@const video = html.match(/<video[^>]*>([\s\S]*?)<\/video>/)}
        {@const videoSrc = video && video[1]}
        {#if videoSrc}
            <!-- svelte-ignore a11y-media-has-caption -->
            <video
                class="w-full my-2"
                src={videoSrc.replaceAll('&amp;', '&')}
                title="Video player"
                controls
            ></video>
        {:else}
            {token.text}
        {/if}
    {:else if html && html.includes('<audio')}
        {@const audio = html.match(/<audio[^>]*>([\s\S]*?)<\/audio>/)}
        {@const audioSrc = audio && audio[1]}
        {#if audioSrc}
            <!-- svelte-ignore a11y-media-has-caption -->
            <audio
                class="w-full my-2"
                src={audioSrc.replaceAll('&amp;', '&')}
                title="Audio player"
                controls
            ></audio>
        {:else}
            {token.text}
        {/if}
    {:else if token.text && token.text.match(/<iframe\s+[^>]*src="https:\/\/www\.youtube\.com\/embed\/([a-zA-Z0-9_-]{11})(?:\?[^"]*)?"[^>]*><\/iframe>/)}
        {@const match = token.text.match(
            /<iframe\s+[^>]*src="https:\/\/www\.youtube\.com\/embed\/([a-zA-Z0-9_-]{11})(?:\?[^"]*)?"[^>]*><\/iframe>/
        )}
        {@const ytId = match && match[1]}
        {#if ytId}
            <iframe
                class="w-full aspect-video my-2"
                src={`https://www.youtube.com/embed/${ytId}`}
                title="YouTube video player"
                frameborder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerpolicy="strict-origin-when-cross-origin"
                allowfullscreen
            >
            </iframe>
        {/if}
    {:else if token.text && token.text.includes('<iframe')}
        {@const match = token.text.match(/<iframe\s+[^>]*src="([^"]+)"[^>]*><\/iframe>/)}
        {@const iframeSrc = match && match[1]}
        {#if iframeSrc}
            <iframe
                class="w-full my-2"
                src={iframeSrc}
                title="Embedded content"
                frameborder="0"
                sandbox=""
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
        {:else}
            {token.text}
        {/if}
    {:else if token.text && token.text.includes('<status')}
        {@const match = token.text.match(/<status title="([^"]+)" done="(true|false)" ?\/?>/)}
        {@const statusTitle = match && match[1]}
        {@const statusDone = match && match[2] === 'true'}
        {#if statusTitle}
            <div class="flex flex-col justify-center -space-y-0.5">
                <div
                    class="{statusDone === false
                        ? 'shimmer'
                        : ''} text-gray-500 dark:text-gray-500 line-clamp-1 text-wrap"
                >
                    {statusTitle}
                </div>
            </div>
        {:else}
            {token.text}
        {/if}
    {:else if token.text.trim().match(/^<br\s*\/?>$/i)}
        <br />
    {:else}
        {token.text}
    {/if}
{/if}
