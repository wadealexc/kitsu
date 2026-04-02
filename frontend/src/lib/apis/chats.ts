import type {
    ChatObject,
    Chat,
    ChatTitleIdResponse,
    FolderChatListItemResponse
} from '@backend/routes/types';

export type ChatListItem = ChatTitleIdResponse & { timeRange: string };

import { API_BASE_URL } from '$lib/constants';
import { getTimeRange } from '$lib/utils';

export const createNewChat = async (
    token: string,
    chat: ChatObject,
    folderId?: string
): Promise<Chat> => {
    const route = '/chats/new';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chat, folderId: folderId ?? null })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const importChats = async (token: string, chats: object[]): Promise<Chat[]> => {
    const route = '/chats/import';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(chats)
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getChatList = async (
    token: string,
    page: number | null = null,
    includeFolders: boolean = false
): Promise<ChatListItem[]> => {
    const searchParams = new URLSearchParams();

    if (page !== null) {
        searchParams.append('page', `${page}`);
    }

    if (includeFolders) {
        searchParams.append('includeFolders', 'true');
    }

    const route = '/chats/';
    const res = await fetch(`${API_BASE_URL}${route}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    const json: ChatTitleIdResponse[] = await res.json();
    return json.map((chat) => ({
        ...chat,
        timeRange: getTimeRange(chat.updatedAt)
    }));
};

export const getAllChats = async (token: string): Promise<Chat[]> => {
    const route = '/chats/all';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

// `GET ${API_BASE_URL}/chats/search`
export const getChatListBySearchText = async (
    token: string,
    text: string,
    page: number = 1
): Promise<ChatListItem[]> => {
    console.error(`GET chats/search not implemented`);
    return [];
    // let error = null;

    // const searchParams = new URLSearchParams();
    // searchParams.append('text', text);
    // searchParams.append('page', `${page}`);

    // const res = await fetch(`${API_BASE_URL}/chats/search?${searchParams.toString()}`, {
    // 	method: 'GET',
    // 	headers: {
    // 		Accept: 'application/json',
    // 		'Content-Type': 'application/json',
    // 		...(token && { authorization: `Bearer ${token}` })
    // 	}
    // })
    // 	.then(async (res) => {
    // 		if (!res.ok) throw await res.json();
    // 		return res.json();
    // 	})
    // 	.then((json) => {
    // 		return json;
    // 	})
    // 	.catch((err) => {
    // 		error = err;
    // 		console.error(err);
    // 		return null;
    // 	});

    // if (error) {
    // 	throw error;
    // }

    // return res.map((chat) => ({
    // 	...chat,
    // 	time_range: getTimeRange(chat.updated_at)
    // }));
};

export const getChatsByFolderId = async (
    token: string,
    folderId: string
): Promise<Chat[]> => {
    const route = `/chats/folder/${folderId}`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getChatListByFolderId = async (
    token: string,
    folderId: string,
    page: number = 1
): Promise<FolderChatListItemResponse[]> => {
    const searchParams = new URLSearchParams();
    if (page !== null) {
        searchParams.append('page', `${page}`);
    }

    const route = `/chats/folder/${folderId}/list`;
    const res = await fetch(`${API_BASE_URL}${route}?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getChatById = async (token: string, id: string): Promise<Chat> => {
    const route = `/chats/${id}`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getChatByShareId = async (token: string, share_id: string): Promise<Chat> => {
    const route = `/chats/share/${share_id}`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const cloneChatById = async (
    token: string,
    id: string,
    title?: string
): Promise<Chat> => {
    const route = `/chats/${id}/clone`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...(title && { title }) })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const cloneSharedChatById = async (token: string, id: string): Promise<Chat> => {
    const route = `/chats/${id}/clone/shared`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const shareChatById = async (token: string, id: string): Promise<Chat> => {
    const route = `/chats/${id}/share`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const updateChatFolderIdById = async (
    token: string,
    id: string,
    folderId: string | null
): Promise<Chat> => {
    const route = `/chats/${id}/folder`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ folderId })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const deleteSharedChatById = async (token: string, id: string): Promise<boolean> => {
    const route = `/chats/${id}/share`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'DELETE',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const updateChatById = async (
    token: string,
    id: string,
    chat: Partial<ChatObject>
): Promise<Chat> => {
    const route = `/chats/${id}`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ chat })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const deleteChatById = async (token: string, id: string): Promise<boolean> => {
    const route = `/chats/${id}`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'DELETE',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const deleteAllChats = async (token: string): Promise<boolean> => {
    const route = '/chats/';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'DELETE',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        }
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};
