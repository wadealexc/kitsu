<script lang="ts">
    import hljs from 'highlight.js';
    import { onMount } from 'svelte';
    import type { Token, Tokens } from 'marked';
    import type { Mermaid } from 'mermaid';
    import { copyToClipboard, initMermaid, renderMermaidDiagram } from '$lib/utils';

    import 'highlight.js/styles/github-dark.min.css';

    import SvgPanZoom from '$lib/components/common/SVGPanZoom.svelte';

    import ChevronUpDown from '$lib/components/icons/ChevronUpDown.svelte';

    export let id = '';

    export let onSave: (code: string) => void = (_e) => {};
    export let onUpdate: (token: Token | null) => void = (_e) => {};

    export let save = false;
    export let collapsed = false;

    export let token: Token;
    export let lang = '';
    export let code = '';

    interface CodeBlockAttributes {
        output?: string;
        [key: string]: string | undefined;
    }
    export let attributes: CodeBlockAttributes = {};

    export let className = '';
    export let editorClassName = '';
    export let stickyButtonsClassName = 'top-0';

    let _code = '';
    $: if (code) {
        updateCode();
    }

    const updateCode = () => {
        _code = code;
    };

    let _token: Token | null = null;

    let renderHTML: string | null = null;
    let renderError: string | null = null;

    let stdout: string | null = null;
    let stderr: string | null = null;
    let result: unknown = null;
    let files: Array<{ type: string; data: string }> | null = null;

    let copied = false;
    let saved = false;

    const collapseCodeBlock = () => {
        collapsed = !collapsed;
    };

    const saveCode = () => {
        saved = true;

        code = _code;
        onSave(code);

        setTimeout(() => {
            saved = false;
        }, 1000);
    };

    const copyCode = async () => {
        copied = true;
        await copyToClipboard(_code);

        setTimeout(() => {
            copied = false;
        }, 1000);
    };

    let mermaid: Mermaid | null = null;
    const renderMermaid = async (code: string): Promise<string> => {
        if (!mermaid) {
            mermaid = await initMermaid();
        }
        return await renderMermaidDiagram(mermaid, code);
    };

    const render = async () => {
        onUpdate(token);
        if (lang === 'mermaid' && (token?.raw ?? '').slice(-4).includes('```')) {
            try {
                renderHTML = await renderMermaid(code);
            } catch (error) {
                console.error('Failed to render mermaid diagram:', error);
                const errorMsg = error instanceof Error ? error.message : String(error);
                renderError = 'Failed to render diagram' + `: ${errorMsg}`;
                renderHTML = null;
            }
        }
    };

    $: if (token) {
        const t = token as Tokens.Code;
        const _t = _token as Tokens.Code | null;
        if (t.text !== _t?.text || t.raw !== _t?.raw) {
            _token = token;
        } else if (JSON.stringify(token) !== JSON.stringify(_token)) {
            _token = token;
        }
    }

    $: if (_token) {
        render();
    }

    $: if (attributes) {
        onAttributesUpdate();
    }

    const onAttributesUpdate = () => {
        if (attributes?.output) {
            // Create a helper function to unescape HTML entities
            const unescapeHtml = (html: string): string => {
                const textArea = document.createElement('textarea');
                textArea.innerHTML = html;
                return textArea.value;
            };

            try {
                // Unescape the HTML-encoded string
                const unescapedOutput = unescapeHtml(attributes.output);

                // Parse the unescaped string into JSON
                const output = JSON.parse(unescapedOutput);

                // Assign the parsed values to variables
                stdout = output.stdout;
                stderr = output.stderr;
                result = output.result;
            } catch (error) {
                console.error('Error:', error);
            }
        }
    };

    onMount(async () => {
        if (token) {
            onUpdate(token);
        }
    });
</script>

