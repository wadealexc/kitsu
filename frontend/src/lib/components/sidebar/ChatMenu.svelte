<script lang="ts">
    import { DropdownMenu } from 'bits-ui';
    import { flyAndScale } from '$lib/utils/transitions';
    import { saveAs } from '$lib/utils';

    import Dropdown from '$lib/components/common/Dropdown.svelte';
    import GarbageBin from '$lib/components/icons/GarbageBin.svelte';
    import Pencil from '$lib/components/icons/Pencil.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import Share from '$lib/components/icons/Share.svelte';
    import DocumentDuplicate from '$lib/components/icons/DocumentDuplicate.svelte';
    import { getChatById } from '$lib/apis/chats';
    import { folders } from '$lib/stores';
    import { createMessagesList } from '$lib/utils';
    import Download from '$lib/components/icons/Download.svelte';
    import Folder from '$lib/components/icons/Folder.svelte';
    import type { Chat } from '@backend/routes/types';

    export let shareHandler: Function;
    export let moveChatHandler: Function;

    export let cloneChatHandler: Function;
    export let renameHandler: Function;
    export let deleteHandler: Function;
    export let onClose: Function;

    export let chatId = '';

    let show = false;

    const getChatAsText = async (chat: Chat) => {
        const history = chat.chat.history;
        const messages = createMessagesList(history, history.currentId);
        const chatText = messages.reduce((a, message, i, arr) => {
            return `${a}### ${message.role.toUpperCase()}\n${message.content}\n\n`;
        }, '');

        return chatText.trim();
    };

    const downloadTxt = async () => {
        const chat = await getChatById(localStorage.token, chatId);
        if (!chat) {
            return;
        }

        const chatText = await getChatAsText(chat);
        let blob = new Blob([chatText], {
            type: 'text/plain'
        });

        saveAs(blob, `chat-${chat.chat.title}.txt`);
    };

    const downloadJSONExport = async () => {
        const chat = await getChatById(localStorage.token, chatId);

        if (chat) {
            let blob = new Blob([JSON.stringify([chat])], {
                type: 'application/json'
            });
            saveAs(blob, `chat-export-${Date.now()}.json`);
        }
    };
</script>

<Dropdown
    bind:show
    on:change={(e) => {
        if (e.detail === false) {
            onClose();
        }
    }}
>
    <Tooltip content="More">
        <slot />
    </Tooltip>

    <div slot="content">
        <DropdownMenu.Content
            class="w-full max-w-[200px] rounded-2xl px-1 py-1  border border-gray-100  dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg transition"
            sideOffset={-2}
            side="bottom"
            align="start"
            transition={flyAndScale}
        >
            <DropdownMenu.Item
                class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800  rounded-xl"
                on:click={() => {
                    shareHandler();
                }}
            >
                <Share strokeWidth="1.5" />
                <div class="flex items-center">{'Share'}</div>
            </DropdownMenu.Item>

            <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger
                    class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                >
                    <Download strokeWidth="1.5" />

                    <div class="flex items-center">{'Download'}</div>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.SubContent
                    class="w-full rounded-2xl p-1 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg border border-gray-100  dark:border-gray-800"
                    transition={flyAndScale}
                    sideOffset={8}
                >
                    <DropdownMenu.Item
                        class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                        on:click={() => {
                            downloadJSONExport();
                        }}
                    >
                        <div class="flex items-center line-clamp-1">{'Export chat (.json)'}</div>
                    </DropdownMenu.Item>

                    <DropdownMenu.Item
                        class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                        on:click={() => {
                            downloadTxt();
                        }}
                    >
                        <div class="flex items-center line-clamp-1">{'Plain text (.txt)'}</div>
                    </DropdownMenu.Item>
                </DropdownMenu.SubContent>
            </DropdownMenu.Sub>

            <DropdownMenu.Item
                class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                on:click={() => {
                    renameHandler();
                }}
            >
                <Pencil strokeWidth="1.5" />
                <div class="flex items-center">{'Rename'}</div>
            </DropdownMenu.Item>

            <hr class="border-gray-50/30 dark:border-gray-800/30 my-1" />

            <DropdownMenu.Item
                class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                on:click={() => {
                    cloneChatHandler();
                }}
            >
                <DocumentDuplicate strokeWidth="1.5" />
                <div class="flex items-center">{'Clone'}</div>
            </DropdownMenu.Item>

            {#if chatId && $folders.length > 0}
                <DropdownMenu.Sub>
                    <DropdownMenu.SubTrigger
                        class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl select-none w-full"
                    >
                        <Folder />

                        <div class="flex items-center">{'Move'}</div>
                    </DropdownMenu.SubTrigger>
                    <DropdownMenu.SubContent
                        class="w-full rounded-2xl p-1 z-50 bg-white dark:bg-gray-850 dark:text-white border border-gray-100  dark:border-gray-800 shadow-lg max-h-52 overflow-y-auto scrollbar-hidden"
                        transition={flyAndScale}
                        sideOffset={8}
                    >
                        {#each $folders.sort((a, b) => b.updatedAt - a.updatedAt) as folder}
                            <DropdownMenu.Item
                                class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                                on:click={() => {
                                    moveChatHandler(chatId, folder.id);
                                }}
                            >
                                <Folder />

                                <div class="flex items-center">{folder?.name ?? 'Folder'}</div>
                            </DropdownMenu.Item>
                        {/each}
                    </DropdownMenu.SubContent>
                </DropdownMenu.Sub>
            {/if}

            <DropdownMenu.Item
                class="flex  gap-2  items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                on:click={() => {
                    deleteHandler();
                }}
            >
                <GarbageBin strokeWidth="1.5" />
                <div class="flex items-center">{'Delete'}</div>
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </div>
</Dropdown>
