<script lang="ts">
    import { marked } from 'marked';
    import { onDestroy } from 'svelte';

    import markedExtension from '$lib/utils/marked/extension';
    import markedKatexExtension from '$lib/utils/marked/katex-extension';
    import { disableSingleTilde } from '$lib/utils/marked/strikethrough-extension';
    import MarkdownTokens from './Markdown/MarkdownTokens.svelte';

    export let id = '';
    export let content: string;
    export let done = true;
    export let paragraphTag = 'p';

    let tokens = marked.lexer('');

    const options = {
        throwOnError: false,
        breaks: true
    };

    marked.use(markedKatexExtension(options));
    marked.use(markedExtension(options));
    marked.use(disableSingleTilde as any);

    let pendingLex: number | null = null;

    $: if (content) {
        // Use rAF to throttle re-lexing of content while streaming.
        // When done, force a re-lex.
        //
        // TODO: Re-lexing entire content isn't necessary; we could probably cache
        // prior tokens and only re-lex the portion currently being streamed.
        if (done) {
            if (pendingLex) {
                cancelAnimationFrame(pendingLex);
                pendingLex = null;
            }
            tokens = marked.lexer(content);
        } else if (!pendingLex) {
            pendingLex = requestAnimationFrame(() => {
                pendingLex = null;
                tokens = marked.lexer(content);
            });
        }
    }

    onDestroy(() => {
        if (pendingLex) cancelAnimationFrame(pendingLex);
    });
</script>

{#key id}
    <MarkdownTokens {tokens} {id} {done} {paragraphTag} />
{/key}
