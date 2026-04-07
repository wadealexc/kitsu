<script lang="ts">
    import { toast } from 'svelte-sonner';
    import { onDestroy, onMount, tick } from 'svelte';
    import Modal from '$lib/components/common/Modal.svelte';
    import SearchInput from './SearchInput.svelte';
    import {
        getChatById,
        getChatList,
        getChatListBySearchText,
        type ChatListItem
    } from '$lib/apis/chats';
    import Spinner from '../common/Spinner.svelte';

    import dayjs from '$lib/dayjs';
    import localizedFormat from 'dayjs/plugin/localizedFormat';
    import calendar from 'dayjs/plugin/calendar';
    import Loader from '../common/Loader.svelte';
    import { createMessagesList } from '$lib/utils';
    import Messages from '../chat/Messages.svelte';
    import { goto } from '$app/navigation';
    import PencilSquare from '../icons/PencilSquare.svelte';
    import type { ChatHistory, ChatMessage, ChatObject } from '@backend/routes/types';
    dayjs.extend(calendar);
    dayjs.extend(localizedFormat);

    export let show = false;
    export let onClose = () => {};

    let actions = [
        {
            label: 'Start a new conversation',
            onClick: async () => {
                await goto(`/${query ? `?q=${query}` : ''}`);
                show = false;
                onClose();
            },
            icon: PencilSquare
        }
    ];

    let query = '';
    let page = 1;

    let chatList: ChatListItem[] = [];

    let chatListLoading = false;
    let allChatsLoaded = false;

    let searchDebounceTimeout: ReturnType<typeof setTimeout> | undefined;

    let selectedIdx: number = -1;
    let selectedChatId: string | null = null;
    let selectedChat: ChatObject | null = null;

    let history: ChatHistory | null = null;
    let messages: ChatMessage[] | null = null;

    $: if (!chatListLoading && chatList) {
        loadChatPreview(selectedIdx);
    }

    const loadChatPreview = async (selectedIdx: number) => {
        if (chatList.length === 0 || selectedIdx < 0) {
            selectedChatId = null;
            selectedChat = null;
            messages = null;
            history = null;
            return;
        }

        const selectedChatIdx = selectedIdx - actions.length;
        if (selectedChatIdx < 0 || selectedChatIdx >= chatList.length) {
            selectedChatId = null;
            selectedChat = null;
            messages = null;
            history = null;
            return;
        }

        const chatId = chatList[selectedChatIdx].id;
        const chat = await getChatById(localStorage.token, chatId).catch(async (error) => {
            return null;
        });

        if (chat) {
            selectedChatId = chatId;
            selectedChat = chat.chat;
            history = chat.chat.history;
            messages = createMessagesList(chat.chat.history, chat.chat.history.currentId);

            // scroll to the bottom of the messages container
            await tick();
            const messagesContainerElement = document.getElementById('chat-preview');
            if (messagesContainerElement) {
                messagesContainerElement.scrollTop = messagesContainerElement.scrollHeight;
            }
        } else {
            toast.error('Failed to load chat preview');
            selectedChatId = null;
            selectedChat = null;
            messages = null;
            history = null;
            return;
        }
    };

    const searchHandler = async () => {
        if (!show) {
            return;
        }

        if (searchDebounceTimeout) {
            clearTimeout(searchDebounceTimeout);
        }

        page = 1;
        chatList = [];
        if (query === '') {
            chatList = await getChatList(localStorage.token, page);
        } else {
            searchDebounceTimeout = setTimeout(async () => {
                chatList = await getChatListBySearchText(localStorage.token, query, page);

                if (chatList.length === 0) {
                    allChatsLoaded = true;
                } else {
                    allChatsLoaded = false;
                }
            }, 500);
        }

        selectedChat = null;
        messages = null;
        history = null;

        if (chatList.length === 0) {
            allChatsLoaded = true;
        } else {
            allChatsLoaded = false;
        }
    };

    const loadMoreChats = async () => {
        chatListLoading = true;
        page += 1;

        let newChatList: ChatListItem[] = [];

        if (query) {
            newChatList = await getChatListBySearchText(localStorage.token, query, page);
        } else {
            newChatList = await getChatList(localStorage.token, page);
        }

        // once the bottom of the list has been reached (no results) there is no need to continue querying
        allChatsLoaded = newChatList.length === 0;

        if (newChatList.length > 0) {
            chatList = [...chatList, ...newChatList];
        }

        chatListLoading = false;
    };

    $: if (show) {
        searchHandler();
    }

    const onKeyDown = (e: KeyboardEvent) => {
        const searchOptions = document.getElementById('search-options-container');
        if (searchOptions || !show) {
            return;
        }

        if (e.code === 'Escape') {
            show = false;
            onClose();
        } else if (e.code === 'Enter') {
            const item = document.querySelector(`[data-arrow-selected="true"]`);
            if (item) {
                (item as HTMLElement)?.click();
                show = false;
            }

            return;
        } else if (e.code === 'ArrowDown') {
            const searchInput = document.getElementById('search-input');

            if (searchInput) {
                // check if focused on the search input
                if (document.activeElement === searchInput) {
                    searchInput.blur();
                    selectedIdx = 0;
                    return;
                }
            }

            selectedIdx = Math.min(selectedIdx + 1, (chatList ?? []).length - 1 + actions.length);
        } else if (e.code === 'ArrowUp') {
            if (selectedIdx === 0) {
                const searchInput = document.getElementById('search-input');

                if (searchInput) {
                    // check if focused on the search input
                    if (document.activeElement !== searchInput) {
                        searchInput.focus();
                        selectedIdx = 0;
                        return;
                    }
                }
            }

            selectedIdx = Math.max(selectedIdx - 1, 0);
        }

        const item = document.querySelector(`[data-arrow-selected="true"]`);
        item?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    };

    onMount(() => {
        document.addEventListener('keydown', onKeyDown);
    });

    onDestroy(() => {
        if (searchDebounceTimeout) {
            clearTimeout(searchDebounceTimeout);
        }
        document.removeEventListener('keydown', onKeyDown);
    });
