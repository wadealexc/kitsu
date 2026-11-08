/**
 * MCP server routes
 *
 * Admins add MCP servers; their tools are offered in every chat, and users turn
 * each server on or off per chat. Server tokens are stored but never returned.
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';

import { requireAdmin, requireAuth } from './middleware.js';
import { db, McpServers, RecordNotFoundError } from '../db/index.js';
import type { McpManager, McpServerStatus } from '../mcp/manager.js';

const router = Router();

const NameSchema = z.string().trim().min(1).max(60);
const UrlSchema = z.url({ protocol: /^https?$/ }).max(2000);
const TokenSchema = z.string().trim().max(2000);
const IconSchema = z.enum(['wrench', 'globe', 'search', 'terminal', 'database', 'document', 'folder', 'link', 'bolt']);

const CreateSchema = z.object({
    name: NameSchema,
    url: UrlSchema,
    token: TokenSchema.optional(),
    enabled: z.boolean().default(true),
    icon: IconSchema.optional(),
});

const UpdateSchema = z.object({
    name: NameSchema.optional(),
    url: UrlSchema.optional(),
    // Omit to keep the current token; null or "" removes it.
    token: TokenSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    icon: IconSchema.optional(),
});

/** What users see: enough to show and toggle a server's tools. */
type PublicStatus = Omit<McpServerStatus, 'url' | 'hasToken'>;

function manager(req: Request): McpManager {
    return req.app.locals.mcp as McpManager;
}

async function syncFromDb(mcp: McpManager): Promise<void> {
    await mcp.sync(await McpServers.listServers(db));
}

function isUniqueViolation(err: unknown): boolean {
    const text = String((err as { cause?: unknown })?.cause ?? err);
    return text.includes('UNIQUE');
}

/**
 * GET /api/v1/mcp/servers
 * Access Control: Any authenticated user (admins also get URLs and whether a token is set)
 */
router.get('/servers', requireAuth, async (req: Request, res: Response<(McpServerStatus | PublicStatus)[]>) => {
    const status = manager(req).status();
    if (req.user?.role === 'admin') return res.json(status);
    return res.json(status
        .filter(s => s.enabled)
        .map(({ url: _url, hasToken: _hasToken, ...rest }) => rest));
});

/**
 * POST /api/v1/mcp/servers
 * Access Control: Admin
 */
router.post('/servers', requireAdmin, async (req: Request, res: Response) => {
    const body = CreateSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });

    try {
        const { token, ...rest } = body.data;
        const created = await McpServers.createServer({ ...rest, token: token || null }, db);
        await syncFromDb(manager(req));
        return res.status(200).json(manager(req).status().find(s => s.id === created.id));
    } catch (err) {
        if (isUniqueViolation(err)) return res.status(400).json({ detail: 'A server with that name already exists' });
        return res.status(500).json({ detail: `Failed to add server: ${err}` });
    }
});

/**
 * POST /api/v1/mcp/servers/:id
 * Access Control: Admin
 */
router.post('/servers/:id', requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
    const body = UpdateSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });

    try {
        const { token, ...rest } = body.data;
        await McpServers.updateServer(req.params.id, {
            ...rest,
            ...(token !== undefined ? { token: token || null } : {}),
        }, db);
        await syncFromDb(manager(req));
        return res.status(200).json(manager(req).status().find(s => s.id === req.params.id));
    } catch (err) {
        if (err instanceof RecordNotFoundError) return res.status(404).json({ detail: 'Server not found' });
        if (isUniqueViolation(err)) return res.status(400).json({ detail: 'A server with that name already exists' });
        return res.status(500).json({ detail: `Failed to update server: ${err}` });
    }
});

/**
 * POST /api/v1/mcp/servers/:id/refresh
 * Access Control: Admin
 *
 * Reconnects and reloads the server's tools.
 */
router.post('/servers/:id/refresh', requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
    const found = manager(req).status().find(s => s.id === req.params.id);
    if (!found) return res.status(404).json({ detail: 'Server not found' });

    await manager(req).refresh(req.params.id);
    return res.status(200).json(manager(req).status().find(s => s.id === req.params.id));
});

/**
 * DELETE /api/v1/mcp/servers/:id
 * Access Control: Admin
 */
router.delete('/servers/:id', requireAdmin, async (req: Request<{ id: string }>, res: Response) => {
    try {
        await McpServers.deleteServer(req.params.id, db);
        await syncFromDb(manager(req));
        return res.status(200).json(true);
    } catch (err) {
        if (err instanceof RecordNotFoundError) return res.status(404).json({ detail: 'Server not found' });
        return res.status(500).json({ detail: `Failed to delete server: ${err}` });
    }
});

export default router;
