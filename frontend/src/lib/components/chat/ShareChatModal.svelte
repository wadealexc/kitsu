<script lang="ts">
    import { toast } from 'svelte-sonner';
    import { deleteSharedChatById, getChatById, shareChatById } from '$lib/apis/chats';
    import type { Chat } from '@backend/routes/types';
    import { copyToClipboardLater } from '$lib/utils';

    import Modal from '../common/Modal.svelte';
    import Link from '../icons/Link.svelte';
    import XMark from '$lib/components/icons/XMark.svelte';

    export let chatId: string;

    let chat: Chat | null = null;
    let shareUrl = null;
    const shareLocalChat = async () => {
        const sharedChat = await shareChatById(localStorage.token, chatId);
        shareUrl = `${window.location.origin}/s/${sharedChat.shareId}`;
        console.log(shareUrl);
        chat = await getChatById(localStorage.token, chatId);

        return shareUrl;
    };

    const reportCopy = (copied: boolean) => {
        if (copied) {
            toast.success('Copied shared chat URL to clipboard!');
            show = false;
        } else {
            toast.error("Couldn't copy the link. Tap Copy Link again.");
        }
    };

    export let show = false;

    const isDifferentChat = (_chat: Chat | null) => {
        if (!chat) {
            return true;
        }
        if (!_chat) {
            return false;
        }
        return chat.id !== _chat.id || chat.shareId !== _chat.shareId;
    };

    $: if (show) {
        (async () => {
            if (chatId) {
                const _chat = await getChatById(localStorage.token, chatId);
                if (isDifferentChat(_chat)) {
                    chat = _chat;
                }
            } else {
                chat = null;
                console.log(chat);
            }
        })();
    }
</script>

<Modal bind:show size="md">
    <div>
        <div class=" flex justify-between dark:text-gray-300 px-5 pt-4 pb-0.5">
            <div class=" text-lg font-medium self-center">{'Share Chat'}</div>
            <button
                class="self-center"
                on:click={() => {
                    show = false;
                }}
            >
                <XMark className="size-5" />
            </button>
        </div>

        {#if chat}
            <div class="px-5 pt-4 pb-5 w-full flex flex-col justify-center">
                <div class=" text-sm dark:text-gray-300 mb-1">
                    {#if chat.shareId}
                        {'You have shared this chat before.'}
                    {:else}
                        {'Anyone with the link will be able to view this chat and all future messages.'}
                    {/if}
                </div>

                <div class="flex justify-end">
                    <div class="flex flex-col items-end space-x-1 mt-3">
                        <div class="flex gap-2">
                            {#if chat.shareId}
                                <button
                                    class="self-center px-3.5 py-2 text-sm font-medium border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition rounded-full"
                                    type="button"
                                    on:click={async () => {
                                        const res = await deleteSharedChatById(
                                            localStorage.token,
                                            chatId
                                        );
                                        if (res) {
                                            chat = await getChatById(localStorage.token, chatId);
                                        }
                                    }}
                                >
                                    {'Revoke Share Link'}
                                </button>

                                <button
                                    class="self-center flex items-center gap-1 px-3.5 py-2 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
                                    type="button"
                                    on:click={async () => {
                                        // No await before the copy: it must start during the tap
                                        const url = `${window.location.origin}/s/${chat?.shareId}`;
                                        reportCopy(await copyToClipboardLater(Promise.resolve(url)));
                                    }}
                                >
                                    <Link />
                                    {'Copy Link'}
                                </button>
                            {:else}
                                <button
                                    class="self-center flex items-center gap-1 px-3.5 py-2 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
                                    type="button"
                                    id="copy-and-share-chat-button"
                                    on:click={async () => {
                                        // Start sharing and the copy together, so the copy
                                        // happens during the tap (Safari requires it). If it's
                                        // refused, the chat is shared by now and the dialog
                                        // shows the plain Copy Link button for a second tap.
                                        const url = shareLocalChat();
                                        reportCopy(await copyToClipboardLater(url));
                                    }}
                                >
                                    <Link />
                                    {'Copy Link'}
                                </button>
                            {/if}
                        </div>
                    </div>
                </div>
            </div>
        {/if}
    </div>
</Modal>
