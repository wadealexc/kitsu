<script lang="ts">
    import { toast } from 'svelte-sonner';
    import { DropdownMenu } from 'bits-ui';
    import { saveAs, copyToClipboard, createMessagesList } from '$lib/utils';
    import type { ChatHistory } from '@backend/routes/types';

    import { temporaryChatEnabled, folders } from '$lib/stores';
    import { flyAndScale } from '$lib/utils/transitions';
    import { getChatById } from '$lib/apis/chats';

    import Dropdown from '$lib/components/common/Dropdown.svelte';
    import Clipboard from '$lib/components/icons/Clipboard.svelte';
    import Folder from '$lib/components/icons/Folder.svelte';
    import Share from '$lib/components/icons/Share.svelte';
    import Download from '$lib/components/icons/Download.svelte';

    export let shareHandler: Function;
    export let moveChatHandler: Function;

    export let chatId: string;
    export let chatTitle: string;
    export let history: ChatHistory;
    export let onClose: Function = () => {};

    const getChatAsText = async () => {
        const messages = createMessagesList(history, history.currentId);
        const chatText = messages.reduce((a, message, i, arr) => {
            return `${a}### ${message.role.toUpperCase()}\n${message.content}\n\n`;
        }, '');

        return chatText.trim();
    };

    const downloadTxt = async () => {
        const chatText = await getChatAsText();

        let blob = new Blob([chatText], {
            type: 'text/plain'
        });

        saveAs(blob, `chat-${chatTitle}.txt`);
    };

    const downloadJSONExport = async () => {
        if (chatId) {
            let chatObj = null;

            if (chatId.startsWith('local') || $temporaryChatEnabled) {
                chatObj = { id: chatId, chat: { title: chatTitle, history } };
            } else {
                chatObj = await getChatById(localStorage.token, chatId);
            }

            let blob = new Blob([JSON.stringify([chatObj])], {
                type: 'application/json'
            });
            saveAs(blob, `chat-export-${Date.now()}.json`);
        }
    };
</script>

<Dropdown
    on:change={(e) => {
        if (e.detail === false) {
            onClose();
        }
    }}
>
    <slot />

    <div slot="content">
        <DropdownMenu.Content
            class="w-full max-w-[200px] rounded-2xl px-1 py-1  border border-gray-100  dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg transition"
            sideOffset={8}
            side="bottom"
            align="end"
            transition={flyAndScale}
        >
            <hr class="border-gray-50/30 dark:border-gray-800/30 my-1" />

            {#if !$temporaryChatEnabled}
                <DropdownMenu.Item
                    class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl select-none w-full"
                    id="chat-share-button"
                    on:click={() => {
                        shareHandler();
                    }}
                >
                    <Share strokeWidth="1.5" />
                    <div class="flex items-center">{'Share'}</div>
                </DropdownMenu.Item>
            {/if}

            <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger
                    class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl select-none w-full"
                >
                    <Download strokeWidth="1.5" />

                    <div class="flex items-center">{'Download'}</div>
                </DropdownMenu.SubTrigger>
                <DropdownMenu.SubContent
                    class="w-full rounded-2xl p-1 z-50 bg-white dark:bg-gray-850 dark:text-white border border-gray-100  dark:border-gray-800 shadow-lg max-h-52 overflow-y-auto scrollbar-hidden"
                    transition={flyAndScale}
                    sideOffset={8}
                >
                    <DropdownMenu.Item
                        class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl select-none w-full"
                        on:click={() => {
                            downloadJSONExport();
                        }}
                    >
                        <div class="flex items-center line-clamp-1">{'Export chat (.json)'}</div>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                        class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl select-none w-full"
                        on:click={() => {
                            downloadTxt();
                        }}
                    >
                        <div class="flex items-center line-clamp-1">{'Plain text (.txt)'}</div>
                    </DropdownMenu.Item>
                </DropdownMenu.SubContent>
            </DropdownMenu.Sub>

            <DropdownMenu.Item
                class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl select-none w-full"
                id="chat-copy-button"
                on:click={async () => {
                    const res = await copyToClipboard(await getChatAsText()).catch((e) => {
                        console.error(e);
                    });

                    if (res) {
                        toast.success('Copied to clipboard');
                    }
                }}
            >
                <Clipboard className=" size-4" strokeWidth="1.5" />
                <div class="flex items-center">{'Copy'}</div>
            </DropdownMenu.Item>

            {#if !$temporaryChatEnabled && chatId}
                <hr class="border-gray-50/30 dark:border-gray-800/30 my-1" />

                {#if $folders.length > 0}
                    <DropdownMenu.Sub>
                        <DropdownMenu.SubTrigger
                            class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl select-none w-full"
                        >
                            <Folder strokeWidth="1.5" />

                            <div class="flex items-center">{'Move'}</div>
                        </DropdownMenu.SubTrigger>
                        <DropdownMenu.SubContent
                            class="w-full rounded-2xl p-1 z-50 bg-white dark:bg-gray-850 dark:text-white border border-gray-100  dark:border-gray-800 shadow-lg max-h-52 overflow-y-auto scrollbar-hidden"
                            transition={flyAndScale}
                            sideOffset={8}
                        >
                            {#each $folders.sort((a, b) => b.updatedAt - a.updatedAt) as folder}
                                {#if folder?.id}
                                    <DropdownMenu.Item
                                        class="flex gap-2 items-center px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                                        on:click={() => {
                                            moveChatHandler(chatId, folder.id);
                                        }}
                                    >
                                        <Folder strokeWidth="1.5" />

                                        <div class="flex items-center">
                                            {folder.name ?? 'Folder'}
                                        </div>
                                    </DropdownMenu.Item>
                                {/if}
                            {/each}
                        </DropdownMenu.SubContent>
                    </DropdownMenu.Sub>
                {/if}

                <hr class="border-gray-50/30 dark:border-gray-800/30 my-1" />
            {/if}
        </DropdownMenu.Content>
    </div>
</Dropdown>
