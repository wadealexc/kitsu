<script lang="ts">
    import { toast } from 'svelte-sonner';

    import { onDestroy, onMount, tick } from 'svelte';
    import { models, settings, streamContext, type Model } from '$lib/stores';
    import type {
        ChatHistory,
        ChatMessage,
        ChatMessageFile,
        ReasoningBlock,
        ToolCallBlock,
        ContentBlock
    } from '@backend/routes/types';

    import { copyToClipboard as _copyToClipboard, sanitizeResponseContent } from '$lib/utils';
    import type { WebSearchProgress } from '$lib/apis/completions';

    import Name from './ResponseMessage/Name.svelte';
    import WebSearchBlock from './ResponseMessage/WebSearchBlock.svelte';
    import Image from '$lib/components/common/Image.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';

    import DeleteConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';

    import Error from './ResponseMessage/Error.svelte';
    import Markdown from './Markdown.svelte';
    import FileItem from './FileItem.svelte';
    import RegenerateMenu from './ResponseMessage/RegenerateMenu.svelte';
    import Collapsible from '$lib/components/common/Collapsible.svelte';
    import BranchNavigator from './BranchNavigator.svelte';
    import MessageEditor from './MessageEditor.svelte';
    import ModelStatusPill from './ResponseMessage/ModelStatusPill.svelte';

    export let chatId: string = '';
    export let history: ChatHistory;
    export let messageId: string;

    let message: ChatMessage = structuredClone(history.messages[messageId]);
    $: if (history.messages) {
        const current = history.messages[messageId];

        if (current) {
            if (
                message.content !== current.content ||
                message.done != current.done ||
                message.error !== current.error
            ) {
                message = structuredClone(current);
            } else if (JSON.stringify(message) !== JSON.stringify(current)) {
                message = structuredClone(current);
            }
        }
    }

    let messageIsEmpty: boolean;
    $: messageIsEmpty =
        message.content === '' &&
        !message.error &&
        (!message.blocks || message.blocks.length === 0);

    export let siblings: string[];

    export let goToSibling: (message: ChatMessage, idx: number) => void = () => {};

    export let editMessage: (
        messageId: string,
        update: { content: string; files: ChatMessageFile[] },
        submit?: boolean
    ) => void | Promise<void>;
    export let deleteMessage: (messageId: string) => void | Promise<void>;

    export let regenerateResponse: (message: ChatMessage) => void | Promise<void>;

    export let isLastMessage: boolean = true;
    export let readOnly: boolean = false;

    export let toolProgress: Map<string, WebSearchProgress> | undefined = undefined;
    export let modelStatus: { status: 'queued' | 'loading'; modelName: string } | undefined =
        undefined;
    $: promptProcessing = $streamContext?.promptProcessing;
    $: promptPct = promptProcessing
        ? Math.round((promptProcessing.processed / promptProcessing.total) * 100)
        : 0;
    let contentContainerElement: HTMLDivElement;
    let buttonsContainerElement: HTMLDivElement;
    let showDeleteConfirm = false;

    let model: Model | undefined;
    $: model = $models.find((m) => m.id === message.model);

    let edit = false;
    let editorRef: MessageEditor;

    const copyToClipboard = async (text: string) => {
        const res = await _copyToClipboard(text);
        if (res) {
            toast.success('Copying to clipboard was successful!');
        }
    };

    const editMessageHandler = async () => {
        edit = true;
        await tick();
        editorRef.activate(message.content);
    };

    const cancelEditMessage = async () => {
        edit = false;
        await tick();
    };

    const deleteMessageHandler = async () => {
        deleteMessage(message.id);
    };

    const buttonsWheelHandler = (event: WheelEvent) => {
        if (buttonsContainerElement) {
            if (buttonsContainerElement.scrollWidth <= buttonsContainerElement.clientWidth) {
                // If the container is not scrollable, horizontal scroll
                return;
            } else {
                event.preventDefault();

                if (event.deltaY !== 0) {
                    // Adjust horizontal scroll position based on vertical scroll
                    buttonsContainerElement.scrollLeft += event.deltaY;
                }
            }
        }
    };

    const contentCopyHandler = (e: ClipboardEvent) => {
        if (contentContainerElement) {
            e.preventDefault();
            // Get the selected HTML
            const selection = window.getSelection();
            if (!selection) return;
            const range = selection.getRangeAt(0);
            const tempDiv = document.createElement('div');

            // Remove background, color, and font styles
            tempDiv.appendChild(range.cloneContents());

            tempDiv.querySelectorAll('table').forEach((table) => {
                table.style.borderCollapse = 'collapse';
                table.style.width = 'auto';
                table.style.tableLayout = 'auto';
            });

            tempDiv.querySelectorAll('th').forEach((th) => {
                th.style.whiteSpace = 'nowrap';
                th.style.padding = '4px 8px';
            });

            // Put cleaned HTML + plain text into clipboard
            if (!e.clipboardData) return;
            e.clipboardData.setData('text/html', tempDiv.innerHTML);
            e.clipboardData.setData('text/plain', selection.toString());
        }
    };

    onMount(async () => {
        await tick();
        if (buttonsContainerElement) {
            buttonsContainerElement.addEventListener('wheel', buttonsWheelHandler);
        }

        if (contentContainerElement) {
            contentContainerElement.addEventListener('copy', contentCopyHandler);
        }
    });

    onDestroy(() => {
        if (buttonsContainerElement) {
            buttonsContainerElement.removeEventListener('wheel', buttonsWheelHandler);
        }

        if (contentContainerElement) {
            contentContainerElement.removeEventListener('copy', contentCopyHandler);
        }
    });
