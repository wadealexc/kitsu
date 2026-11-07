import { get } from 'svelte/store';

import { getChatList } from '$lib/apis/chats';
import { chats, currentChatPage } from '$lib/stores';

/**
 * Reloads the sidebar's chat list after a change (rename, delete, save...),
 * keeping every page the user has scrolled through, not just the latest one.
 */
export const reloadChatList = async (token: string = localStorage.token): Promise<void> => {
    const pages = Math.max(1, get(currentChatPage));
    const lists = await Promise.all(
        Array.from({ length: pages }, (_, i) => getChatList(token, i + 1))
    );
    chats.set(lists.flat());
};
