import { API_BASE_URL } from '$lib/constants';
import type { FileModelResponse } from '@backend/routes/types';

export const uploadFile = async (token: string, file: File): Promise<FileModelResponse> => {
    const route = '/files/';
    const data = new FormData();
    data.append('file', file);

    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: data
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getFileById = async (token: string, id: string): Promise<FileModelResponse> => {
    const route = `/files/${id}`;
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

export const extractFileContent = async (token: string, file: File): Promise<string> => {
    const route = '/files/extract';
    const data = new FormData();
    data.append('file', file);

    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: data
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    const json = await res.json();
    return json.content;
};

export const getFileContentById = async (id: string): Promise<ArrayBuffer> => {
    const route = `/files/${id}/content`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
        },
        credentials: 'include'
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.arrayBuffer();
};