<div>
    <div
        class="relative {className} flex flex-col rounded-3xl border border-gray-100/30 dark:border-gray-850/30 my-0.5"
        dir="ltr"
    >
        {#if lang === 'mermaid'}
            {#if renderHTML}
                <SvgPanZoom
                    className=" rounded-3xl max-h-fit overflow-hidden"
                    svg={renderHTML}
                    content={(_token as Tokens.Code | null)?.text ?? ''}
                />
            {:else}
                <div class="p-3">
                    {#if renderError}
                        <div
                            class="flex gap-2.5 border px-4 py-3 border-red-600/10 bg-red-600/10 rounded-2xl mb-2"
                        >
                            {renderError}
                        </div>
                    {/if}
                    <pre>{code}</pre>
                </div>
            {/if}
        {:else}
            <div
                class="absolute left-0 right-0 py-2.5 pr-3 text-text-300 pl-4.5 text-xs font-medium dark:text-white"
            >
                {lang}
            </div>

            <div
                class="sticky {stickyButtonsClassName} left-0 right-0 py-2 pr-3 flex items-center justify-end w-full z-10 text-xs text-black dark:text-white"
            >
                <div class="flex items-center gap-0.5">
                    <button
                        class="flex gap-1 items-center bg-none border-none transition rounded-md px-1.5 py-0.5 bg-white dark:bg-black"
                        on:click={collapseCodeBlock}
                    >
                        <div class=" -translate-y-[0.5px]">
                            <ChevronUpDown className="size-3" />
                        </div>

                        <div>
                            {collapsed ? 'Expand' : 'Collapse'}
                        </div>
                    </button>

                    {#if save}
                        <button
                            class="save-code-button bg-none border-none transition rounded-md px-1.5 py-0.5 bg-white dark:bg-black"
                            on:click={saveCode}
                        >
                            {saved ? 'Saved' : 'Save'}
                        </button>
                    {/if}

                    <button
                        class="bg-none border-none transition rounded-md px-1.5 py-0.5 bg-white dark:bg-black"
                        on:click={copyCode}>{copied ? 'Copied' : 'Copy'}</button
                    >
                </div>
            </div>

            <div
                class="language-{lang} rounded-t-3xl -mt-9 {editorClassName
                    ? editorClassName
                    : stdout || stderr || result
                      ? ''
                      : 'rounded-b-3xl'} overflow-hidden"
            >
                <div class=" pt-8 bg-white dark:bg-black"></div>

                {#if !collapsed}
                    <pre
                        class=" hljs p-4 px-5 overflow-x-auto"
                        style="border-top-left-radius: 0px; border-top-right-radius: 0px; {(stdout ||
                            stderr ||
                            result) &&
                            'border-bottom-left-radius: 0px; border-bottom-right-radius: 0px;'}"><code
                            class="language-{lang} rounded-t-none whitespace-pre text-sm"
                            >{@html hljs.highlightAuto(code, hljs.getLanguage(lang)?.aliases)
                                .value || code}</code
                        ></pre>
                {:else}
                    <div
                        class="bg-white dark:bg-black dark:text-white rounded-b-3xl! pt-0.5 pb-3 px-4 flex flex-col gap-2 text-xs"
                    >
                        <span class="text-gray-500 italic">
                            {`${code.split('\n').length} hidden lines`}
                        </span>
                    </div>
                {/if}
            </div>

            {#if !collapsed}
                <div
                    id="plt-canvas-{id}"
                    class="bg-gray-50 dark:bg-black dark:text-white max-w-full overflow-x-auto scrollbar-hidden"
                ></div>

                {#if stdout || stderr || result || files}
                    <div
                        class="bg-gray-50 dark:bg-black dark:text-white rounded-b-3xl! py-4 px-4 flex flex-col gap-2"
                    >
                        {#if stdout || stderr}
                            <div class=" ">
                                <div class=" text-gray-500 text-sm mb-1">{'STDOUT/STDERR'}</div>
                                <div
                                    class="text-sm font-mono whitespace-pre-wrap {(stdout?.split(
                                        '\n'
                                    )?.length ?? 0) > 100
                                        ? `max-h-96`
                                        : ''}  overflow-y-auto"
                                >
                                    {stdout || stderr}
                                </div>
                            </div>
                        {/if}
                        {#if result || files}
                            <div class=" ">
                                <div class=" text-gray-500 text-sm mb-1">{'RESULT'}</div>
                                {#if result}
                                    <div class="text-sm">{`${JSON.stringify(result)}`}</div>
                                {/if}
                                {#if files}
                                    <div class="flex flex-col gap-2">
                                        {#each files as Array<{ type: string; data: string }> as file}
                                            {#if file.type.startsWith('image')}
                                                <img
                                                    src={file.data}
                                                    alt="Output"
                                                    class=" w-full max-w-[36rem]"
                                                />
                                            {/if}
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
            {/if}
        {/if}
    </div>
</div>
