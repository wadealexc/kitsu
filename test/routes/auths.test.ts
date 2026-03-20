import { describe, test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';

import { assertInMemoryDatabase, newUserParams, TEST_PASSWORD, type TestDatabase } from '../helpers.js';
import { db } from '../../src/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.js';
import * as Users from '../../src/db/operations/users.js';
import * as Auths from '../../src/db/operations/auths.js';
import * as JWT from '../../src/routes/jwt.js';
import authRouter from '../../src/routes/auths.js';

/* -------------------- TEST SETUP -------------------- */

// Ensure tests use in-memory database
assertInMemoryDatabase();

// Apply migrations to the in-memory database (async with libSQL)
await migrate(db, { migrationsFolder: './drizzle' });

// Helper function to clear database tables
async function clearDatabase() {
    await db.delete(schema.auths);
    await db.delete(schema.users);
}

// Create Express app with auth routes
const app: Express = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v1/auths', authRouter);

/* -------------------- SIGNUP ROUTE TESTS -------------------- */

describe('POST /api/v1/auths/signup', () => {
    afterEach(async () => {
        await clearDatabase();
    });

    test('creates first user as admin', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'admin',
                password: 'adminpass123',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.username, 'admin');
        assert.strictEqual(res.body.role, 'admin'); // First user is admin
        assert.strictEqual(res.body.token_type, 'Bearer');
        assert.ok(res.body.token);
        assert.ok(res.body.expires_at);
    });

    test('creates subsequent users with default role', async () => {
        // Create first user (admin)
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'admin',
                password: 'password123',
            });

        // Create second user (should be regular user)
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.username, 'user');
        assert.strictEqual(res.body.role, 'user'); // Not admin
        assert.ok(res.body.token);
    });

    test('generates valid JWT token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.token);

        // Verify token can be decoded
        const decoded = JWT.verifyToken(res.body.token);
        assert.strictEqual(decoded.id, res.body.id);
        assert.ok(decoded.jti);
        assert.ok(decoded.exp);
    });

    test('sets secure cookie with token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);

        // Check Set-Cookie header
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(Array.isArray(setCookie));
        assert.ok(setCookie[0].includes('token='));
        assert.ok(setCookie[0].includes('HttpOnly'));
        assert.ok(setCookie[0].includes('SameSite=Lax'));
        assert.ok(setCookie[0].includes('Path=/'));
    });

    test('normalizes username to lowercase', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'USER',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.username, 'user');
    });

    test('rejects duplicate username', async () => {
        // Create first user
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });

        // Try to create second user with same username
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
    });

    test('rejects invalid username format', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user@email.com',
                password: 'password123',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Username can only contain letters, numbers, underscore, dash, and space');
    });

    test('rejects missing required fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                // Missing password
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
        assert.ok(res.body.errors);
    });

    test('rejects password that is too short', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'short',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
    });

    test('rejects username that is too short', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'us',
                password: 'password123',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
    });

    test('returns expires_at timestamp', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.expires_at);
        assert.strictEqual(typeof res.body.expires_at, 'number');

        // Should be approximately 7 days in the future
        const now = Math.floor(Date.now() / 1000);
        const sevenDays = 7 * 24 * 3600;
        assert.ok(res.body.expires_at > now);
        assert.ok(res.body.expires_at < now + sevenDays + 60); // Allow 1 min variance
    });
});

/* -------------------- SIGNIN ROUTE TESTS -------------------- */

