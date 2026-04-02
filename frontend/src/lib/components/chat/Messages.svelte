<script lang="ts">
    import {
        chats,
        settings,
        user as _user,
        currentChatPage,
        temporaryChatEnabled,
        selectedModel
    } from '$lib/stores';
    import { tick } from 'svelte';
    import { toast } from 'svelte-sonner';
    import { getChatList, updateChatById } from '$lib/apis/chats';
    import { appendMessage, navigateToLeaf, getRootMessageIds, getSiblingIds } from '$lib/utils';

    import UserMessage from './Messages/UserMessage.svelte';
    import ResponseMessage from './Messages/ResponseMessage.svelte';
    import Loader from '../common/Loader.svelte';
    import Spinner from '../common/Spinner.svelte';

    import type { ChatHistory, ChatMessage, ChatMessageFile } from '@backend/routes/types';
    import type { WebSearchProgress } from '$lib/apis/streaming';

    export let className = 'h-full flex pt-8';

    export let chatId = '';

    export let history: ChatHistory;
    let messages: ChatMessage[] = [];

    export let sendMessage: (userMessageId: ChatMessage) => Promise<void>;
    export let regenerateResponse: (message: ChatMessage) => void | Promise<void>;

    export let toolProgress: Map<string, WebSearchProgress> | undefined = undefined;
    export let modelStatus: { status: 'queued' | 'loading'; modelName: string } | undefined =
        undefined;

    export let readOnly = false;
    export let bottomPadding = false;
    export let onBranchScroll: () => void = () => {};

    let messagesCount: number = 20;
    let messagesLoading = false;

    const loadMoreMessages = async () => {
        // scroll slightly down to disable continuous loading
        const element = document.getElementById('messages-container');
        if (!element) return;
        element.scrollTop = element.scrollTop + 100;

        messagesLoading = true;
        messagesCount += 20;

        await tick();

        messagesLoading = false;
    };

    let pendingRebuild: number | null = null;
    let lastCurrentId: string | null = null;

    const buildMessages = () => {
        let _messages = [];

        if (!history.currentId) return;

        let message: ChatMessage | null = history.messages[history.currentId];
        const visitedMessageIds = new Set();

        while (message && _messages.length <= messagesCount) {
            if (visitedMessageIds.has(message.id)) {
                console.warn('Circular dependency detected in message history', message.id);
                break;
            }
            visitedMessageIds.add(message.id);

            _messages.unshift(message);
            message = message.parentId !== null ? history.messages[message.parentId] : null;
        }

        messages = _messages;
    };

    // Throttle message list rebuilds to once per animation frame during streaming.
    // Structural changes (currentId change) always rebuild immediately.
    $: if (history.currentId) {
        const currentIdChanged = history.currentId !== lastCurrentId;
        lastCurrentId = history.currentId;

        if (currentIdChanged) {
            // Structural change: new chat, navigation, new message — rebuild immediately
            if (pendingRebuild) cancelAnimationFrame(pendingRebuild);
            pendingRebuild = null;
            buildMessages();
        } else if (history.messages) {
            // Content update (streaming) — throttle to once per frame
            if (!pendingRebuild) {
                pendingRebuild = requestAnimationFrame(() => {
                    pendingRebuild = null;
                    buildMessages();
                });
            }
        }
    } else {
        messages = [];
    }

    const updateChat = async () => {
        if (!$temporaryChatEnabled) {
            history = history;
            await tick();
            await updateChatById(localStorage.token, chatId, {
                history: history
            });

            currentChatPage.set(1);
            chats.set(await getChatList(localStorage.token, $currentChatPage));
        }
    };

    /**
     * Safely navigate to a message's sibling, if it exists
     */
    const goToSibling = async (message: ChatMessage, idx: number) => {
        // Get message id of sibling
        const siblings = getSiblingIds(history, message);
        const targetMessageId = siblings[Math.max(0, Math.min(idx, siblings.length - 1))];

        // If we're actually navigating to a different message, update currentId
        // to the final leaf of the new chat tree
        if (message.id !== targetMessageId) {
            history.currentId = navigateToLeaf(history, targetMessageId);
        }

        await tick();

        if ($settings.scrollOnBranchChange) {
            onBranchScroll();
        }

        // Persist navigation
        await updateChat();
    };

    type Edit = {
        content: string;
        files: ChatMessageFile[];
    };

    const editMessage = async (messageId: string, { content, files }: Edit, submit = true) => {
        if (!$selectedModel) {
            toast.error('Model not selected');
            return;
        }
        if (history.messages[messageId].role === 'user') {
            if (submit) {
                // New user message
                const userMessage = appendMessage(history, {
                    parentId: history.messages[messageId].parentId,
                    role: 'user',
                    content: content,
                    ...(files && { files: files }),
                    done: false,
                    model: $selectedModel.id
                });

                await tick();
                await sendMessage(userMessage);
            } else {
                // Edit user message
                history.messages[messageId].content = content;
                history.messages[messageId].files = files;
                await updateChat();
            }
        } else {
            if (submit) {
                // New response message (sibling branch from the original)
                const message = history.messages[messageId];
                appendMessage(history, {
                    ...message,
                    parentId: message.parentId,
                    content: content,
                    files: []
                });

                await updateChat();
            } else {
                // Edit response message
                history.messages[messageId].content = content;
                await updateChat();
            }
        }
    };

    const deleteMessage = async (messageId: string) => {
        const messageToDelete = history.messages[messageId];
        const parentMessageId = messageToDelete.parentId;
        const childMessageIds = messageToDelete.childrenIds;

        // Collect all grandchildren
        const grandchildrenIds = childMessageIds.flatMap(
            (childId) => history.messages[childId]?.childrenIds ?? []
        );

        // Update parent's children
        if (parentMessageId && history.messages[parentMessageId]) {
            history.messages[parentMessageId].childrenIds = [
                ...history.messages[parentMessageId].childrenIds.filter((id) => id !== messageId),
                ...grandchildrenIds
            ];
        }

        // Update grandchildren's parent
        grandchildrenIds.forEach((grandchildId) => {
            if (history.messages[grandchildId]) {
                history.messages[grandchildId].parentId = parentMessageId;
            }
        });

        // Delete the message and its children
        [messageId, ...childMessageIds].forEach((id) => {
            delete history.messages[id];
        });

        if (parentMessageId) {
            history.currentId = navigateToLeaf(history, parentMessageId);
        }

        await tick();

        if ($settings.scrollOnBranchChange) {
            onBranchScroll();
        }

        // Update the chat
        await updateChat();
    };
