import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool as McpToolDefinition } from '@modelcontextprotocol/sdk/types.js';

import type { McpServer } from '../db/index.js';

/**
 * Connects to the MCP servers an admin has added and offers their tools to chats.
 *
 * The tool list is kept stable, because it sits at the start of every prompt and any
 * change to it makes the model process the whole conversation again. A server that
 * goes away keeps its last known tools; calls to them fail until it comes back.
 */

/** How long a tool call may go without progress before it's given up on. */
const CALL_TIMEOUT_MS = 120_000;
/** How often to try a server that couldn't be reached. */
const RETRY_MS = 60_000;

export type McpTool = {
    /** Name the model calls it by: the server's own name, unless two servers clash. */
    name: string;
    serverId: string;
    serverName: string;
    toolName: string;
    title?: string;
    description: string;
    inputSchema: Record<string, unknown>;
    /** From a sandbox server: off by default, and offered to a chat only once it's turned on there. */
    sandbox: boolean;
};

/** The chat and user a sandbox call belongs to. Set by kitsu, so the model can't choose them. */
export type SandboxIdentity = { chat: string; user: string };

/** The capability a server announces to be treated as a sandbox, and the `_meta` key it reads the identity from. */
const SANDBOX_KEY = 'kitsu/sandbox';

export type McpServerState = 'connected' | 'connecting' | 'error' | 'disabled';

export type McpServerStatus = {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    icon: string;
    condensed: boolean;
    sandbox: boolean;
    hasToken: boolean;
    state: McpServerState;
    error?: string;
    tools: { name: string; title?: string; description: string }[];
};

/** Progress as a tool reports it. `page` is si-web-extract's per-page status, if sent. */
export type McpProgress = {
    message?: string;
    progress: number;
    total?: number;
    page?: { url: string; status: string; outcome?: string };
    /** The latest output of a command still running. */
    output?: string;
};

export type ToolImage = { mimeType: string; data: string };

export type McpCallResult = {
    ok: boolean;
    /** What the model reads. */
    text: string;
    /** Machine-readable result, for the frontend. */
    structured?: Record<string, unknown>;
    /** Images for the model to look at. */
    images?: ToolImage[];
};

/** Opens a client for one server. Replaced in tests. */
export type Connector = (server: McpServer) => Promise<Client>;

export const httpConnector: Connector = async (server) => {
    const client = new Client({ name: 'kitsu', version: '1.0.0' });
    const headers: Record<string, string> = server.token ? { authorization: `Bearer ${server.token}` } : {};
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
    return client;
};

type Connection = {
    server: McpServer;
    client?: Client;
    state: McpServerState;
    error?: string;
    tools: McpToolDefinition[];
    sandbox?: boolean;
    connecting?: Promise<void>;
};

export class McpManager {

    private connections = new Map<string, Connection>();
    private retryTimer: NodeJS.Timeout | undefined;

    constructor(private connector: Connector = httpConnector) { }