describe('POST /api/v1/auths/signin', () => {
    const testUsername = 'user';
    const testPassword = 'testpass123';

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create a test user for signin tests
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: testUsername,
                password: testPassword,
            });
    });

    test('authenticates user with valid credentials', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.username, testUsername);
        assert.ok(res.body.token);
        assert.strictEqual(res.body.token_type, 'Bearer');
        assert.ok(res.body.expires_at);
    });

    test('generates valid JWT token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        const token = res.body.token;
        assert.ok(token);

        const decoded = JWT.verifyToken(token);
        assert.strictEqual(decoded.id, res.body.id);
        assert.ok(decoded.jti);
        assert.ok(decoded.exp);
    });

    test('sets secure cookie with token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);

        // Check Set-Cookie header
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(Array.isArray(setCookie));
        assert.ok(setCookie[0].includes('token='));
        assert.ok(setCookie[0].includes('HttpOnly'));
    });

    test('returns user profile information', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.id);
        assert.strictEqual(res.body.username, testUsername);
        assert.ok(res.body.role);
    });

    test('is case-insensitive for username', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername.toUpperCase(),
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.username, testUsername);
    });

    test('rejects invalid username format', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: 'user@email.com',
                password: testPassword,
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid credentials');
    });

    test('rejects missing username', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                password: testPassword,
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects missing password', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects non-existent user', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: 'nonuser',
                password: 'password123',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid credentials');
    });

    test('rejects incorrect password', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: 'wrongpassword',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid credentials');
    });

    test('rejects empty password', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: '',
            });

        assert.strictEqual(res.status, 400);
    });

    test('returns expires_at matching token expiration', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        const decoded = JWT.verifyToken(res.body.token);
        assert.strictEqual(res.body.expires_at, decoded.exp);
    });
});

/* -------------------- SESSION CHECK ROUTE TESTS -------------------- */

describe('GET /api/v1/auths/', () => {
    let testToken: string;
    let testUserId: string;

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create a test user and get their token
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });
        testToken = signupRes.body.token;
        testUserId = signupRes.body.id;
    });

    test('returns user info with valid token', async () => {
        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${testToken}`);

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.id, testUserId);
        assert.strictEqual(res.body.username, 'user');
        assert.ok(res.body.role);
        assert.ok(res.body.token);
        assert.strictEqual(res.body.token_type, 'Bearer');
    });

    test('refreshes cookie on session check', async () => {
        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${testToken}`);

        assert.strictEqual(res.status, 200);

        // Check Set-Cookie header
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(Array.isArray(setCookie));
        assert.ok(setCookie[0].includes('token='));
    });

    test('returns token expiration', async () => {
        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${testToken}`);

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.expires_at);
        assert.strictEqual(typeof res.body.expires_at, 'number');

        const decoded = JWT.verifyToken(testToken);
        assert.strictEqual(res.body.expires_at, decoded.exp);
    });

    test('rejects request without token', async () => {
        const res = await request(app)
            .get('/api/v1/auths/');

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });

    test('rejects expired token', async () => {
        // Create an expired token
        const payload = {
            id: testUserId,
            jti: crypto.randomUUID(),
            exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        };
        const expiredToken = jwt.sign(payload, process.env.WEBUI_SECRET_KEY || 'dev-only-secret-key-NOT-FOR-PROD!', {
            algorithm: 'HS256',
        });

        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${expiredToken}`);

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');

        // Check that cookie is cleared
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(Array.isArray(setCookie));
        assert.ok(setCookie[0].includes('token=;')); // Empty value clears cookie
    });

    test('rejects invalid token signature', async () => {
        const payload = {
            id: testUserId,
            jti: crypto.randomUUID(),
        };
        const invalidToken = jwt.sign(payload, 'wrong-secret', {
            algorithm: 'HS256',
        });

        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${invalidToken}`);

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');
    });

    test('rejects malformed token', async () => {
        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', 'Bearer not.a.valid.token');

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');
    });

    test('rejects token for non-existent user', async () => {
        // Create a valid token for a user that doesn't exist
        const fakeUserId = crypto.randomUUID();
        const fakeToken = JWT.createToken(fakeUserId);

        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${fakeToken}`);

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'User not found');

        // Check that cookie is cleared
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(Array.isArray(setCookie));
        assert.ok(setCookie[0].includes('token=;')); // Empty value clears cookie
    });

    test('clears cookie on authentication failure', async () => {
        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', 'Bearer invalid-token');

        assert.strictEqual(res.status, 401);

        // Check that cookie is cleared
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(Array.isArray(setCookie));
        assert.ok(setCookie[0].includes('token=;')); // Empty value clears cookie
    });
});

/* -------------------- SIGNOUT ROUTE TESTS -------------------- */

