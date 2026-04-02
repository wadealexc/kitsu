<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { API_BASE_URL } from '$lib/constants';

    import { formatFileSize } from '$lib/utils';
    import { settings } from '$lib/stores';

    import FileItemModal from './FileItemModal.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import XMark from '$lib/components/icons/XMark.svelte';

    const dispatch = createEventDispatcher();

    export let className = 'w-60';
    export let colorClassName =
        'bg-white dark:bg-gray-850 border border-gray-50/30 dark:border-gray-800/30';

    export let dismissible = false;
    export let modal = false;
    export let loading = false;

    export let item: InputFileItem;
    export let edit = false;
    export let small = false;

    import DocumentPage from '$lib/components/icons/DocumentPage.svelte';
    import Database from '$lib/components/icons/Database.svelte';
    import PageEdit from '$lib/components/icons/PageEdit.svelte';
    import ChatBubble from '$lib/components/icons/ChatBubble.svelte';
    import Folder from '$lib/components/icons/Folder.svelte';
    import type { InputFileItem } from '$lib/types';
    let showModal = false;

    const decodeString = (str: string) => {
        try {
            return decodeURIComponent(str);
        } catch (e) {
            return str;
        }
    };
</script>

{#if item}
    <FileItemModal bind:show={showModal} bind:item {edit} />
{/if}

<div class="relative group {className}">
    <button
        class="p-1.5 w-full flex items-center gap-1 {colorClassName} {small
            ? 'rounded-xl p-2'
            : 'rounded-2xl'} text-left"
        type="button"
        on:click={async () => {
            if (item.type === 'file' || item?.content || modal) {
                showModal = !showModal;
            } else {
                if (item.url) {
                    if (item.type === 'file') {
                        if (item.url.startsWith('http')) {
                            window.open(`${item.url}/content`, '_blank')?.focus();
                        } else {
                            window
                                .open(`${API_BASE_URL}/files/${item.url}/content`, '_blank')
                                ?.focus();
                        }
                    } else {
                        window.open(`${item.url}`, '_blank')?.focus();
                    }
                }
            }

            dispatch('click');
        }}
    >
        {#if !small}
            <div
                class="size-10 shrink-0 flex justify-center items-center bg-black/20 dark:bg-white/10 text-white rounded-xl"
            >
                {#if !loading}
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                        class=" size-4.5"
                    >
                        <path
                            fill-rule="evenodd"
                            d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0 0 16.5 9h-1.875a1.875 1.875 0 0 1-1.875-1.875V5.25A3.75 3.75 0 0 0 9 1.5H5.625ZM7.5 15a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 7.5 15Zm.75 2.25a.75.75 0 0 0 0 1.5H12a.75.75 0 0 0 0-1.5H8.25Z"
                            clip-rule="evenodd"
                        />
                        <path
                            d="M12.971 1.816A5.23 5.23 0 0 1 14.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 0 1 3.434 1.279 9.768 9.768 0 0 0-6.963-6.963Z"
                        />
                    </svg>
                {:else}
                    <Spinner />
                {/if}
            </div>
        {:else}
            <div class="pl-1.5">
                {#if !loading}
                    <Tooltip
                        content={item.type === 'collection'
                            ? 'Collection'
                            : item.type === 'note'
                              ? 'Note'
                              : item.type === 'chat'
                                ? 'Chat'
                                : item.type === 'file'
                                  ? 'File'
                                  : 'Document'}
                        placement="top"
                    >
                        {#if item.type === 'collection'}
                            <Database />
                        {:else if item.type === 'note'}
                            <PageEdit />
                        {:else if item.type === 'chat'}
                            <ChatBubble />
                        {:else if item.type === 'folder'}
                            <Folder />
                        {:else}
                            <DocumentPage />
                        {/if}
                    </Tooltip>
                {:else}
                    <Spinner />
                {/if}
            </div>
        {/if}

        {#if !small}
            <div class="flex flex-col justify-center -space-y-0.5 px-2.5 w-full">
                <div class=" dark:text-gray-100 text-sm font-medium line-clamp-1 mb-1">
                    {decodeString(item.name)}
                </div>

                <div class=" flex justify-between text-xs line-clamp-1 text-gray-500">
                    {#if item.type === 'file'}
                        {'File'}
                    {:else if item.type === 'note'}
                        {'Note'}
                    {:else if item.type === 'doc'}
                        {'Document'}
                    {:else if item.type === 'collection'}
                        {'Collection'}
                    {:else}
                        <span class=" capitalize line-clamp-1">{item.type}</span>
                    {/if}
                    {#if item.size}
                        <span class="capitalize">{formatFileSize(item.size)}</span>
                    {/if}
                </div>
            </div>
        {:else}
            <Tooltip
                content={decodeString(item.name)}
                className="flex flex-col w-full"
                placement="top-start"
            >
                <div class="flex flex-col justify-center -space-y-0.5 px-1 w-full">
                    <div class=" dark:text-gray-100 text-sm flex justify-between items-center">
                        <div class="font-medium line-clamp-1 flex-1 pr-1">
                            {decodeString(item.name)}
                        </div>
                        {#if item.size}
                            <div class="text-gray-500 text-xs capitalize shrink-0">
                                {formatFileSize(item.size)}
                            </div>
                        {:else}
                            <div class="text-gray-500 text-xs capitalize shrink-0">{item.type}</div>
                        {/if}
                    </div>
                </div>
            </Tooltip>
        {/if}
    </button>
    {#if dismissible}
        <div class=" absolute -top-1 -right-1">
            <button
                aria-label="Remove File"
                class=" bg-white text-black border border-gray-50 rounded-full outline-hidden focus:outline-hidden group-hover:visible invisible transition"
                type="button"
                on:click|stopPropagation={() => {
                    dispatch('dismiss');
                }}
            >
                <XMark className="size-4" />
            </button>
        </div>
    {/if}
</div>
