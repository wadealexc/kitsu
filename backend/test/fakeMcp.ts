import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { Connector } from '../src/mcp/manager.js';

/**
 * An in-process MCP server for tests. Servers whose URL contains "down" refuse
 * to connect. Every server offers:
 * - echo {text}: returns the text, reporting two pages of progress
 * - big {size}: returns `size` characters
 * - broken: returns an error result
 * Servers whose URL contains "web" also offer web_search.
 */
export function fakeConnector(calls: { server: string; tool: string; args: unknown }[] = []): Connector {
    return async (record) => {
        if (record.url.includes('down')) throw new Error('connection refused');

        const isSandbox = record.url.includes('sandbox');
        const server = new McpServer({ name: record.name, version: '1' }, isSandbox ? { capabilities: { experimental: { 'kitsu/sandbox': {} } } } : undefined);
        if (isSandbox) {
            server.registerTool('sandbox_whoami', { description: 'Reports who is calling', inputSchema: { chat: z.string().optional() } }, async (args, extra) => {
                calls.push({ server: record.name, tool: 'sandbox_whoami', args: { given: args, identity: extra._meta?.['kitsu/sandbox'] } });
                return { content: [{ type: 'text', text: 'ok' }] };
            });
        }
        server.registerTool('echo', {
            description: 'Echo the text back',
            inputSchema: { text: z.string() },
        }, async ({ text }, extra) => {
            calls.push({ server: record.name, tool: 'echo', args: { text } });
            const token = extra._meta?.progressToken;
            if (token !== undefined) {
                for (const [i, status] of (['loading', 'loaded'] as const).entries()) {
                    await extra.sendNotification({
                        method: 'notifications/progress',
                        params: { progressToken: token, progress: i, total: 1, message: `${status} a.example`, _meta: { page: { url: 'https://a.example/', status } } },
                    });
                }
            }
            return { content: [{ type: 'text', text: `echo: ${text}` }], structuredContent: { pages: [{ url: 'https://a.example/', outcome: 'ok' }] } };
        });
        server.registerTool('big', {
            description: 'A large result',
            inputSchema: { size: z.number() },
        }, async ({ size }) => {
            calls.push({ server: record.name, tool: 'big', args: { size } });
            return { content: [{ type: 'text', text: 'x'.repeat(size) }] };
        });
        server.registerTool('broken', { description: 'Always fails' }, async () => {
            calls.push({ server: record.name, tool: 'broken', args: {} });
            return { isError: true, content: [{ type: 'text', text: 'it broke' }] };
        });
        if (record.url.includes('web')) {
            server.registerTool('web_search', {
                description: 'Search the web',
                inputSchema: { query: z.string() },
            }, async ({ query }) => {
                calls.push({ server: record.name, tool: 'web_search', args: { query } });
                return { content: [{ type: 'text', text: `results for ${query}` }] };
            });
        }

        const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
        await server.connect(serverSide);
        const client = new Client({ name: 'kitsu-test', version: '1' });
        await client.connect(clientSide);
        return client;
    };
}

let created = 0;

/** A server record as the database would return it. */
export function serverRecord(over: Partial<{ id: string; name: string; url: string; token: string | null; enabled: boolean; createdAt: number }> = {}) {
    created++;
    return {
        id: over.id ?? `srv-${created}`,
        name: over.name ?? `server ${created}`,
        url: over.url ?? 'http://fake.local/mcp',
        token: over.token ?? null,
        enabled: over.enabled ?? true,
        icon: 'wrench',
        createdAt: over.createdAt ?? created,
        updatedAt: over.createdAt ?? created,
    };
}
