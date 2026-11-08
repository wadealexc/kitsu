import { API_BASE_URL } from '$lib/constants';

export type SandboxEntry = {
    name: string;
    type: 'file' | 'dir' | 'link' | 'other';
    size: number;
    modified: number;
};

export type SandboxStatus = {
    exists: boolean;
    running: boolean;
    sizeBytes: number;
    limitBytes: number;
    overLimit: boolean;
};

const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
const url = (chatId: string, suffix: string, path?: string) =>
    `${API_BASE_URL}/sandbox/${chatId}${suffix}${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}`;

const failure = async (res: Response): Promise<string> => {
    const err = await res.json().catch(() => ({}));
    return err.detail ?? `The workspace request failed (${res.status})`;
};

export const getSandboxStatus = async (token: string, chatId: string): Promise<SandboxStatus> => {
    const res = await fetch(url(chatId, ''), { headers: headers(token) });
    if (!res.ok) throw await failure(res);
    return res.json();
};

export const listSandboxFiles = async (
    token: string,
    chatId: string,
    path: string
): Promise<{ entries: SandboxEntry[]; truncated: boolean }> => {
    const res = await fetch(url(chatId, '/files', path), { headers: headers(token) });
    if (!res.ok) throw await failure(res);
    return res.json();
};

export const fetchSandboxFile = async (token: string, chatId: string, path: string): Promise<Blob> => {
    const res = await fetch(url(chatId, '/file', path), { headers: headers(token) });
    if (!res.ok) throw await failure(res);
    return res.blob();
};

export const uploadSandboxFile = async (
    token: string,
    chatId: string,
    path: string,
    file: Blob
): Promise<void> => {
    const res = await fetch(url(chatId, '/file', path), {
        method: 'PUT',
        headers: { ...headers(token), 'Content-Type': 'application/octet-stream' },
        body: file
    });
    if (!res.ok) throw await failure(res);
};

export const deleteSandboxFile = async (token: string, chatId: string, path: string): Promise<void> => {
    const res = await fetch(url(chatId, '/file', path), { method: 'DELETE', headers: headers(token) });
    if (!res.ok) throw await failure(res);
};