</script>

<div class={className}>
    <div class="w-full pt-2">
        {#key chatId}
            <section class="w-full" aria-labelledby="chat-conversation">
                <h2 class="sr-only" id="chat-conversation">{'Chat Conversation'}</h2>
                {#if messages.at(0)?.parentId != null}
                    <Loader
                        on:visible={(e) => {
                            if (!messagesLoading) {
                                loadMoreMessages();
                            }
                        }}
                    >
                        <div
                            class="w-full flex justify-center py-1 text-xs animate-pulse items-center gap-2"
                        >
                            <Spinner className=" size-4" />
                            <div class=" ">{'Loading...'}</div>
                        </div>
                    </Loader>
                {/if}
                <ul role="log" aria-live="polite" aria-relevant="additions" aria-atomic="false">
                    {#each messages as message, messageIdx (message.id)}
                        <div
                            role="listitem"
                            class="flex flex-col justify-between px-5 mb-3 w-full max-w-5xl mx-auto rounded-lg group"
                        >
                            {#if history.messages[message.id]}
                                {#if history.messages[message.id].role === 'user'}
                                    <UserMessage
                                        {chatId}
                                        {history}
                                        messageId={message.id}
                                        isFirstMessage={messageIdx === 0}
                                        siblings={getSiblingIds(history, message)}
                                        {goToSibling}
                                        {editMessage}
                                        {deleteMessage}
                                        {readOnly}
                                    />
                                {:else}
                                    <ResponseMessage
                                        {chatId}
                                        {history}
                                        messageId={message.id}
                                        isLastMessage={message.id === history.currentId}
                                        siblings={getSiblingIds(history, message)}
                                        {goToSibling}
                                        {updateChat}
                                        {editMessage}
                                        {deleteMessage}
                                        {regenerateResponse}
                                        {toolProgress}
                                        {modelStatus}
                                        {readOnly}
                                    />
                                {/if}
                            {/if}
                        </div>
                    {/each}
                </ul>
            </section>
            <div class="pb-18"></div>
            {#if bottomPadding}
                <div class="  pb-6"></div>
            {/if}
        {/key}
    </div>
</div>
