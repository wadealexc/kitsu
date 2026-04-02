<script lang="ts">
    import { marked } from 'marked';

    import markedExtension from '$lib/utils/marked/extension';
    import markedKatexExtension from '$lib/utils/marked/katex-extension';
    import { disableSingleTilde } from '$lib/utils/marked/strikethrough-extension';
    import MarkdownTokens from './Markdown/MarkdownTokens.svelte';
    import footnoteExtension from '$lib/utils/marked/footnote-extension';
    import citationExtension from '$lib/utils/marked/citation-extension';

    export let id = '';
    export let content: string;
    export let done = true;
    export let save = false;
    export let paragraphTag = 'p';
    export let onSave: (e: { raw: string; oldContent: string; newContent: string }) => void = (
        _e
    ) => {};
    export let onUpdate: (token: unknown) => void = (_t) => {};

    export let onTaskClick: (e: unknown) => void = (_e) => {};

    let tokens = marked.lexer('');

    const options = {
        throwOnError: false,
        breaks: true
    };

    marked.use(markedKatexExtension(options));
    marked.use(markedExtension(options));
    marked.use(citationExtension());
    marked.use(footnoteExtension());
    marked.use(disableSingleTilde as any);

    const LEX_INTERVAL_MS = 32;
    let lastLexTime = 0;

    $: if (content && (done || Date.now() - lastLexTime >= LEX_INTERVAL_MS)) {
        tokens = marked.lexer(content);
        lastLexTime = Date.now();
    }
</script>

{#key id}
    <MarkdownTokens {tokens} {id} {done} {save} {paragraphTag} {onTaskClick} {onSave} {onUpdate} />
{/key}