describe('GET /api/v1/auths/signout', () => {
    afterEach(async () => {
        await clearDatabase();
    });

    test('returns success status', async () => {
        const res = await request(app)
            .get('/api/v1/auths/signout');

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.status, true);
    });

    test('clears token cookie', async () => {
        const res = await request(app)
            .get('/api/v1/auths/signout');

        assert.strictEqual(res.status, 200);

        // Check that cookie is cleared
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(Array.isArray(setCookie));
        assert.ok(setCookie[0].includes('token=;')); // Empty value clears cookie
    });

    test('clears cookie with correct options', async () => {
        const res = await request(app)
            .get('/api/v1/auths/signout');

        assert.strictEqual(res.status, 200);

        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(setCookie[0]!.includes('HttpOnly'));
        assert.ok(setCookie[0]!.includes('SameSite=Lax'));
        assert.ok(setCookie[0]!.includes('Path=/'));
    });

    test('can be called multiple times', async () => {
        const res1 = await request(app)
            .get('/api/v1/auths/signout');

        const res2 = await request(app)
            .get('/api/v1/auths/signout');

        assert.strictEqual(res1.status, 200);
        assert.strictEqual(res2.status, 200);
        assert.strictEqual(res1.body.status, true);
        assert.strictEqual(res2.body.status, true);
    });

    test('does not require authentication', async () => {
        // Signout should work even without a valid token
        // This is intentional - allows client to clear state
        const res = await request(app)
            .get('/api/v1/auths/signout');

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, true);
    });
});

/* -------------------- INTEGRATION TESTS -------------------- */

