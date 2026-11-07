/**
 * Dev server side of the debug bridge (see src/lib/debug/bridge.ts).
 *
 * Pages connect to /__debug/ws. A developer drives them through a small HTTP API,
 * which needs the `x-debug-token` header to match KITSU_DEBUG_TOKEN:
 *
 *   GET  /__debug/api/clients                 connected pages
 *   GET  /__debug/api/events?since=N&limit=M  console, errors, lifecycle (seq > N)
 *   POST /__debug/api/eval {code, client?}    run JS in the page (async body; `return` a value)
 *   GET  /__debug/api/measure?client=         viewport, keyboard, safe area, scroll positions
 *   POST /__debug/api/screenshot?client=      page re-rendered from the DOM, saved as a PNG
 *   POST /__debug/api/trace {ms?, armed?, client?}  per-frame layout samples, from the next tap
 *
 * Events are also appended to $KITSU_DEBUG_DIR/events.jsonl.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';

type Client = {
    id: string;
    ws: WebSocket;
    userAgent?: string;
    standalone?: boolean;
    url?: string;
    connectedAt: number;
    lastSeen: number;
};

type StoredEvent = { seq: number; client: string; t: number; kind: string; data?: unknown; buffered?: boolean };

const MAX_EVENTS = 10_000;
const COMMAND_TIMEOUT_MS = 20_000;
/** A trace waits for the user to tap, so it gets longer. */
const TRACE_TIMEOUT_MS = 600_000;

export function debugBridge(options: { token: string; dir: string }): Plugin {
    const clients = new Map<string, Client>();
    const events: StoredEvent[] = [];
    let seq = 0;
    const pending = new Map<string, (reply: { result?: unknown; error?: string }) => void>();
    let nextCommand = 0;

    mkdirSync(options.dir, { recursive: true });
    const eventsFile = path.join(options.dir, 'events.jsonl');

    const store = (client: string, e: Omit<StoredEvent, 'seq' | 'client'>) => {
        const event: StoredEvent = { seq: ++seq, client, ...e };
        events.push(event);
        if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
        try {
            appendFileSync(eventsFile, `${JSON.stringify(event)}\n`);
        } catch {
            /* best effort */
        }
    };

    const pick = (id?: string | null): Client | undefined => {
        if (id) return clients.get(id);
        return [...clients.values()].sort((a, b) => b.lastSeen - a.lastSeen)[0];
    };

    const command = (client: Client, op: string, extra: Record<string, unknown> = {}, timeoutMs = COMMAND_TIMEOUT_MS) =>
        new Promise<{ result?: unknown; error?: string }>((resolve) => {
            const id = String(++nextCommand);
            const timer = setTimeout(() => {
                pending.delete(id);
                resolve({ error: 'timed out: the page may be suspended or closed' });
            }, timeoutMs);
            pending.set(id, (reply) => {
                clearTimeout(timer);
                resolve(reply);
            });
            client.ws.send(JSON.stringify({ id, op, ...extra }));
        });

    const json = (res: ServerResponse, status: number, body: unknown) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(body, null, 2));
    };

    const readBody = (req: IncomingMessage) =>
        new Promise<Record<string, unknown>>((resolve) => {
            let raw = '';
            req.on('data', (c) => (raw += c));
            req.on('end', () => {
                try {
                    resolve(raw ? JSON.parse(raw) : {});
                } catch {
                    resolve({});
                }
            });
        });

    return {
        name: 'kitsu-debug-bridge',
        apply: 'serve',
        configureServer(server) {
            const wss = new WebSocketServer({ noServer: true });

            server.httpServer?.on('upgrade', (req, socket, head) => {
                if (!req.url?.startsWith('/__debug/ws')) return;
                wss.handleUpgrade(req, socket, head, (ws) => {
                    let client: Client | undefined;

                    ws.on('message', (raw) => {
                        let msg: any;
                        try {
                            msg = JSON.parse(String(raw));
                        } catch {
                            return;
                        }
                        if (msg.type === 'hello') {
                            const now = Date.now();
                            client = {
                                id: String(msg.clientId),
                                ws,
                                userAgent: msg.userAgent,
                                standalone: msg.standalone,
                                url: msg.url,
                                connectedAt: now,
                                lastSeen: now
                            };
                            clients.set(client.id, client);
                            store(client.id, { t: now, kind: 'bridge.connected', data: { standalone: msg.standalone, url: msg.url } });
                            return;
                        }
                        if (!client) return;
                        client.lastSeen = Date.now();
                        if (msg.type === 'event') store(client.id, msg.event);
                        if (msg.type === 'result') pending.get(String(msg.id))?.({ result: msg.result, error: msg.error });
                    });

                    ws.on('close', () => {
                        if (!client) return;
                        store(client.id, { t: Date.now(), kind: 'bridge.disconnected' });
                        if (clients.get(client.id)?.ws === ws) clients.delete(client.id);
                    });
                });
            });

            server.middlewares.use('/__debug/api', async (req, res) => {
                if (!options.token || req.headers['x-debug-token'] !== options.token) {
                    return json(res, 401, { error: 'x-debug-token required' });
                }

                const url = new URL(req.url ?? '/', 'http://localhost');
                const route = url.pathname.replace(/\/+$/, '');

                if (req.method === 'GET' && route === '/clients') {
                    return json(res, 200, [...clients.values()].map(({ ws: _ws, ...c }) => c));
                }

                if (req.method === 'GET' && route === '/events') {
                    const since = Number(url.searchParams.get('since') ?? 0);
                    const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 2000);
                    return json(res, 200, { latest: seq, events: events.filter((e) => e.seq > since).slice(-limit) });
                }

                const body = req.method === 'POST' ? await readBody(req) : {};
                const client = pick((body.client as string) ?? url.searchParams.get('client'));
                if (!client) return json(res, 404, { error: 'no page is connected' });

                if (req.method === 'POST' && route === '/eval') {
                    return json(res, 200, await command(client, 'eval', { code: String(body.code ?? '') }));
                }

                if (req.method === 'GET' && route === '/measure') {
                    return json(res, 200, await command(client, 'measure'));
                }

                if (req.method === 'POST' && route === '/trace') {
                    const extra = { ms: Number(body.ms ?? 2500), armed: body.armed !== false };
                    return json(res, 200, await command(client, 'trace', extra, TRACE_TIMEOUT_MS + extra.ms));
                }

                if (req.method === 'POST' && route === '/screenshot') {
                    const reply = await command(client, 'screenshot');
                    if (reply.error || typeof reply.result !== 'string') return json(res, 500, reply);
                    const file = path.join(options.dir, `screenshot-${Date.now()}.png`);
                    writeFileSync(file, Buffer.from(reply.result.replace(/^data:image\/png;base64,/, ''), 'base64'));
                    return json(res, 200, { file });
                }

                return json(res, 404, { error: `no route ${req.method} ${route}` });
            });
        }
    };
}
