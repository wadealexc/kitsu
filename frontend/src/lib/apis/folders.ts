import { API_BASE_URL } from '$lib/constants';
import type {
    FolderModel,
    FolderNameIdResponse,
    FolderForm,
    FolderUpdateForm
} from '@backend/routes/types.js';

export const createNewFolder = async (
    token: string,
    folderForm: FolderForm
): Promise<FolderModel> => {
    const route = '/folders/';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(folderForm)
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getFolders = async (token: string): Promise<FolderNameIdResponse[]> => {
    const route = '/folders/';
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

export const getFolderById = async (token: string, id: string): Promise<FolderModel> => {
    const route = `/folders/${id}`;
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

export const updateFolderById = async (
    token: string,
    id: string,
    folderForm: FolderUpdateForm
): Promise<FolderModel> => {
    const route = `/folders/${id}/update`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(folderForm)
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const updateFolderIsExpandedById = async (
    token: string,
    id: string,
    isExpanded: boolean
): Promise<FolderModel> => {
    const route = `/folders/${id}/update/expanded`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isExpanded })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const updateFolderParentIdById = async (
    token: string,
    id: string,
    parentId: string | null
): Promise<FolderModel> => {
    const route = `/folders/${id}/update/parent`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ parentId })
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const deleteFolderById = async (
    token: string,
    id: string,
    deleteContents: boolean
): Promise<boolean> => {
    const searchParams = new URLSearchParams();
    searchParams.append('deleteContents', deleteContents ? 'true' : 'false');

    const route = `/folders/${id}`;
    const res = await fetch(`${API_BASE_URL}${route}?${searchParams.toString()}`, {
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