describe('integration: complete auth flow', () => {
    afterEach(async () => {
        await clearDatabase();
    });

    test('signup -> signin -> session check -> signout', async () => {
        const username = 'user';
        const password = 'flowpass123';

        // 1. Signup
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: username,
                password: password,
            });
        assert.strictEqual(signupRes.status, 200);
        assert.ok(signupRes.body.token);
        assert.ok(signupRes.body.id);
        const userId = signupRes.body.id;

        // 2. Signin (verify credentials work)
        const signinRes = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: username,
                password: password,
            });
        assert.strictEqual(signinRes.status, 200);
        assert.strictEqual(signinRes.body.id, userId);
        assert.ok(signinRes.body.token);
        const token = signinRes.body.token;

        // 3. Session check (verify token works)
        const sessionRes = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${token}`);
        assert.strictEqual(sessionRes.status, 200);
        assert.strictEqual(sessionRes.body.id, userId);
        assert.strictEqual(sessionRes.body.username, username);

        // 4. Signout (clear session)
        const signoutRes = await request(app)
            .get('/api/v1/auths/signout');
        assert.strictEqual(signoutRes.status, 200);
        assert.strictEqual(signoutRes.body.status, true);
    });

    test('multiple users can sign up and have separate sessions', async () => {
        // Create user 1
        const user1Res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user 1',
                password: 'password123',
            });
        assert.strictEqual(user1Res.status, 200);
        const user1Id = user1Res.body.id;
        const user1Token = user1Res.body.token;

        // Create user 2
        const user2Res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user 2',
                password: 'password123',
            });
        assert.strictEqual(user2Res.status, 200);
        const user2Id = user2Res.body.id;
        const user2Token = user2Res.body.token;

        // Verify different users
        assert.notStrictEqual(user1Id, user2Id);
        assert.notStrictEqual(user1Token, user2Token);

        // Verify both tokens work independently
        const session1 = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${user1Token}`);
        assert.strictEqual(session1.status, 200);
        assert.strictEqual(session1.body.id, user1Id);

        const session2 = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${user2Token}`);
        assert.strictEqual(session2.status, 200);
        assert.strictEqual(session2.body.id, user2Id);
    });

    test('token persists across signin calls', async () => {
        const username = 'user';
        const password = 'password123';

        // Signup
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: username,
                password: password,
            });

        // Signin multiple times
        const signin1 = await request(app)
            .post('/api/v1/auths/signin')
            .send({ username, password });
        assert.strictEqual(signin1.status, 200);
        const token1 = signin1.body.token;

        const signin2 = await request(app)
            .post('/api/v1/auths/signin')
            .send({ username, password });
        assert.strictEqual(signin2.status, 200);
        const token2 = signin2.body.token;

        // Tokens will be different (new JTI each time)
        assert.notStrictEqual(token1, token2);

        // But both should be valid for the same user
        const session1 = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${token1}`);
        assert.strictEqual(session1.status, 200);

        const session2 = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${token2}`);
        assert.strictEqual(session2.status, 200);

        assert.strictEqual(session1.body.id, session2.body.id);
        assert.strictEqual(session1.body.username, username);
        assert.strictEqual(session2.body.username, username);
    });

    test('first user is admin, subsequent users are not', async () => {
        // First user
        const admin = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'admin',
                password: 'password123',
            });
        assert.strictEqual(admin.status, 200);
        assert.strictEqual(admin.body.role, 'admin');

        // Second user
        const user = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });
        assert.strictEqual(user.status, 200);
        assert.strictEqual(user.body.role, 'user');
    });
});

/* -------------------- TOKEN AND COOKIE TESTS -------------------- */

describe('token and cookie handling', () => {
    afterEach(async () => {
        await clearDatabase();
    });

    test('signup sets cookie expiration matching token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        const decoded = JWT.verifyToken(res.body.token);
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);

        // Extract Expires from Set-Cookie header
        const expiresMatch = setCookie[0]!.match(/Expires=([^;]+)/);
        assert.ok(expiresMatch);
        const cookieExpires = new Date(expiresMatch[1]!);
        assert.strictEqual(cookieExpires.getTime(), decoded.exp! * 1000);
    });

    test('signin sets cookie expiration matching token', async () => {
        const username = 'user';

        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: username,
                password: 'password123',
            });

        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: username,
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        const decoded = JWT.verifyToken(res.body.token);
        const setCookie = res.headers['set-cookie'];
        assert.ok(setCookie);

        // Extract Expires from Set-Cookie header
        const expiresMatch = setCookie[0]!.match(/Expires=([^;]+)/);
        assert.ok(expiresMatch);
        const cookieExpires = new Date(expiresMatch[1]!);
        assert.strictEqual(cookieExpires.getTime(), decoded.exp! * 1000);
    });

    test('session check refreshes cookie with same token', async () => {
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });
        assert.strictEqual(signupRes.status, 200);
        const originalToken = signupRes.body.token;

        const sessionRes = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${originalToken}`);

        assert.strictEqual(sessionRes.status, 200);
        // Token should be the same (not regenerated)
        assert.strictEqual(sessionRes.body.token, originalToken);

        // Cookie should be set with the same token
        const setCookie = sessionRes.headers['set-cookie'];
        assert.ok(setCookie);
        assert.ok(setCookie[0]!.includes(`token=${originalToken}`));
    });

    test('tokens have unique JTI for revocation tracking', async () => {
        const res1 = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user 1',
                password: 'password123',
            });

        const res2 = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user 2',
                password: 'password123',
            });

        assert.strictEqual(res1.status, 200);
        assert.strictEqual(res2.status, 200);

        const decoded1 = jwt.decode(res1.body.token) as any;
        const decoded2 = jwt.decode(res2.body.token) as any;

        assert.ok(decoded1.jti);
        assert.ok(decoded2.jti);
        assert.notStrictEqual(decoded1.jti, decoded2.jti);
    });
});

