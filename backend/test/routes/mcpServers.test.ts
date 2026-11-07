import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import { migrate } from 'drizzle-orm/libsql/migrator';

import { assertInMemoryDatabase, createUserWithToken } from '../helpers.js';
import { db, schema } from '../../src/db/index.js';
import mcpServersRouter from '../../src/routes/mcpServers.js';
import { McpManager } from '../../src/mcp/manager.js';
import { fakeConnector } from '../fakeMcp.js';

assertInMemoryDatabase();
await migrate(db, { migrationsFolder: './drizzle' });

const app: Express = express();
app.use(express.json());
app.use(cookieParser());
const mcp = new McpManager(fakeConnector());
app.locals.mcp = mcp;
app.use('/api/v1/mcp', mcpServersRouter);

describe('/api/v1/mcp/servers', () => {
    let admin: string;
    let user: string;

    before(async () => {
        await db.delete(schema.mcpServers);
        ({ token: admin } = await createUserWithToken('admin'));
        ({ token: user } = await createUserWithToken('user'));
    });

    after(() => mcp.close());

    const as = (token: string) => ({ Authorization: `Bearer ${token}` });

    test('only admins can add servers', async () => {
        const res = await request(app).post('/api/v1/mcp/servers').set(as(user)).send({ name: 'web', url: 'http://web.local/mcp' });
        assert.strictEqual(res.status, 403);
    });

    test('adds a server, connects, and never returns the token', async () => {
        const res = await request(app).post('/api/v1/mcp/servers').set(as(admin))
            .send({ name: 'web', url: 'http://web.local/mcp', token: 'secret-token' });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.state, 'connected');
        assert.strictEqual(res.body.hasToken, true);
        assert.ok(res.body.tools.some((t: any) => t.name === 'web_search'));
        assert.ok(!JSON.stringify(res.body).includes('secret-token'));

        const stored = await db.select().from(schema.mcpServers);
        assert.strictEqual(stored[0]!.token, 'secret-token');
    });

    test('rejects a second server with the same name', async () => {
        const res = await request(app).post('/api/v1/mcp/servers').set(as(admin)).send({ name: 'web', url: 'http://other.local/mcp' });
        assert.strictEqual(res.status, 400);
    });

    test('users see enabled servers and their tools, without URLs', async () => {
        const res = await request(app).get('/api/v1/mcp/servers').set(as(user));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.length, 1);
        assert.strictEqual(res.body[0].name, 'web');
        assert.strictEqual(res.body[0].url, undefined);
        assert.strictEqual(res.body[0].hasToken, undefined);
    });

    test('updates keep the token unless it is changed, and disabling hides the server from users', async () => {
        const [server] = await db.select().from(schema.mcpServers);
        let res = await request(app).post(`/api/v1/mcp/servers/${server!.id}`).set(as(admin)).send({ name: 'Web' });
        assert.strictEqual(res.body.name, 'Web');
        assert.strictEqual(res.body.hasToken, true);

        res = await request(app).post(`/api/v1/mcp/servers/${server!.id}`).set(as(admin)).send({ token: null, enabled: false });
        assert.strictEqual(res.body.hasToken, false);
        assert.strictEqual(res.body.state, 'disabled');

        res = await request(app).get('/api/v1/mcp/servers').set(as(user));
        assert.deepStrictEqual(res.body, []);
        assert.deepStrictEqual(mcp.tools(), []);
    });

    test('shows why a server can\'t be reached', async () => {
        const res = await request(app).post('/api/v1/mcp/servers').set(as(admin)).send({ name: 'gone', url: 'http://down.local/mcp' });
        assert.strictEqual(res.body.state, 'error');
        assert.match(res.body.error, /connection refused/);
    });

    test('deletes servers', async () => {
        for (const s of await db.select().from(schema.mcpServers)) {
            const res = await request(app).delete(`/api/v1/mcp/servers/${s.id}`).set(as(admin));
            assert.strictEqual(res.status, 200);
        }
        assert.deepStrictEqual(mcp.status(), []);
        assert.strictEqual((await request(app).delete('/api/v1/mcp/servers/nope').set(as(admin))).status, 404);
    });
});
