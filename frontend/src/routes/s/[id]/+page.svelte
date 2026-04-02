<script lang="ts">
    import { tick } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';

    import dayjs from 'dayjs';

    import type {
        ChatResponse,
        ChatHistory,
        ChatMessage
    } from '@backend/routes/types.js';

    import { settings, applySettingsDefaults, chatId, APP_NAME, models } from '$lib/stores';
    import { createMessagesList } from '$lib/utils';

    import { getChatByShareId, cloneSharedChatById } from '$lib/apis/chats';

    import Messages from '$lib/components/chat/Messages.svelte';

    import { getUserSettings } from '$lib/apis/users';
    import { getModels } from '$lib/apis/models';
    import { toast } from 'svelte-sonner';
    import localizedFormat from 'dayjs/plugin/localizedFormat';

    dayjs.extend(localizedFormat);

    let loaded = false;

    let chat: ChatResponse | null = null;
    let title = '';
    let selectedModel: string = '';

    let messages: ChatMessage[] = [];
    let history: ChatHistory = {
        messages: {},
        currentId: null
    };

    $: messages = createMessagesList(history, history.currentId);

    $: if ($page.params.id) {
        (async (_chatId: string) => {
            if (await loadSharedChat(_chatId)) {
                await tick();
                loaded = true;
            } else {
                await goto('/');
            }
        })($page.params.id);
    }

    const loadSharedChat = async (_chatId: string) => {
        let userSettings = await getUserSettings(localStorage.token).catch((error) => {
            console.error(error);
            return null;
        });

        if (!userSettings) {
            let localStorageSettings: Record<string, any> = {};

            try {
                localStorageSettings = JSON.parse(localStorage.getItem('settings') ?? '{}');
            } catch (e: unknown) {
                console.error('Failed to parse settings from localStorage', e);
            }

            userSettings = { ui: localStorageSettings };
        }

        settings.set(applySettingsDefaults(userSettings.ui));
        models.set(await getModels(localStorage.token));
        chatId.set(_chatId);

        chat = await getChatByShareId(localStorage.token, $chatId).catch(async (error) => {
            console.error(`loadSharedChat: error fetching chat ${$chatId}: ${error}`);
            await goto('/');
            return null;
        });

        if (!chat) return;

        const chatContent = chat.chat;

        selectedModel = chatContent.model;
        history = chatContent.history;
        title = chatContent.title;

        let lastMessageId = messages.at(-1)?.id;
        if (lastMessageId && lastMessageId in history.messages) {
            history.messages[lastMessageId].done = true;
        }

        await tick();
        return true;
    };

    const cloneSharedChat = async () => {
        if (!chat) return;
        if (!$page.params.id) return;

        const res = await cloneSharedChatById(localStorage.token, $page.params.id).catch(
            (error) => {
                toast.error(`${error}`);
                return null;
            }
        );

        if (res) {
            goto(`/c/${res.id}`);
        }
    };
</script>

<svelte:head>
    <title>
        {title
            ? `${title.length > 30 ? `${title.slice(0, 30)}...` : title} • ${$APP_NAME}`
            : `${$APP_NAME}`}
    </title>
</svelte:head>

{#if loaded}
    <div
        class="h-screen max-h-[100dvh] w-full flex flex-col text-gray-700 dark:text-gray-100 bg-white dark:bg-gray-900"
    >
        <div class="flex flex-col flex-auto justify-center relative">
            <div class=" flex flex-col w-full flex-auto overflow-auto h-0" id="messages-container">
                <div class="pt-5 px-2 w-full max-w-5xl mx-auto">
                    <div class="px-3">
                        <div class=" text-2xl font-medium line-clamp-1">
                            {title}
                        </div>

                        <div class="flex text-sm justify-between items-center mt-1">
                            <div class="text-gray-400">
                                {dayjs(chat?.chat.timestamp).format('LLL')}
                            </div>
                        </div>
                    </div>
                </div>

                <div class=" h-full w-full flex flex-col py-2">
                    <div class="w-full">
                        <Messages
                            className="h-full flex pt-4 pb-8 "
                            chatId={$chatId}
                            readOnly={true}
                            bind:history
                            sendMessage={async (_userMessage) => {}}
                            regenerateResponse={() => {}}
                        />
                    </div>
                </div>
            </div>

            <div
                class="absolute bottom-0 right-0 left-0 flex justify-center w-full bg-linear-to-b from-transparent to-white dark:to-gray-900"
            >
                <div class="pb-5">
                    <button
                        class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
                        on:click={cloneSharedChat}
                    >
                        {'Clone Chat'}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