describe('POST /api/v1/auths/update/password', () => {
    let testToken: string;
    let testUserId: string;
    const testUsername = 'user';
    const testPassword = 'oldpassword123';

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create test user
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: testUsername,
                password: testPassword,
            });
        testToken = signupRes.body.token;
        testUserId = signupRes.body.id;
    });

    test('updates password with valid current password', async () => {
        const newPassword = 'newpassword456';

        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                password: testPassword,
                new_password: newPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body, true);

        // Verify old password no longer works
        const oldSignin = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: testPassword,
            });
        assert.strictEqual(oldSignin.status, 400);

        // Verify new password works
        const newSignin = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: newPassword,
            });
        assert.strictEqual(newSignin.status, 200);
        assert.strictEqual(newSignin.body.id, testUserId);
    });

    test('allows setting password to same value', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                password: testPassword,
                new_password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body, true);

        // Verify password still works
        const signin = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: testPassword,
            });
        assert.strictEqual(signin.status, 200);
    });

    test('rejects incorrect current password', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                password: 'wrongpassword',
                new_password: 'newpassword456',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Current password is incorrect');

        // Verify old password still works
        const signin = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                username: testUsername,
                password: testPassword,
            });
        assert.strictEqual(signin.status, 200);
    });

    test('rejects new password that is too short', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                password: testPassword,
                new_password: 'short',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
        assert.ok(res.body.detail.includes('too short'));
    });

    test('rejects new password that is too long', async () => {
        // Create a password longer than 72 bytes
        const tooLongPassword = 'a'.repeat(73);

        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                password: testPassword,
                new_password: tooLongPassword,
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
        assert.ok(res.body.detail.includes('too long'));
    });

    test('rejects request without authentication', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .send({
                password: testPassword,
                new_password: 'newpassword456',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });

    test('rejects request with invalid token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', 'Bearer invalid-token')
            .send({
                password: testPassword,
                new_password: 'newpassword456',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');
    });

    test('rejects missing current password field', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                new_password: 'newpassword456',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects missing new password field', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                password: testPassword,
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects empty current password', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                password: '',
                new_password: 'newpassword456',
            });

        assert.strictEqual(res.status, 400);
    });

    test('rejects empty new password', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/password')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                password: testPassword,
                new_password: '',
            });

        assert.strictEqual(res.status, 400);
    });
});

describe('POST /api/v1/auths/update/profile', () => {
    let testToken: string;
    let testUserId: string;
    const testUsername = 'user';

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create test user
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: testUsername,
                password: 'password123',
            });
        testToken = signupRes.body.token;
        testUserId = signupRes.body.id;
    });

    test('updates username field', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                username: 'new username',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.username, 'new username');
    });

    test('rejects request without authentication', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .send({
                username: 'user',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });

    test('rejects request with invalid token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', 'Bearer invalid-token')
            .send({
                username: 'user',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');
    });

    test('rejects missing required fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                // Missing username
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('returns updated user with all required fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                username: 'user',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.id);
        assert.ok(res.body.username);
        assert.ok(res.body.role);
    });
});

describe('GET /api/v1/auths/admin/config', () => {
    let adminToken: string;
    let userToken: string;

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create admin user
        const adminRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'admin',
                password: 'password123',
            });
        adminToken = adminRes.body.token;

        // Create regular user
        const userRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });
        userToken = userRes.body.token;
    });

    test('returns admin config', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`);

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.ok(typeof res.body.ENABLE_SIGNUP === 'boolean');
        assert.ok(res.body.APP_URL);
        assert.ok(res.body.JWT_EXPIRES_IN);
        assert.ok(res.body.DEFAULT_USER_ROLE);
    });

    test('includes all required config fields', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`);

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.APP_URL !== undefined);
        assert.ok(res.body.ENABLE_SIGNUP !== undefined);
        assert.ok(res.body.JWT_EXPIRES_IN !== undefined);
        assert.ok(res.body.DEFAULT_USER_ROLE !== undefined);
    });

    test('rejects non-admin user', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${userToken}`);

        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.detail, 'Admin access required');
    });

    test('rejects unauthenticated request', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/config');

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });

    test('rejects invalid token', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/config')
            .set('Authorization', 'Bearer invalid-token');

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');
    });
});

describe('POST /api/v1/auths/admin/config', () => {
    let adminToken: string;
    let userToken: string;

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create admin user
        const adminRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'admin',
                password: 'password123',
            });
        adminToken = adminRes.body.token;

        // Create regular user
        const userRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });
        userToken = userRes.body.token;
    });

    test('updates admin config', async () => {
        const newConfig = {
            APP_URL: 'http://localhost:8080',
            ENABLE_SIGNUP: false,
            DEFAULT_USER_ROLE: 'pending' as const,
            JWT_EXPIRES_IN: '30d',
        };

        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newConfig);

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.APP_URL, 'http://localhost:8080');
        assert.strictEqual(res.body.ENABLE_SIGNUP, false);
        assert.strictEqual(res.body.DEFAULT_USER_ROLE, 'pending');
        assert.strictEqual(res.body.JWT_EXPIRES_IN, '30d');
    });

    test('updates persist across requests', async () => {
        // Update config
        await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                APP_URL: 'http://updated.com',
                ENABLE_SIGNUP: false,
                DEFAULT_USER_ROLE: 'pending' as const,
                JWT_EXPIRES_IN: '14d',
            });

        // Get config to verify persistence
        const res = await request(app)
            .get('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`);

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ENABLE_SIGNUP, false);
        assert.strictEqual(res.body.APP_URL, 'http://updated.com');
        assert.strictEqual(res.body.JWT_EXPIRES_IN, '14d');
    });

    test('accepts valid JWT expiration formats', async () => {
        const validFormats = ['7d', '4w', '24h', '30m', '-1'];

        for (const format of validFormats) {
            const res = await request(app)
                .post('/api/v1/auths/admin/config')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    APP_URL: 'http://localhost:3000',
                    ENABLE_SIGNUP: true,
                    DEFAULT_USER_ROLE: 'user' as const,
                    JWT_EXPIRES_IN: format,
                });

            assert.strictEqual(res.status, 200, `Failed for format: ${format}`);
            assert.strictEqual(res.body.JWT_EXPIRES_IN, format);
        }
    });

    test('rejects invalid JWT expiration format', async () => {
        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                APP_URL: 'http://localhost:3000',
                ENABLE_SIGNUP: true,
                DEFAULT_USER_ROLE: 'user',
                JWT_EXPIRES_IN: 'invalid-format',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects invalid user role', async () => {
        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                APP_URL: 'http://localhost:3000',
                ENABLE_SIGNUP: true,
                DEFAULT_USER_ROLE: 'superuser', // Invalid role
                JWT_EXPIRES_IN: '7d',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects missing required fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                ENABLE_SIGNUP: false,
                // Missing other required fields
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects non-admin user', async () => {
        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                APP_URL: 'http://localhost:3000',
                ENABLE_SIGNUP: false,
                DEFAULT_USER_ROLE: 'user',
                JWT_EXPIRES_IN: '7d',
            });

        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.detail, 'Admin access required');
    });

    test('rejects unauthenticated request', async () => {
        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .send({
                ENABLE_SIGNUP: false,
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });
});

