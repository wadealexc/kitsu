<script lang="ts">
    import { mobile, settings, showSidebar, temporaryChatEnabled, user } from '$lib/stores';

    import { goto } from '$app/navigation';

    import ShareChatModal from './chat/ShareChatModal.svelte';
    import ModelSelector from './chat/ModelSelector.svelte';
    import Tooltip from './common/Tooltip.svelte';
    import Menu from '$lib/components/navbar/Menu.svelte';
    import UserMenu from '$lib/components/navbar/UserMenu.svelte';

    import Sidebar from './icons/Sidebar.svelte';
    import type { ChatHistory } from '@backend/routes/types';

    import ChatBubbleDotted from './icons/ChatBubbleDotted.svelte';
    import ChatBubbleDottedChecked from './icons/ChatBubbleDottedChecked.svelte';

    import EllipsisHorizontal from './icons/EllipsisHorizontal.svelte';
    import ChatCheck from './icons/ChatCheck.svelte';
    import Settings from './icons/Settings.svelte';

    export let shareEnabled: boolean = false;

    export let chatId: string;
    export let chatTitle: string;
    export let history: ChatHistory;

    export let onSaveTempChat: () => {};
    export let moveChatHandler: (id: string, folderId: string) => void;

    let showShareChatModal = false;
</script>

<ShareChatModal bind:show={showShareChatModal} {chatId} />

<nav
    class="sticky top-0 z-30 shrink-0 w-full {chatId
        ? 'pt-0.5 pb-1'
        : 'pt-1 pb-1'} flex flex-col items-center bg-white dark:bg-gray-850/80 shadow-sm dark:shadow-md dark:shadow-black/20"
>
    <div class="flex items-center w-full pl-1.5 pr-1">
        <div class=" flex max-w-full w-full mx-auto px-1.5 md:px-2 pt-0.5 bg-transparent">
            <div class="flex items-center w-full max-w-full">
                {#if $mobile && !$showSidebar}
                    <div
                        class="-translate-x-0.5 mr-1 mt-1 self-start flex flex-none items-center text-gray-600 dark:text-gray-400"
                    >
                        <Tooltip content={$showSidebar ? 'Close Sidebar' : 'Open Sidebar'}>
                            <button
                                class=" cursor-pointer flex rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition"
                                on:click={() => {
                                    showSidebar.set(!$showSidebar);
                                }}
                            >
                                <div class=" self-center p-1.5">
                                    <Sidebar />
                                </div>
                            </button>
                        </Tooltip>
                    </div>
                {/if}

                <div class="flex-1 overflow-hidden max-w-full py-0.5 {$showSidebar ? 'ml-1' : ''}">
                    <ModelSelector />
                </div>

                <div
                    class="self-start flex flex-none items-center text-gray-600 dark:text-gray-400"
                >
                    {#if !chatId}
                        <Tooltip content={`Temporary Chat`}>
                            <button
                                class="flex cursor-pointer px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-850 transition"
                                id="temporary-chat-button"
                                on:click={async () => {
                                    if ($settings.temporaryChatByDefault && $temporaryChatEnabled) {
                                        // for proper initNewChat handling
                                        await temporaryChatEnabled.set(null);
                                    } else {
                                        await temporaryChatEnabled.set(!$temporaryChatEnabled);
                                    }

                                    await goto('/');

                                    // add 'temporary-chat=true' to the URL
                                    if ($temporaryChatEnabled) {
                                        window.history.replaceState(
                                            null,
                                            '',
                                            '?temporary-chat=true'
                                        );
                                    } else {
                                        window.history.replaceState(null, '', location.pathname);
                                    }
                                }}
                            >
                                <div class=" m-auto self-center">
                                    {#if $temporaryChatEnabled}
                                        <ChatBubbleDottedChecked
                                            className=" size-4.5"
                                            strokeWidth="1.5"
                                        />
                                    {:else}
                                        <ChatBubbleDotted className=" size-4.5" strokeWidth="1.5" />
                                    {/if}
                                </div>
                            </button>
                        </Tooltip>
                    {:else if $temporaryChatEnabled}
                        <Tooltip content={`Save Chat`}>
                            <button
                                class="flex cursor-pointer px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-850 transition"
                                id="save-temporary-chat-button"
                                on:click={async () => {
                                    onSaveTempChat();
                                }}
                            >
                                <div class=" m-auto self-center">
                                    <ChatCheck className=" size-4.5" strokeWidth="1.5" />
                                </div>
                            </button>
                        </Tooltip>
                    {/if}

                    {#if shareEnabled && (chatId || $temporaryChatEnabled)}
                        <Menu
                            {chatId}
                            {chatTitle}
                            {history}
                            shareHandler={() => {
                                showShareChatModal = !showShareChatModal;
                            }}
                            {moveChatHandler}
                        >
                            <button
                                class="flex cursor-pointer px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-850 transition"
                                id="chat-context-menu-button"
                            >
                                <div class=" m-auto self-center">
                                    <EllipsisHorizontal className=" size-5" strokeWidth="1.5" />
                                </div>
                            </button>
                        </Menu>
                    {/if}

                    {#if $user !== undefined && $user !== null}
                        <UserMenu className="max-w-[240px]">
                            <div
                                class="select-none flex rounded-xl p-1.5 w-full hover:bg-gray-50 dark:hover:bg-gray-850 transition"
                            >
                                <div class=" self-center">
                                    <span class="sr-only">{'User menu'}</span>
                                    <Settings className="size-5" strokeWidth="1.5" />
                                </div>
                            </div>
                        </UserMenu>
                    {/if}
                </div>
            </div>
        </div>
    </div>

    {#if $temporaryChatEnabled && chatId.startsWith('local:')}
        <div class=" w-full z-30 text-center">
            <div class="text-xs text-gray-500">{'Temporary Chat'}</div>
        </div>
    {/if}
</nav>
