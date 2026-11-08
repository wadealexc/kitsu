/**
 * The file panel's view of a chat's sandbox.
 *
 * The browser talks to these routes, never to the sandbox manager: this is where
 * the logged-in user is checked against the chat, and the manager only ever hears
 * the user kitsu has confirmed.
 */

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireAuth } from './middleware.js';
import { Chats, db, type McpServer } from '../db/index.js';
import type { McpManager } from '../mcp/manager.js';

const router = Router();

const ChatId = z.uuid();
const PathParam = z.string().min(1).max(4096);

function managerUrl(server: McpServer, suffix: string, params: Record<string, string>): string {
    const url = new URL(`sandboxes${suffix}`, new URL('.', server.url));
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
}

const authHeaders = (server: McpServer): Record<string, string> => server.token ? { authorization: `Bearer ${server.token}` } : {};

/**
 * The sandbox server and chat id, if this user may use this chat's sandbox. A chat
 * that isn't saved yet is allowed, for files added before the first message: the
 * manager ties the sandbox to whichever user makes it.
 */
async function access(req: Request<{ chatId: string }>, res: Response): Promise<{ server: McpServer; chat: string; user: string } | null> {
    const chat = ChatId.safeParse(req.params.chatId);
    if (!chat.success) {
        res.status(400).json({ detail: 'Invalid chat' });
        return null;
    }
    const server = (req.app.locals.mcp as McpManager).sandboxServer();
    if (!server) {
        res.status(503).json({ detail: 'No sandbox server is available' });
        return null;
    }
    const existing = await Chats.getChatById(chat.data, db);
    if (existing && existing.userId !== req.user!.id) {
        res.status(404).json({ detail: 'Chat not found' });
        return null;
    }
    return { server, chat: chat.data, user: req.user!.id };
}

/** Passes on the manager's answer, or its error, as JSON. */
async function relay(upstream: globalThis.Response, res: Response): Promise<Response> {
    if (upstream.status === 204) return res.status(204).end();
    const body = await upstream.json().catch(() => ({})) as { error?: string };
    if (!upstream.ok) return res.status(upstream.status).json({ detail: body.error ?? 'The sandbox request failed' });
    return res.json(body);
}

router.get('/:chatId', requireAuth, async (req: Request<{ chatId: string }>, res: Response) => {
    const ok = await access(req, res);
    if (ok) await relay(await fetch(managerUrl(ok.server, `/${ok.chat}`, { user: ok.user }), { headers: authHeaders(ok.server) }), res);
});

router.get('/:chatId/files', requireAuth, async (req: Request<{ chatId: string }>, res: Response) => {
    const ok = await access(req, res);
    if (!ok) return;
    const path = typeof req.query.path === 'string' ? req.query.path : '.';
    await relay(await fetch(managerUrl(ok.server, `/${ok.chat}/files`, { user: ok.user, path }), { headers: authHeaders(ok.server) }), res);
});

/**
 * Always sent as an attachment of no particular type, with sniffing off. Files here
 * were made by whatever ran in the sandbox, and must never run as a page on kitsu's
 * own address, where they'd act as the logged-in user.
 */
router.get('/:chatId/file', requireAuth, async (req: Request<{ chatId: string }>, res: Response) => {
    const ok = await access(req, res);
    if (!ok) return;
    const path = PathParam.safeParse(req.query.path);
    if (!path.success) return void res.status(400).json({ detail: 'Invalid path' });

    const upstream = await fetch(managerUrl(ok.server, `/${ok.chat}/file`, { user: ok.user, path: path.data }), { headers: authHeaders(ok.server) });
    if (!upstream.ok || !upstream.body) return void await relay(upstream, res);

    const name = path.data.split('/').pop() ?? 'file';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    await pipeline(Readable.fromWeb(upstream.body as never), res).catch(() => { /* the browser went away */ });
});

router.put('/:chatId/file', requireAuth, async (req: Request<{ chatId: string }>, res: Response) => {
    const ok = await access(req, res);
    if (!ok) return;
    const path = PathParam.safeParse(req.query.path);
    if (!path.success) return void res.status(400).json({ detail: 'Invalid path' });

    await relay(await fetch(managerUrl(ok.server, `/${ok.chat}/file`, { user: ok.user, path: path.data }), {
        method: 'PUT',
        headers: { ...authHeaders(ok.server), 'content-type': 'application/octet-stream' },
        body: req as never,
        duplex: 'half',
    } as RequestInit), res);
});

router.delete('/:chatId/file', requireAuth, async (req: Request<{ chatId: string }>, res: Response) => {
    const ok = await access(req, res);
    if (!ok) return;
    const path = PathParam.safeParse(req.query.path);
    if (!path.success) return void res.status(400).json({ detail: 'Invalid path' });
    await relay(await fetch(managerUrl(ok.server, `/${ok.chat}/file`, { user: ok.user, path: path.data }), { method: 'DELETE', headers: authHeaders(ok.server) }), res);
});

/** Removes a deleted chat's sandbox, or all of a user's. It doesn't hold up the delete, and leftovers expire. */
export function discardSandboxes(mcp: McpManager | undefined, user: string, chat?: string): void {
    const server = mcp?.sandboxServer();
    if (!server) return;
    void fetch(managerUrl(server, chat ? `/${chat}` : '', { user }), { method: 'DELETE', headers: authHeaders(server) })
        .catch(err => console.error(`[sandbox] couldn't remove a deleted chat's sandbox: ${err}`));
}

export default router;
