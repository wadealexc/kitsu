<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { formatFileSize, getLineCount } from '$lib/utils';
    import { API_BASE_URL } from '$lib/constants';
    import { getFileById } from '$lib/apis/files';

    import CodeBlock from '$lib/components/chat/Messages/CodeBlock.svelte';
    import Markdown from '$lib/components/chat/Messages/Markdown.svelte';

    import Modal from '$lib/components/common/Modal.svelte';
    import XMark from '$lib/components/icons/XMark.svelte';
    import Switch from '$lib/components/common/Switch.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import dayjs from 'dayjs';
    import Spinner from '$lib/components/common/Spinner.svelte';

    import type { InputFileItem } from '$lib/types';

    export let item: InputFileItem;
    export let show = false;
    export let edit = false;

    let enableFullContent = false;
    let loading = false;

    let isPDF = false;
    let isAudio = false;

    let selectedTab = '';

    $: isPDF = item.contentType === 'application/pdf' || item.name.toLowerCase().endsWith('.pdf');

    $: isMarkdown = item.contentType === 'text/markdown' || item.name.toLowerCase().endsWith('.md');

    $: isCode =
        item.name.toLowerCase().endsWith('.py') ||
        item.name.toLowerCase().endsWith('.js') ||
        item.name.toLowerCase().endsWith('.ts') ||
        item.name.toLowerCase().endsWith('.java') ||
        item.name.toLowerCase().endsWith('.html') ||
        item.name.toLowerCase().endsWith('.css') ||
        item.name.toLowerCase().endsWith('.json') ||
        item.name.toLowerCase().endsWith('.cpp') ||
        item.name.toLowerCase().endsWith('.c') ||
        item.name.toLowerCase().endsWith('.h') ||
        item.name.toLowerCase().endsWith('.sh') ||
        item.name.toLowerCase().endsWith('.bash') ||
        item.name.toLowerCase().endsWith('.yaml') ||
        item.name.toLowerCase().endsWith('.yml') ||
        item.name.toLowerCase().endsWith('.xml') ||
        item.name.toLowerCase().endsWith('.sql') ||
        item.name.toLowerCase().endsWith('.go') ||
        item.name.toLowerCase().endsWith('.rs') ||
        item.name.toLowerCase().endsWith('.php') ||
        item.name.toLowerCase().endsWith('.rb');

    $: isAudio =
        item.contentType.startsWith('audio/') ||
        !!item.name.match(/\.(mp3|wav|ogg|m4a|webm)$/i);

    const loadContent = async () => {
        selectedTab = '';
        if (item.type === 'file') {
            loading = true;

            const file = await getFileById(localStorage.token, item.id).catch((e) => {
                console.error('Error fetching file:', e);
                return null;
            });

            if (file) {
                item.file = file;
            }

            loading = false;
        }

        await tick();
    };

    $: if (show) {
        loadContent();
    }

    onMount(() => {
        console.log(item);
        if (item.context === 'full') {
            enableFullContent = true;
        }
    });
</script>

