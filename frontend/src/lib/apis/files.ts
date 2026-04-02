import { API_BASE_URL } from '$lib/constants';
import type { FileModelResponse } from '@backend/routes/types.js';

export const uploadFile = async (token: string, file: File): Promise<FileModelResponse> => {
    const data = new FormData();
    data.append('file', file);

    let error = null;

    const res = await fetch(`${API_BASE_URL}/files/`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            authorization: `Bearer ${token}`
        },
        body: data
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .catch((err) => {
            error = err.detail || err.message;
            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const getFileById = async (token: string, id: string): Promise<FileModelResponse> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/files/${id}`, {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            authorization: `Bearer ${token}`
        }
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return res.json();
        })
        .then((json) => {
            return json;
        })
        .catch((err) => {
            error = err.detail;
            console.error(err);
            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};

export const extractFileContent = async (token: string, file: File): Promise<string> => {
    const data = new FormData();
    data.append('file', file);

    const res = await fetch(`${API_BASE_URL}/files/extract`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            authorization: `Bearer ${token}`
        },
        body: data
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail || 'Failed to extract file content';
    }

    const json = await res.json();
    return json.content;
};

export const getFileContentById = async (id: string): Promise<ArrayBuffer | null> => {
    let error = null;

    const res = await fetch(`${API_BASE_URL}/files/${id}/content`, {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        },
        credentials: 'include'
    })
        .then(async (res) => {
            if (!res.ok) throw await res.json();
            return await res.arrayBuffer();
        })
        .catch((err) => {
            error = err.detail;
            console.error(err);

            return null;
        });

    if (error) {
        throw error;
    }

    return res;
};