</script>

<Modal size="xl" bind:show>
    <div class="py-3 dark:text-gray-300 text-gray-700">
        <div class="px-4 pb-1.5">
            <SearchInput
                bind:value={query}
                on:input={searchHandler}
                placeholder="Search"
                showClearButton={true}
                onFocus={() => {
                    selectedIdx = -1;
                    messages = null;
                }}
                onKeydown={(e) => {
                    if (e.code === 'Enter' && (chatList ?? []).length > 0) {
                        const item = document.querySelector(`[data-arrow-selected="true"]`);
                        if (item) {
                            (item as HTMLElement)?.click();
                        }

                        show = false;
                        return;
                    } else if (e.code === 'ArrowDown') {
                        selectedIdx = Math.min(
                            selectedIdx + 1,
                            (chatList ?? []).length - 1 + actions.length
                        );
                    } else if (e.code === 'ArrowUp') {
                        selectedIdx = Math.max(selectedIdx - 1, 0);
                    } else {
                        selectedIdx = 0;
                    }

                    const item = document.querySelector(`[data-arrow-selected="true"]`);
                    item?.scrollIntoView({
                        block: 'center',
                        inline: 'nearest',
                        behavior: 'instant'
                    });
                }}
            />
        </div>

        <!-- <hr class="border-gray-50 dark:border-gray-850/30 my-1" /> -->

        <div class="flex px-4 pb-1">
            <div
                class="flex flex-col overflow-y-auto h-96 md:h-[40rem] max-h-full scrollbar-hidden w-full flex-1 pr-2"
            >
                <div class="w-full text-xs text-gray-500 dark:text-gray-500 font-medium pb-2 px-2">
                    {'Actions'}
                </div>

                {#each actions as action, idx (action.label)}
                    <button
                        class=" w-full flex items-center rounded-xl text-sm py-2 px-3 hover:bg-gray-50 dark:hover:bg-gray-850 {selectedIdx ===
                        idx
                            ? 'bg-gray-50 dark:bg-gray-850'
                            : ''}"
                        data-arrow-selected={selectedIdx === idx ? 'true' : undefined}
                        on:mouseenter={() => {
                            selectedIdx = idx;
                        }}
                        on:click={async () => {
                            await action.onClick();
                        }}
                    >
                        <div class="pr-2">
                            <svelte:component this={action.icon} />
                        </div>
                        <div class=" flex-1 text-left">
                            <div class="text-ellipsis line-clamp-1 w-full">
                                {action.label}
                            </div>
                        </div>
                    </button>
                {/each}

                {#if chatList}
                    <hr class="border-gray-50 dark:border-gray-850/30 my-3" />

                    {#if chatList.length === 0}
                        <div class="text-xs text-gray-500 dark:text-gray-400 text-center px-5 py-4">
                            {'No results found'}
                        </div>
                    {/if}

                    {#each chatList as chat, idx (chat.id)}
                        {#if idx === 0 || (idx > 0 && chat.timeRange !== chatList[idx - 1].timeRange)}
                            <div
                                class="w-full text-xs text-gray-500 dark:text-gray-500 font-medium {idx ===
                                0
                                    ? ''
                                    : 'pt-5'} pb-2 px-2"
                            >
                                {chat.timeRange}
                            </div>
                        {/if}

                        <a
                            class=" w-full flex justify-between items-center rounded-xl text-sm py-2 px-3 hover:bg-gray-50 dark:hover:bg-gray-850 {selectedIdx ===
                            idx + actions.length
                                ? 'bg-gray-50 dark:bg-gray-850'
                                : ''}"
                            href="/c/{chat.id}"
                            draggable="false"
                            data-arrow-selected={selectedIdx === idx + actions.length
                                ? 'true'
                                : undefined}
                            on:mouseenter={() => {
                                selectedIdx = idx + actions.length;
                            }}
                            on:click={async () => {
                                await goto(`/c/${chat.id}`);
                                show = false;
                                onClose();
                            }}
                        >
                            <div class=" flex-1">
                                <div class="text-ellipsis line-clamp-1 w-full">
                                    {chat?.title}
                                </div>
                            </div>

                            <div class=" pl-3 shrink-0 text-gray-500 dark:text-gray-400 text-xs">
                                {dayjs(chat?.updatedAt * 1000).calendar(null, {
                                    sameDay: '[Today]',
                                    nextDay: '[Tomorrow]',
                                    nextWeek: 'dddd',
                                    lastDay: '[Yesterday]',
                                    lastWeek: '[Last] dddd',
                                    sameElse: 'L' // use localized format, otherwise dayjs.calendar() defaults to DD/MM/YYYY
                                })}
                            </div>
                        </a>
                    {/each}

                    {#if !allChatsLoaded}
                        <Loader
                            on:visible={(e) => {
                                if (!chatListLoading) {
                                    loadMoreChats();
                                }
                            }}
                        >
                            <div
                                class="w-full flex justify-center py-4 text-xs animate-pulse items-center gap-2"
                            >
                                <Spinner className=" size-4" />
                                <div class=" ">{'Loading...'}</div>
                            </div>
                        </Loader>
                    {/if}
                {:else}
                    <div class="w-full h-full flex justify-center items-center">
                        <Spinner className="size-5" />
                    </div>
                {/if}
            </div>
            <div
                id="chat-preview"
                class="hidden md:flex md:flex-1 w-full overflow-y-auto h-96 md:h-[40rem] scrollbar-hidden"
            >
                {#if messages === null || history === null}
                    <div
                        class="w-full h-full flex justify-center items-center text-gray-500 dark:text-gray-400 text-sm"
                    >
                        {'Select a conversation to preview'}
                    </div>
                {:else}
                    <div class="w-full h-full flex flex-col">
                        <Messages
                            className="h-full flex pt-4 pb-8 w-full"
                            chatId={`chat-preview-${selectedChatId ?? ''}`}
                            readOnly={true}
                            bind:history
                            sendMessage={async (_userMessageId) => {}}
                            regenerateResponse={() => {}}
                        />
                    </div>
                {/if}
            </div>
        </div>
    </div>
</Modal>