<Modal bind:show size="lg">
    <div class="font-primary px-4.5 py-3.5 w-full flex flex-col justify-center dark:text-gray-400">
        <div class=" pb-2">
            <div class="flex items-start justify-between">
                <div>
                    <div class=" font-medium text-lg dark:text-gray-100">
                        <a
                            href={null}
                            class="hover:underline line-clamp-1 cursor-pointer"
                            on:click|preventDefault={() => {
                                if (!isPDF && item.url) {
                                    window.open(
                                        item.type === 'file'
                                            ? item.url.startsWith('http')
                                                ? item.url
                                                : `${API_BASE_URL}/files/${item.url}/content`
                                            : item.url,
                                        '_blank'
                                    );
                                }
                            }}
                        >
                            {item.name}
                        </a>
                    </div>
                </div>

                <div>
                    <button
                        on:click={() => {
                            show = false;
                        }}
                    >
                        <XMark />
                    </button>
                </div>
            </div>

            <div>
                <div class="flex flex-col items-center md:flex-row gap-1 justify-between w-full">
                    <div class=" flex flex-wrap text-xs gap-1 text-gray-500">
                        {#if item.size}
                            <div class="capitalize shrink-0">{formatFileSize(item.size)}</div>
                        {/if}

                        {#if item.file?.data?.content}
                            <div class="capitalize shrink-0">
                                {`${getLineCount(item?.file?.data?.content ?? '')} extracted lines`}
                            </div>
                        {/if}
                    </div>

                    {#if edit}
                        <div class=" self-end">
                            <Tooltip
                                content={enableFullContent
                                    ? 'Inject the entire content as context for comprehensive processing, this is recommended for complex queries.'
                                    : 'Default to segmented retrieval for focused and relevant content extraction, this is recommended for most cases.'}
                            >
                                <div class="flex items-center gap-1.5 text-xs">
                                    {#if enableFullContent}
                                        {'Using Entire Document'}
                                    {:else}
                                        {'Using Focused Retrieval'}
                                    {/if}
                                    <Switch
                                        bind:state={enableFullContent}
                                        on:change={(e) => {
                                            item.context = e.detail ? 'full' : undefined;
                                        }}
                                    />
                                </div>
                            </Tooltip>
                        </div>
                    {/if}
                </div>
            </div>
        </div>

        <div class="max-h-[75vh] overflow-auto">
            {#if !loading}
                {#if isAudio || isPDF || isCode || isMarkdown}
                    <div
                        class="flex mb-2.5 scrollbar-none overflow-x-auto w-full border-b border-gray-50 dark:border-gray-850/30 text-center text-sm font-medium bg-transparent dark:text-gray-200"
                    >
                        <button
                            class="min-w-fit py-1.5 px-4 border-b {selectedTab === ''
                                ? ' '
                                : ' border-transparent text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition"
                            type="button"
                            on:click={() => {
                                selectedTab = '';
                            }}>{'Content'}</button
                        >

                        <button
                            class="min-w-fit py-1.5 px-4 border-b {selectedTab === 'preview'
                                ? ' '
                                : ' border-transparent text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition"
                            type="button"
                            on:click={() => {
                                selectedTab = 'preview';
                            }}>{'Preview'}</button
                        >
                    </div>
                {/if}

                {#if selectedTab === ''}
                    {#if item.file?.data}
                        <div
                            class="max-h-96 overflow-scroll scrollbar-hidden text-xs whitespace-pre-wrap"
                        >
                            {(item.file?.data?.content ?? '').trim() || 'No content'}
                        </div>
                    {:else if item.content}
                        <div
                            class="max-h-96 overflow-scroll scrollbar-hidden text-xs whitespace-pre-wrap"
                        >
                            {item.content.trim() || 'No content'}
                        </div>
                    {/if}
                {:else if selectedTab === 'preview'}
                    {#if isAudio}
                        <audio
                            src={`${API_BASE_URL}/files/${item.id}/content`}
                            class="w-full border-0 rounded-lg mb-2"
                            controls
                            playsinline
                        ></audio>
                    {:else if isPDF}
                        <iframe
                            title={item.name}
                            src={`${API_BASE_URL}/files/${item.id}/content`}
                            class="w-full h-[70vh] border-0 rounded-lg"
                        ></iframe>
                    {:else if isCode}
                        <div class="max-h-[60vh] overflow-scroll scrollbar-hidden text-sm relative">
                            <CodeBlock
                                code={item.file?.data?.content ?? ''}
                                lang={item.name.split('.').pop() ?? ''}
                            />
                        </div>
                    {:else if isMarkdown}
                        <div
                            class="max-h-[60vh] overflow-scroll scrollbar-hidden text-sm prose dark:prose-invert max-w-full"
                        >
                            <Markdown
                                content={item.file?.data?.content ?? ''}
                                id="markdown-viewer"
                            />
                        </div>
                    {:else}
                        <div
                            class="max-h-96 overflow-scroll scrollbar-hidden text-xs whitespace-pre-wrap"
                        >
                            {(item.file?.data?.content ?? '').trim() || 'No content'}
                        </div>
                    {/if}
                {/if}
            {:else}
                <div class="flex items-center justify-center py-6">
                    <Spinner className="size-5" />
                </div>
            {/if}
        </div>
    </div>
</Modal>
