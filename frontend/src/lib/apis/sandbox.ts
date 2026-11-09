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
    return err.detail ?? `The file request failed (${res.status})`;
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

/** `report.pdf`, or `report (1).pdf` if that's taken. */
const freeName = (name: string, taken: Set<string>): string => {
    if (!taken.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const [base, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    for (let n = 1; ; n++) {
        const candidate = `${base} (${n})${extension}`;
        if (!taken.has(candidate)) return candidate;
    }
};

/** Adds files to a folder without replacing what's there. Paths added and errors come back. */
export const addSandboxFiles = async (
    token: string,
    chatId: string,
    folder: string,
    files: File[]
): Promise<{ added: string[]; errors: string[] }> => {
    const { entries } = await listSandboxFiles(token, chatId, folder).catch(() => ({ entries: [] as SandboxEntry[] }));
    const taken = new Set(entries.map((e) => e.name));
    const added: string[] = [];
    const errors: string[] = [];
    await Promise.all(
        files.map(async (file) => {
            const name = freeName(file.name, taken);
            taken.add(name);
            const target = folder === '.' ? name : `${folder}/${name}`;
            try {
                await uploadSandboxFile(token, chatId, target, file);
                added.push(target);
            } catch (err) {
                errors.push(`${file.name}: ${err}`);
            }
        })
    );
    return { added, errors };
};

export const deleteSandboxFile = async (token: string, chatId: string, path: string): Promise<void> => {
    const res = await fetch(url(chatId, '/file', path), { method: 'DELETE', headers: headers(token) });
    if (!res.ok) throw await failure(res);
};
