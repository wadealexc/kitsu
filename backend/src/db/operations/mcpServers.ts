import { asc, eq } from 'drizzle-orm';

import { db, type DbOrTx } from '../client.js';
import { mcpServers } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import { RecordCreationError, RecordNotFoundError } from '../errors.js';

const TABLE = 'mcp_server';

export type McpServer = typeof mcpServers.$inferSelect;
export type NewMcpServer = Omit<typeof mcpServers.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateMcpServer = Partial<NewMcpServer>;

export async function listServers(txOrDb: DbOrTx = db): Promise<McpServer[]> {
    return txOrDb.select().from(mcpServers).orderBy(asc(mcpServers.createdAt), asc(mcpServers.name));
}

export async function getServer(id: string, txOrDb: DbOrTx = db): Promise<McpServer | null> {
    const [row] = await txOrDb.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1);
    return row ?? null;
}

export async function createServer(params: NewMcpServer, txOrDb: DbOrTx = db): Promise<McpServer> {
    const now = currentUnixTimestamp();
    const [row] = await txOrDb
        .insert(mcpServers)
        .values({ ...params, id: crypto.randomUUID(), createdAt: now, updatedAt: now })
        .returning();

    if (!row) throw new RecordCreationError(TABLE);
    return row;
}

export async function updateServer(id: string, updates: UpdateMcpServer, txOrDb: DbOrTx = db): Promise<McpServer> {
    const [row] = await txOrDb
        .update(mcpServers)
        .set({ ...updates, updatedAt: currentUnixTimestamp() })
        .where(eq(mcpServers.id, id))
        .returning();

    if (!row) throw new RecordNotFoundError(TABLE, id);
    return row;
}

export async function deleteServer(id: string, txOrDb: DbOrTx = db): Promise<void> {
    const deleted = await txOrDb.delete(mcpServers).where(eq(mcpServers.id, id)).returning();
    if (deleted.length === 0) throw new RecordNotFoundError(TABLE, id);
}