    /**
     * Brings connections in line with the given server records: connects new or
     * changed ones and closes removed or disabled ones. Resolves once each has
     * connected or failed.
     */
    async sync(servers: McpServer[]): Promise<void> {
        const wanted = new Map(servers.map(s => [s.id, s]));

        for (const [id, conn] of this.connections) {
            if (!wanted.has(id)) {
                await this.#close(conn);
                this.connections.delete(id);
            }
        }

        const pending: Promise<void>[] = [];
        for (const server of servers) {
            const existing = this.connections.get(server.id);
            const changed = !existing
                || existing.server.url !== server.url
                || existing.server.token !== server.token
                || existing.server.enabled !== server.enabled;

            if (existing && !changed) {
                existing.server = server; // e.g. a rename
                continue;
            }

            if (existing) await this.#close(existing);
            const conn: Connection = existing && existing.server.url === server.url
                ? { ...existing, server, client: undefined }
                : { server, state: 'connecting', tools: [] };
            this.connections.set(server.id, conn);

            if (!server.enabled) {
                conn.state = 'disabled';
                continue;
            }
            pending.push(this.#connect(conn));
        }

        await Promise.all(pending);
        this.#scheduleRetry();
    }

    /** Reconnects one server and reloads its tools. */
    async refresh(serverId: string): Promise<void> {
        const conn = this.connections.get(serverId);
        if (!conn || !conn.server.enabled) return;
        await this.#close(conn);
        await this.#connect(conn);
    }

    /** Every tool of every enabled server, in a stable order. */
    tools(): McpTool[] {
        const conns = [...this.connections.values()]
            .filter(c => c.server.enabled)
            .sort((a, b) => a.server.createdAt - b.server.createdAt || a.server.name.localeCompare(b.server.name));

        const counts = new Map<string, number>();
        for (const c of conns) for (const t of c.tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);

        return conns.flatMap(c => c.tools.map(t => ({
            name: (counts.get(t.name) ?? 0) > 1 ? `${slug(c.server.name)}_${t.name}` : t.name,
            serverId: c.server.id,
            serverName: c.server.name,
            toolName: t.name,
            ...(t.title ? { title: t.title } : {}),
            description: t.description ?? '',
            inputSchema: t.inputSchema as Record<string, unknown>,
            sandbox: c.sandbox === true,
        })));
    }

    status(): McpServerStatus[] {
        return [...this.connections.values()]
            .sort((a, b) => a.server.createdAt - b.server.createdAt || a.server.name.localeCompare(b.server.name))
            .map(c => ({
                id: c.server.id,
                name: c.server.name,
                url: c.server.url,
                enabled: c.server.enabled,
                icon: c.server.icon,
                condensed: c.server.condensed,
                sandbox: c.sandbox === true,
                hasToken: !!c.server.token,
                state: c.state,
                ...(c.error ? { error: c.error } : {}),
                tools: c.tools.map(t => ({ name: t.name, ...(t.title ? { title: t.title } : {}), description: t.description ?? '' })),
            }));
    }

    /** The enabled sandbox server, if there is one. */
    sandboxServer(): McpServer | null {
        return [...this.connections.values()].find(c => c.server.enabled && c.sandbox)?.server ?? null;
    }

    async call(tool: McpTool, args: unknown, opts: { signal: AbortSignal; onProgress?: (p: McpProgress) => void; identity?: SandboxIdentity | undefined }): Promise<McpCallResult> {
        const conn = this.connections.get(tool.serverId);
        if (!conn || !conn.server.enabled) return { ok: false, text: `The ${tool.serverName} tools are not available.` };

        const attempt = async (): Promise<McpCallResult> => {
            if (!conn.client) await this.#connect(conn);
            if (!conn.client) throw new Error(conn.error ?? 'not connected');

            const result = await conn.client.callTool(
                {
                    name: tool.toolName,
                    arguments: (args ?? {}) as Record<string, unknown>,
                    ...(conn.sandbox && opts.identity ? { _meta: { [SANDBOX_KEY]: opts.identity } } : {}),
                },
                undefined,
                {
                    signal: opts.signal,
                    timeout: CALL_TIMEOUT_MS,
                    resetTimeoutOnProgress: true,
                    onprogress: (p) => opts.onProgress?.(toProgress(p as unknown as Record<string, unknown>)),
                },
            ) as CallToolResult;

            const images = (result.content ?? []).flatMap(c => (c.type === 'image' ? [{ mimeType: c.mimeType, data: c.data }] : []));
            return {
                ok: !result.isError,
                text: resultText(result),
                ...(result.structuredContent ? { structured: result.structuredContent } : {}),
                ...(images.length ? { images } : {}),
            };
        };

        // MCP's cancel message doesn't reach a call on a stateless server, so a sandbox
        // is told directly to stop what's running.
        const stopSandbox = () => {
            if (!conn.sandbox || !opts.identity) return;
            const url = new URL(`sandboxes/${opts.identity.chat}/cancel`, new URL('.', conn.server.url));
            url.searchParams.set('user', opts.identity.user);
            const headers: Record<string, string> = conn.server.token ? { authorization: `Bearer ${conn.server.token}` } : {};
            void fetch(url, { method: 'POST', headers }).catch(() => { /* it stops at its own time limit */ });
        };
        opts.signal.addEventListener('abort', stopSandbox, { once: true });

        try {
            return await attempt();
        } catch (err) {
            if (opts.signal.aborted) throw err;

            await this.#close(conn);
            // Not repeated: the command may have run, and running it twice can do damage.
            if (conn.sandbox) return { ok: false, text: `The ${tool.serverName} server failed: ${errorText(err)}` };

            // The server may have restarted: reconnect once and try again.
            try {
                return await attempt();
            } catch (retryErr) {
                if (opts.signal.aborted) throw retryErr;
                return { ok: false, text: `The ${tool.serverName} server failed: ${errorText(retryErr)}` };
            }
        } finally {
            opts.signal.removeEventListener('abort', stopSandbox);
        }
    }

    async close(): Promise<void> {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        await Promise.all([...this.connections.values()].map(c => this.#close(c)));
    }

    async #connect(conn: Connection): Promise<void> {
        if (conn.connecting) return conn.connecting;

        conn.connecting = (async () => {
            conn.state = 'connecting';
            try {
                const client = await this.connector(conn.server);
                const tools: McpToolDefinition[] = [];
                let cursor: string | undefined;
                do {
                    const page = await client.listTools(cursor ? { cursor } : undefined);
                    tools.push(...page.tools);
                    cursor = page.nextCursor;
                } while (cursor);

                conn.client = client;
                conn.tools = tools;
                conn.sandbox = client.getServerCapabilities?.()?.experimental?.[SANDBOX_KEY] !== undefined;
                conn.state = 'connected';
                delete conn.error;
            } catch (err) {
                conn.client = undefined;
                conn.state = 'error';
                conn.error = errorText(err);
                console.error(`[mcp] ${conn.server.name}: ${conn.error}`);
            } finally {
                conn.connecting = undefined;
            }
        })();

        return conn.connecting;
    }

    async #close(conn: Connection): Promise<void> {
        const client = conn.client;
        conn.client = undefined;
        if (client) await client.close().catch(() => { /* already gone */ });
    }

    #scheduleRetry(): void {
        if (this.retryTimer) return;
        this.retryTimer = setTimeout(async () => {
            this.retryTimer = undefined;
            const failed = [...this.connections.values()].filter(c => c.server.enabled && c.state === 'error');
            await Promise.all(failed.map(c => this.#connect(c)));
            if ([...this.connections.values()].some(c => c.server.enabled && c.state === 'error')) this.#scheduleRetry();
        }, RETRY_MS);
        this.retryTimer.unref();
    }
}

function slug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'server';
}

function errorText(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    return text.slice(0, 300);
}

function toProgress(p: Record<string, unknown>): McpProgress {
    const meta = p._meta as Record<string, unknown> | undefined;
    const page = meta?.page as McpProgress['page'] | undefined;
    return {
        progress: typeof p.progress === 'number' ? p.progress : 0,
        ...(typeof p.total === 'number' ? { total: p.total } : {}),
        ...(typeof p.message === 'string' ? { message: p.message } : {}),
        ...(page && typeof page.url === 'string' && typeof page.status === 'string' ? { page } : {}),
        ...(typeof meta?.output === 'string' ? { output: meta.output } : {}),
    };
}

function resultText(result: CallToolResult): string {
    const parts = (result.content ?? []).filter(c => c.type !== 'image').map((c) => {
        if (c.type === 'text') return c.text;
        if (c.type === 'resource' && 'text' in c.resource) return String(c.resource.text);
        if (c.type === 'resource_link') return `[${c.name}](${c.uri})`;
        return `[${c.type} omitted]`;
    });
    if (parts.length === 0 && result.structuredContent) return JSON.stringify(result.structuredContent);
    return parts.join('\n\n');
}