describe('POST /api/v1/auths/update/timezone', () => {
    let testToken: string;

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create test user
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                username: 'user',
                password: 'password123',
            });
        testToken = signupRes.body.token;
    });

    test('returns success status (no-op)', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/timezone')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                timezone: 'America/New_York',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.status, true);
    });

    test('accepts valid IANA timezone strings', async () => {
        const timezones = [
            'America/New_York',
            'Europe/London',
            'Asia/Tokyo',
            'UTC',
            'America/Los_Angeles',
        ];

        for (const tz of timezones) {
            const res = await request(app)
                .post('/api/v1/auths/update/timezone')
                .set('Authorization', `Bearer ${testToken}`)
                .send({
                    timezone: tz,
                });

            assert.strictEqual(res.status, 200, `Failed for timezone: ${tz}`);
            assert.strictEqual(res.body.status, true);
        }
    });

    test('accepts any string as timezone (validation not enforced)', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/timezone')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                timezone: 'Invalid/Timezone',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.status, true);
    });

    test('does not persist timezone to database', async () => {
        await request(app)
            .post('/api/v1/auths/update/timezone')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                timezone: 'Europe/Paris',
            });

        // Get user from database to verify no timezone field
        const sessionRes = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${testToken}`);

        assert.strictEqual(sessionRes.status, 200);
        // Timezone field should not exist in response (removed from schema)
        assert.strictEqual(sessionRes.body.timezone, undefined);
    });

    test('rejects request without authentication', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/timezone')
            .send({
                timezone: 'America/New_York',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });

    test('rejects request with invalid token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/timezone')
            .set('Authorization', 'Bearer invalid-token')
            .send({
                timezone: 'America/New_York',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');
    });

    test('can be called multiple times', async () => {
        const res1 = await request(app)
            .post('/api/v1/auths/update/timezone')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                timezone: 'America/New_York',
            });

        const res2 = await request(app)
            .post('/api/v1/auths/update/timezone')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                timezone: 'Europe/London',
            });

        assert.strictEqual(res1.status, 200);
        assert.strictEqual(res2.status, 200);
        assert.strictEqual(res1.body.status, true);
        assert.strictEqual(res2.body.status, true);
    });
});
