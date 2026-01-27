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

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Get default permissions based on user role
 */
function getDefaultPermissions(role: string): Record<string, any> {
    const isAdmin = role === 'admin';
    return {
        workspace: {
            models: isAdmin,
            knowledge: isAdmin,
            prompts: isAdmin,
        },
    };
}

/* -------------------- SIGNUP ROUTE TESTS -------------------- */

describe('POST /api/v1/auths/signup', () => {
    afterEach(async () => {
        await clearDatabase();
    });

    test('creates first user as admin', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Admin User',
                email: 'admin@example.com',
                password: 'adminpass123',
                profile_image_url: '/images/admin.png',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.email, 'admin@example.com');
        assert.strictEqual(res.body.name, 'admin@example.com'); // username used as name
        assert.strictEqual(res.body.role, 'admin'); // First user is admin
        assert.strictEqual(res.body.profile_image_url, '/images/admin.png');
        assert.strictEqual(res.body.token_type, 'Bearer');
        assert.ok(res.body.token);
        assert.ok(res.body.expires_at);

        // Verify permissions
        assert.ok(res.body.permissions);
        assert.strictEqual(res.body.permissions.workspace.models, true);
        assert.strictEqual(res.body.permissions.workspace.knowledge, true);
        assert.strictEqual(res.body.permissions.workspace.prompts, true);
    });

    test('creates subsequent users with default role', async () => {
        // Create first user (admin)
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Admin',
                email: 'admin@test.com',
                password: 'password123',
            });

        // Create second user (should be regular user)
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Regular User',
                email: 'user@test.com',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.email, 'user@test.com');
        assert.strictEqual(res.body.role, 'user'); // Not admin
        assert.ok(res.body.token);

        // Verify permissions (no admin access)
        assert.strictEqual(res.body.permissions.workspace.models, false);
        assert.strictEqual(res.body.permissions.workspace.knowledge, false);
        assert.strictEqual(res.body.permissions.workspace.prompts, false);
    });

    test('generates valid JWT token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Token Test',
                email: 'token@test.com',
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
                name: 'Cookie Test',
                email: 'cookie@test.com',
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

    test('normalizes email to lowercase (username)', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Case Test',
                email: 'UPPER@EXAMPLE.COM',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        // Email should be normalized to lowercase in username
        assert.strictEqual(res.body.email, 'upper@example.com');
        assert.strictEqual(res.body.name, 'upper@example.com');
    });

    test('uses default profile image when not provided', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Default Image',
                email: 'default@test.com',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.profile_image_url);
        // Should have default value from schema
    });

    test('rejects duplicate email/username', async () => {
        // Create first user
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'First',
                email: 'duplicate@test.com',
                password: 'password123',
            });

        // Try to create second user with same email
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Second',
                email: 'duplicate@test.com',
                password: 'password123',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
    });

    test('rejects invalid email format', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Invalid Email',
                email: 'not-an-email',
                password: 'password123',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
        assert.ok(res.body.errors);
    });

    test('rejects missing required fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                email: 'test@test.com',
                // Missing name and password
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
        assert.ok(res.body.errors);
    });

    test('rejects password that is too short', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Short Pass',
                email: 'short@test.com',
                password: 'short',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
    });

    test('rejects username that is too short', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Tiny',
                email: 'ab', // Only 2 characters, need 3
                password: 'password123',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
    });

    test('accepts valid profile image URL', async () => {
        const imageUrl = 'https://example.com/images/avatar.png';
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Custom Avatar',
                email: 'avatar@test.com',
                password: 'password123',
                profile_image_url: imageUrl,
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.profile_image_url, imageUrl);
    });

    test('returns expires_at timestamp', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Expiry Test',
                email: 'expiry@test.com',
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
    const testEmail = 'signin-test@example.com';
    const testPassword = 'testpass123';

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create a test user for signin tests
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Signin Test User',
                email: testEmail,
                password: testPassword,
            });
    });

    test('authenticates user with valid credentials', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: testEmail,
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.email, testEmail);
        assert.strictEqual(res.body.name, testEmail);
        assert.ok(res.body.token);
        assert.strictEqual(res.body.token_type, 'Bearer');
        assert.ok(res.body.expires_at);
    });

    test('generates valid JWT token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: testEmail,
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
                email: testEmail,
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
                email: testEmail,
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.id);
        assert.strictEqual(res.body.email, testEmail);
        assert.strictEqual(res.body.name, testEmail);
        assert.ok(res.body.role);
        assert.ok(res.body.profile_image_url !== undefined);
    });

    test('returns user permissions', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: testEmail,
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.permissions);
        assert.ok(res.body.permissions.workspace);
    });

    test('is case-insensitive for email', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: testEmail.toUpperCase(),
                password: testPassword,
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.email, testEmail);
    });

    test('rejects invalid email format', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: 'not-an-email',
                password: testPassword,
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects missing email', async () => {
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
                email: testEmail,
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects non-existent user', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: 'nonexistent@test.com',
                password: 'password123',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid credentials');
    });

    test('rejects incorrect password', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: testEmail,
                password: 'wrongpassword',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid credentials');
    });

    test('rejects empty password', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: testEmail,
                password: '',
            });

        assert.strictEqual(res.status, 400);
    });

    test('returns expires_at matching token expiration', async () => {
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: testEmail,
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
                name: 'Session Test',
                email: 'session@test.com',
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
        assert.strictEqual(res.body.email, 'session@test.com');
        assert.strictEqual(res.body.name, 'session@test.com');
        assert.ok(res.body.role);
        assert.ok(res.body.token);
        assert.strictEqual(res.body.token_type, 'Bearer');
    });

    test('returns permissions in response', async () => {
        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${testToken}`);

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.permissions);
        assert.ok(res.body.permissions.workspace);
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
        const email = 'flow@test.com';
        const password = 'flowpass123';

        // 1. Signup
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Flow Test',
                email: email,
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
                email: email,
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
        assert.strictEqual(sessionRes.body.email, email);

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
                name: 'User 1',
                email: 'user1@test.com',
                password: 'password123',
            });
        assert.strictEqual(user1Res.status, 200);
        const user1Id = user1Res.body.id;
        const user1Token = user1Res.body.token;

        // Create user 2
        const user2Res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'User 2',
                email: 'user2@test.com',
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
        const email = 'persist@test.com';
        const password = 'password123';

        // Signup
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Persist Test',
                email: email,
                password: password,
            });

        // Signin multiple times
        const signin1 = await request(app)
            .post('/api/v1/auths/signin')
            .send({ email, password });
        assert.strictEqual(signin1.status, 200);
        const token1 = signin1.body.token;

        const signin2 = await request(app)
            .post('/api/v1/auths/signin')
            .send({ email, password });
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
        assert.strictEqual(session1.body.email, email);
        assert.strictEqual(session2.body.email, email);
    });

    test('first user is admin, subsequent users are not', async () => {
        // First user
        const admin = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'First Admin',
                email: 'first-admin@test.com',
                password: 'password123',
            });
        assert.strictEqual(admin.status, 200);
        assert.strictEqual(admin.body.role, 'admin');
        assert.strictEqual(admin.body.permissions.workspace.models, true);

        // Second user
        const user = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Second User',
                email: 'second-user@test.com',
                password: 'password123',
            });
        assert.strictEqual(user.status, 200);
        assert.strictEqual(user.body.role, 'user');
        assert.strictEqual(user.body.permissions.workspace.models, false);
    });
});

/* -------------------- FIELD TRANSLATION TESTS -------------------- */

describe('field translation: email <-> username', () => {
    afterEach(async () => {
        await clearDatabase();
    });

    test('signup accepts email and stores as username', async () => {
        const email = 'fieldtest@example.com';
        const res = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Field Test',
                email: email,
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        // API returns email (which is username internally)
        assert.strictEqual(res.body.email, email);
        assert.strictEqual(res.body.name, email); // name also uses username

        // Verify it's stored correctly in database
        const user = await Users.getUserById(res.body.id, db);
        assert.ok(user);
        assert.strictEqual(user.username, email);
    });

    test('signin uses email to lookup username', async () => {
        const email = 'lookup@test.com';

        // Create user
        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Lookup Test',
                email: email,
                password: 'password123',
            });

        // Signin with email
        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: email,
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.email, email);
        assert.strictEqual(res.body.name, email);
    });

    test('session check returns email and name from username', async () => {
        const email = 'sessionfield@test.com';

        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Session Field',
                email: email,
                password: 'password123',
            });

        assert.strictEqual(signupRes.status, 200);

        const sessionRes = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${signupRes.body.token}`);

        assert.strictEqual(sessionRes.status, 200);
        assert.strictEqual(sessionRes.body.email, email);
        assert.strictEqual(sessionRes.body.name, email);

        // Verify database still has username
        const user = await Users.getUserById(sessionRes.body.id, db);
        assert.strictEqual(user?.username, email);
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
                name: 'Cookie Match',
                email: 'cookie-match@test.com',
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
        const email = 'signin-cookie@test.com';

        await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Signin Cookie',
                email: email,
                password: 'password123',
            });

        const res = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: email,
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
                name: 'Refresh Test',
                email: 'refresh@test.com',
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
                name: 'JTI 1',
                email: 'jti1@test.com',
                password: 'password123',
            });

        const res2 = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'JTI 2',
                email: 'jti2@test.com',
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
