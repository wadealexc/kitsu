import { API_BASE_URL } from '$lib/constants';

export type ToolServerState = 'connected' | 'connecting' | 'error' | 'disabled';

/** An MCP server and its tools. Admins also get `url` and `hasToken`. */
export type ToolServer = {
    id: string;
    name: string;
    enabled: boolean;
    icon: string;
    state: ToolServerState;
    error?: string;
    tools: { name: string; title?: string; description: string }[];
    url?: string;
    hasToken?: boolean;
};

export type ToolServerForm = {
    name?: string;
    url?: string;
    /** Omit to keep the current token; null or '' removes it. */
    token?: string | null;
    enabled?: boolean;
    icon?: string;
};

const request = async <T>(token: string, method: string, route: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${API_BASE_URL}${route}`, {
        method,
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw err.detail ?? `Request failed: ${route}`;
    }

    return await res.json();
};

export const getToolServers = (token: string) =>
    request<ToolServer[]>(token, 'GET', '/mcp/servers');

export const createToolServer = (token: string, form: ToolServerForm & { name: string; url: string }) =>
    request<ToolServer>(token, 'POST', '/mcp/servers', form);

export const updateToolServer = (token: string, id: string, form: ToolServerForm) =>
    request<ToolServer>(token, 'POST', `/mcp/servers/${id}`, form);

export const refreshToolServer = (token: string, id: string) =>
    request<ToolServer>(token, 'POST', `/mcp/servers/${id}/refresh`);

export const deleteToolServer = (token: string, id: string) =>
    request<boolean>(token, 'DELETE', `/mcp/servers/${id}`);