</script>

<DeleteConfirmDialog
    bind:show={showDeleteConfirm}
    title="Delete message?"
    on:confirm={() => {
        deleteMessageHandler();
    }}
/>

{#key message.id}
    <div class=" flex w-full message-{message.id}" id="message-{message.id}">
        <div class="shrink-0 mr-3 hidden @lg:block mt-1 size-8 relative"></div>

        <div class="flex-auto w-0 pl-1 relative">
            <Name>
                <span
                    id="response-message-model-name"
                    class="line-clamp-1 text-black dark:text-white"
                >
                    {model?.name ?? message.model}
                </span>
            </Name>

            <div>
                <div class="chat-{message.role} w-full min-w-full markdown-prose">
                    <div>
                        {#if message.files.filter((f) => f.type === 'image').length > 0}
                            <div class="my-1 w-full flex overflow-x-auto gap-2 flex-wrap">
                                {#each message.files as file}
                                    <div>
                                        {#if file.type === 'image' || (file?.contentType ?? '').startsWith('image/')}
                                            <Image src={file.url} alt={message.content} />
                                        {:else}
                                            <FileItem item={file} small={true} />
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        {#if edit === true}
                            <MessageEditor
                                bind:this={editorRef}
                                content={message.content}
                                primaryLabel="Save"
                                secondaryLabel="Save As Copy"
                                scrollContainer={true}
                                on:confirm={({ detail }) => {
                                    editMessage(
                                        message.id,
                                        { content: detail.content, files: message.files },
                                        false
                                    );
                                    edit = false;
                                }}
                                on:secondary={({ detail }) => {
                                    editMessage(message.id, {
                                        content: detail.content,
                                        files: message.files
                                    });
                                    edit = false;
                                }}
                                on:cancel={cancelEditMessage}
                            />
                        {/if}

                        <div
                            bind:this={contentContainerElement}
                            class="w-full flex flex-col relative {edit ? 'hidden' : ''}"
                            id="response-content-container"
                        >
                            {#if modelStatus && messageIsEmpty}
                                <ModelStatusPill
                                    status={modelStatus.status}
                                    modelName={modelStatus.modelName}
                                />
                            {:else if messageIsEmpty}
                                {#if promptProcessing}
                                    <div class="flex flex-col gap-0.5">
                                        <span class="text-xs text-gray-400 dark:text-gray-500">
                                            Processing prompt... {promptPct}%
                                        </span>
                                        <div
                                            class="h-1 w-48 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden"
                                        >
                                            <div
                                                class="h-full bg-blue-400 dark:bg-blue-500 transition-all duration-200"
                                                style="width: {promptPct}%"
                                            ></div>
                                        </div>
                                    </div>
                                {/if}
                            {:else}
                                {#if message.blocks && message.blocks.length > 0}
                                    {#each message.blocks as block, i (block.type === 'tool_call' ? block.id : `block-${i}`)}
                                        {#if block.type === 'reasoning'}
                                            <Collapsible
                                                attributes={{
                                                    type: 'reasoning',
                                                    done: block.done ? 'true' : 'false',
                                                    duration: block.duration
                                                }}
                                                title=""
                                                open={false}
                                            >
                                                <div
                                                    slot="content"
                                                    class="border-s-2 border-s-gray-100 dark:border-gray-800 ps-3"
                                                >
                                                    <Markdown
                                                        id={`${chatId}-${message.id}-reasoning-${i}`}
                                                        content={block.content}
                                                        done={block.done}
                                                    />
                                                </div>
                                            </Collapsible>
                                        {:else if block.type === 'content'}
                                            <Markdown
                                                id={`${chatId}-${message.id}-content-${i}`}
                                                content={block.content}
                                                done={block.done}
                                            />
                                        {:else if block.type === 'tool_call' && block.name === 'webSearch'}
                                            <WebSearchBlock
                                                {block}
                                                progress={toolProgress?.get(block.id)}
                                            />
                                        {:else if block.type === 'tool_call'}
                                            <Collapsible
                                                attributes={{
                                                    type: 'tool_calls',
                                                    id: block.id,
                                                    name: block.name,
                                                    done: block.done ? 'true' : 'false',
                                                    arguments: block.arguments,
                                                    result: block.result ?? ''
                                                }}
                                                open={false}
                                            />
                                        {/if}
                                    {/each}
                                {/if}

                                {#if message.content && message.error !== true}
                                    <Markdown
                                        id={`${chatId}-${message.id}`}
                                        content={message.content}
                                        done={$settings.chatFadeStreamingText ? message.done : true}
                                    />
                                {/if}

                                {#if message.error}
                                    <Error
                                        content={typeof message.error === 'object'
                                            ? message.error.content
                                            : message.content}
                                    />
                                {/if}
                            {/if}
                        </div>
                    </div>
                </div>

                {#if !edit}
                    <div
                        bind:this={buttonsContainerElement}
                        class="flex justify-start overflow-x-auto buttons text-gray-600 dark:text-gray-500 mt-0.5"
                    >
                        {#if message.done}
                            {#if siblings.length > 1}
                                <BranchNavigator {message} {siblings} {goToSibling} />
                            {/if}

                            {#if !readOnly}
                                <button
                                    aria-label="Edit"
                                    class="{isLastMessage
                                        ? 'visible'
                                        : 'invisible group-hover:visible'} p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg dark:hover:text-white hover:text-black transition"
                                    on:click={() => editMessageHandler()}
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke-width="2.3"
                                        aria-hidden="true"
                                        stroke="currentColor"
                                        class="w-4 h-4"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                                        />
                                    </svg>
                                </button>
                            {/if}

                            <button
                                aria-label="Copy"
                                class="{isLastMessage
                                    ? 'visible'
                                    : 'invisible group-hover:visible'} p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg dark:hover:text-white hover:text-black transition"
                                on:click={() => copyToClipboard(message.content)}
                            >
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    aria-hidden="true"
                                    viewBox="0 0 24 24"
                                    stroke-width="2.3"
                                    stroke="currentColor"
                                    class="w-4 h-4"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                                    />
                                </svg>
                            </button>

                            {#if message.usage}
                                <Tooltip
                                    content={message.usage
                                        ? `<pre>${sanitizeResponseContent(
                                              JSON.stringify(message.usage, null, 2)
                                                  .replace(/"([^(")"]+)":/g, '$1:')
                                                  .slice(1, -1)
                                                  .split('\n')
                                                  .map((line) => line.slice(2))
                                                  .map((line) =>
                                                      line.endsWith(',') ? line.slice(0, -1) : line
                                                  )
                                                  .join('\n')
                                          )}</pre>`
                                        : ''}
                                    placement="bottom"
                                >
                                    <button
                                        aria-hidden="true"
                                        class=" {isLastMessage
                                            ? 'visible'
                                            : 'invisible group-hover:visible'} p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg dark:hover:text-white hover:text-black transition whitespace-pre-wrap"
                                        on:click={() => {}}
                                        id="info-{message.id}"
                                    >
                                        <svg
                                            aria-hidden="true"
                                            xmlns="http://www.w3.org/2000/svg"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke-width="2.3"
                                            stroke="currentColor"
                                            class="w-4 h-4"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                                            />
                                        </svg>
                                    </button>
                                </Tooltip>
                            {/if}

                            {#if !readOnly}
                                {#if $settings.regenerateMenu}
                                    <RegenerateMenu
                                        onRegenerate={() => regenerateResponse(message)}
                                    >
                                        <div
                                            aria-label="Regenerate"
                                            class="{isLastMessage
                                                ? 'visible'
                                                : 'invisible group-hover:visible'} p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg dark:hover:text-white hover:text-black transition"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke-width="2.3"
                                                aria-hidden="true"
                                                stroke="currentColor"
                                                class="w-4 h-4"
                                            >
                                                <path
                                                    stroke-linecap="round"
                                                    stroke-linejoin="round"
                                                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                                                />
                                            </svg>
                                        </div>
                                    </RegenerateMenu>
                                {:else}
                                    <button
                                        type="button"
                                        aria-label="Regenerate"
                                        class="{isLastMessage
                                            ? 'visible'
                                            : 'invisible group-hover:visible'} p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg dark:hover:text-white hover:text-black transition"
                                        on:click={() => regenerateResponse(message)}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke-width="2.3"
                                            aria-hidden="true"
                                            stroke="currentColor"
                                            class="w-4 h-4"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                                            />
                                        </svg>
                                    </button>
                                {/if}

                                {#if siblings.length > 1}
                                    <button
                                        type="button"
                                        aria-label="Delete"
                                        id="delete-response-button"
                                        class="{isLastMessage
                                            ? 'visible'
                                            : 'invisible group-hover:visible'} p-1.5 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg dark:hover:text-white hover:text-black transition"
                                        on:click={() => {
                                            showDeleteConfirm = true;
                                        }}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke-width="2"
                                            stroke="currentColor"
                                            aria-hidden="true"
                                            class="w-4 h-4"
                                        >
                                            <path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                                            />
                                        </svg>
                                    </button>
                                {/if}
                            {/if}
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/key}

<style>
    .buttons::-webkit-scrollbar {
        display: none; /* for Chrome, Safari and Opera */
    }

    .buttons {
        -ms-overflow-style: none; /* IE and Edge */
        scrollbar-width: none; /* Firefox */
    }
</style>
