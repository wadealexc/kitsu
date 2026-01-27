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

describe('POST /api/v1/auths/update/password', () => {
    let testToken: string;
    let testUserId: string;
    const testEmail = 'password-test@example.com';
    const testPassword = 'oldpassword123';

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create test user
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Password Test',
                email: testEmail,
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
                email: testEmail,
                password: testPassword,
            });
        assert.strictEqual(oldSignin.status, 400);

        // Verify new password works
        const newSignin = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: testEmail,
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
                email: testEmail,
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
                email: testEmail,
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
    const testEmail = 'profile-test@example.com';

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create test user
        const signupRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Profile Test',
                email: testEmail,
                password: 'password123',
                profile_image_url: '/default.png',
            });
        testToken = signupRes.body.token;
        testUserId = signupRes.body.id;
    });

    test('updates profile image URL', async () => {
        const newImageUrl = '/images/new-avatar.png';

        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Ignored Name',
                profile_image_url: newImageUrl,
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.id, testUserId);
        assert.strictEqual(res.body.email, testEmail);
        assert.strictEqual(res.body.name, testEmail);
        assert.strictEqual(res.body.profile_image_url, newImageUrl);
        assert.strictEqual(res.body.role, 'admin'); // First user

        // Verify change persisted in database
        const user = await Users.getUserById(testUserId, db);
        assert.strictEqual(user?.profileImageUrl, newImageUrl);
    });

    test('updates to external URL', async () => {
        const externalUrl = 'https://example.com/avatar.jpg';

        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Test User',
                profile_image_url: externalUrl,
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.profile_image_url, externalUrl);
    });

    test('ignores name field (uses username)', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Different Name',
                profile_image_url: '/images/test.png',
            });

        assert.strictEqual(res.status, 200);
        // Name should still be username (email)
        assert.strictEqual(res.body.name, testEmail);
        assert.strictEqual(res.body.email, testEmail);
    });

    test('ignores bio field (not supported)', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Test',
                profile_image_url: '/test.png',
                bio: 'This bio should be ignored',
            });

        assert.strictEqual(res.status, 200);
        // Bio field not in response (removed from schema)
        assert.strictEqual(res.body.bio, undefined);
    });

    test('ignores gender field (not supported)', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Test',
                profile_image_url: '/test.png',
                gender: 'non-binary',
            });

        assert.strictEqual(res.status, 200);
        // Gender field not in response
        assert.strictEqual(res.body.gender, undefined);
    });

    test('ignores date_of_birth field (not supported)', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Test',
                profile_image_url: '/test.png',
                date_of_birth: '1990-01-01',
            });

        assert.strictEqual(res.status, 200);
        // DOB field not in response
        assert.strictEqual(res.body.date_of_birth, undefined);
    });

    test('rejects request without authentication', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .send({
                name: 'Test',
                profile_image_url: '/test.png',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });

    test('rejects request with invalid token', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', 'Bearer invalid-token')
            .send({
                name: 'Test',
                profile_image_url: '/test.png',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');
    });

    test('rejects missing required fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                // Missing name and profile_image_url
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects missing name field', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                profile_image_url: '/test.png',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects missing profile_image_url field', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Test',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('returns updated user with all required fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/update/profile')
            .set('Authorization', `Bearer ${testToken}`)
            .send({
                name: 'Test',
                profile_image_url: '/new.png',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.id);
        assert.ok(res.body.name);
        assert.ok(res.body.email);
        assert.ok(res.body.role);
        assert.ok(res.body.profile_image_url);
    });
});

describe('POST /api/v1/auths/add', () => {
    let adminToken: string;
    let userToken: string;

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create admin user (first user)
        const adminRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Admin',
                email: 'admin@test.com',
                password: 'password123',
            });
        adminToken = adminRes.body.token;

        // Create regular user
        const userRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'User',
                email: 'user@test.com',
                password: 'password123',
            });
        userToken = userRes.body.token;
    });

    test('admin can create user with specified role', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'New User',
                email: 'newuser@test.com',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.id);
        assert.strictEqual(res.body.email, 'newuser@test.com');
        assert.strictEqual(res.body.name, 'newuser@test.com');
        assert.strictEqual(res.body.role, 'user');
        assert.ok(res.body.token);
        assert.strictEqual(res.body.token_type, 'Bearer');
        assert.ok(res.body.profile_image_url);

        // Verify user can sign in
        const signin = await request(app)
            .post('/api/v1/auths/signin')
            .send({
                email: 'newuser@test.com',
                password: 'password123',
            });
        assert.strictEqual(signin.status, 200);
        assert.strictEqual(signin.body.id, res.body.id);
    });

    test('admin can create pending user', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Pending User',
                email: 'pending@test.com',
                password: 'password123',
                role: 'pending',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.role, 'pending');
    });

    test('admin can create admin user', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Another Admin',
                email: 'admin2@test.com',
                password: 'password123',
                role: 'admin',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.role, 'admin');
    });

    test('uses default role when not specified', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Default Role',
                email: 'default@test.com',
                password: 'password123',
            });

        assert.strictEqual(res.status, 200);
        // Should use default role from schema (user)
        assert.ok(['user', 'pending'].includes(res.body.role));
    });

    test('accepts custom profile image URL', async () => {
        const imageUrl = '/images/custom-avatar.png';
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Custom Avatar',
                email: 'custom@test.com',
                password: 'password123',
                role: 'user',
                profile_image_url: imageUrl,
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.profile_image_url, imageUrl);
    });

    test('uses default profile image when not provided', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Default Image',
                email: 'defaultimg@test.com',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.profile_image_url);
    });

    test('does not set cookie for admin-created users', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'No Cookie',
                email: 'nocookie@test.com',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 200);
        // Should not set cookie (unlike signup)
        const setCookie = res.headers['set-cookie'];
        assert.strictEqual(setCookie, undefined);
    });

    test('rejects duplicate email/username', async () => {
        // Create first user
        await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'First',
                email: 'duplicate@test.com',
                password: 'password123',
                role: 'user',
            });

        // Try to create duplicate
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Second',
                email: 'duplicate@test.com',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
    });

    test('rejects invalid email format', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Invalid Email',
                email: 'not-an-email',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects password that is too short', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Short Pass',
                email: 'short@test.com',
                password: 'short',
                role: 'user',
            });

        assert.strictEqual(res.status, 400);
        assert.ok(res.body.detail);
    });

    test('rejects invalid role', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Bad Role',
                email: 'badrole@test.com',
                password: 'password123',
                role: 'superadmin', // Not a valid role
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects missing required fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Missing Fields',
                // Missing email and password
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects non-admin user', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${userToken}`)
            .send({
                name: 'Unauthorized',
                email: 'unauth@test.com',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.body.detail, 'Admin access required');
    });

    test('rejects unauthenticated request', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .send({
                name: 'No Auth',
                email: 'noauth@test.com',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });

    test('normalizes email to lowercase', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Case Test',
                email: 'UPPERCASE@TEST.COM',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.email, 'uppercase@test.com');
        assert.strictEqual(res.body.name, 'uppercase@test.com');
    });

    test('returns token with valid structure', async () => {
        const res = await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Token Test',
                email: 'token@test.com',
                password: 'password123',
                role: 'user',
            });

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.token);

        // Verify token is valid
        const decoded = JWT.verifyToken(res.body.token);
        assert.strictEqual(decoded.id, res.body.id);
        assert.ok(decoded.jti);
        assert.ok(decoded.exp);
    });
});

describe('GET /api/v1/auths/admin/details', () => {
    let adminToken: string;
    let userToken: string;
    const adminEmail = 'first-admin@test.com';

    afterEach(async () => {
        await clearDatabase();
    });

    beforeEach(async () => {
        // Create admin user (first user)
        const adminRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'Admin',
                email: adminEmail,
                password: 'password123',
            });
        adminToken = adminRes.body.token;

        // Create regular user
        const userRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'User',
                email: 'user@test.com',
                password: 'password123',
            });
        userToken = userRes.body.token;
    });

    test('returns first user details', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/details')
            .set('Authorization', `Bearer ${adminToken}`);

        assert.strictEqual(res.status, 200);
        assert.ok(res.body);
        assert.strictEqual(res.body.name, adminEmail);
        assert.strictEqual(res.body.email, adminEmail);
    });

    test('returns admin details even when requested by regular user', async () => {
        // This endpoint requires auth but not admin role
        const res = await request(app)
            .get('/api/v1/auths/admin/details')
            .set('Authorization', `Bearer ${userToken}`);

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.email, adminEmail);
        assert.strictEqual(res.body.name, adminEmail);
    });

    test('rejects unauthenticated request', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/details');

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Not authenticated');
    });

    test('rejects invalid token', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/details')
            .set('Authorization', 'Bearer invalid-token');

        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.body.detail, 'Authentication failed');
    });

    test('returns 404 when no users exist', async () => {
        // Clear database to have no users
        await clearDatabase();

        // Create a token manually for testing
        const fakeUserId = crypto.randomUUID();
        const fakeToken = JWT.createToken(fakeUserId);

        const res = await request(app)
            .get('/api/v1/auths/admin/details')
            .set('Authorization', `Bearer ${fakeToken}`);

        // Will fail auth first since user doesn't exist
        assert.strictEqual(res.status, 401);
    });

    test('always returns first created user regardless of role changes', async () => {
        // Create another admin after the first user
        await request(app)
            .post('/api/v1/auths/add')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                name: 'Second Admin',
                email: 'second-admin@test.com',
                password: 'password123',
                role: 'admin',
            });

        const res = await request(app)
            .get('/api/v1/auths/admin/details')
            .set('Authorization', `Bearer ${adminToken}`);

        assert.strictEqual(res.status, 200);
        // Should still return first user
        assert.strictEqual(res.body.email, adminEmail);
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
                name: 'Admin',
                email: 'admin@test.com',
                password: 'password123',
            });
        adminToken = adminRes.body.token;

        // Create regular user
        const userRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'User',
                email: 'user@test.com',
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
        assert.ok(typeof res.body.SHOW_ADMIN_DETAILS === 'boolean');
        assert.ok(typeof res.body.ENABLE_SIGNUP === 'boolean');
        assert.ok(typeof res.body.ENABLE_API_KEYS === 'boolean');
        assert.ok(typeof res.body.ENABLE_COMMUNITY_SHARING === 'boolean');
        assert.ok(typeof res.body.ENABLE_MESSAGE_RATING === 'boolean');
        assert.ok(res.body.WEBUI_URL);
        assert.ok(res.body.JWT_EXPIRES_IN);
        assert.ok(res.body.DEFAULT_USER_ROLE);
    });

    test('includes all required config fields', async () => {
        const res = await request(app)
            .get('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`);

        assert.strictEqual(res.status, 200);
        assert.ok(res.body.SHOW_ADMIN_DETAILS !== undefined);
        assert.ok(res.body.ADMIN_EMAIL !== undefined);
        assert.ok(res.body.WEBUI_URL !== undefined);
        assert.ok(res.body.ENABLE_SIGNUP !== undefined);
        assert.ok(res.body.ENABLE_API_KEYS !== undefined);
        assert.ok(res.body.JWT_EXPIRES_IN !== undefined);
        assert.ok(res.body.DEFAULT_USER_ROLE !== undefined);
        assert.ok(res.body.ENABLE_COMMUNITY_SHARING !== undefined);
        assert.ok(res.body.ENABLE_MESSAGE_RATING !== undefined);
        assert.ok(res.body.ENABLE_FOLDERS !== undefined);
        assert.ok(res.body.ENABLE_CHANNELS !== undefined);
        assert.ok(res.body.ENABLE_MEMORIES !== undefined);
        assert.ok(res.body.ENABLE_NOTES !== undefined);
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
                name: 'Admin',
                email: 'admin@test.com',
                password: 'password123',
            });
        adminToken = adminRes.body.token;

        // Create regular user
        const userRes = await request(app)
            .post('/api/v1/auths/signup')
            .send({
                name: 'User',
                email: 'user@test.com',
                password: 'password123',
            });
        userToken = userRes.body.token;
    });

    test('updates admin config', async () => {
        const newConfig = {
            SHOW_ADMIN_DETAILS: false,
            ADMIN_EMAIL: 'admin@example.com',
            WEBUI_URL: 'http://localhost:8080',
            ENABLE_SIGNUP: false,
            ENABLE_API_KEYS: true,
            ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
            API_KEYS_ALLOWED_ENDPOINTS: '',
            DEFAULT_USER_ROLE: 'pending' as const,
            DEFAULT_GROUP_ID: '',
            JWT_EXPIRES_IN: '30d',
            ENABLE_COMMUNITY_SHARING: true,
            ENABLE_MESSAGE_RATING: true,
            ENABLE_FOLDERS: true,
            FOLDER_MAX_FILE_COUNT: null,
            ENABLE_CHANNELS: false,
            ENABLE_MEMORIES: false,
            ENABLE_NOTES: false,
            ENABLE_USER_WEBHOOKS: false,
            ENABLE_USER_STATUS: false,
            PENDING_USER_OVERLAY_TITLE: null,
            PENDING_USER_OVERLAY_CONTENT: null,
            RESPONSE_WATERMARK: null,
        };

        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send(newConfig);

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.SHOW_ADMIN_DETAILS, false);
        assert.strictEqual(res.body.ADMIN_EMAIL, 'admin@example.com');
        assert.strictEqual(res.body.WEBUI_URL, 'http://localhost:8080');
        assert.strictEqual(res.body.ENABLE_SIGNUP, false);
        assert.strictEqual(res.body.ENABLE_API_KEYS, true);
        assert.strictEqual(res.body.DEFAULT_USER_ROLE, 'pending');
        assert.strictEqual(res.body.JWT_EXPIRES_IN, '30d');
        assert.strictEqual(res.body.ENABLE_COMMUNITY_SHARING, true);
        assert.strictEqual(res.body.ENABLE_MESSAGE_RATING, true);
    });

    test('updates persist across requests', async () => {
        // Update config
        await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                SHOW_ADMIN_DETAILS: false,
                ADMIN_EMAIL: null,
                WEBUI_URL: 'http://updated.com',
                ENABLE_SIGNUP: false,
                ENABLE_API_KEYS: false,
                ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
                API_KEYS_ALLOWED_ENDPOINTS: '',
                DEFAULT_USER_ROLE: 'pending' as const,
                DEFAULT_GROUP_ID: '',
                JWT_EXPIRES_IN: '14d',
                ENABLE_COMMUNITY_SHARING: false,
                ENABLE_MESSAGE_RATING: false,
                ENABLE_FOLDERS: true,
                FOLDER_MAX_FILE_COUNT: null,
                ENABLE_CHANNELS: false,
                ENABLE_MEMORIES: false,
                ENABLE_NOTES: false,
                ENABLE_USER_WEBHOOKS: false,
                ENABLE_USER_STATUS: false,
                PENDING_USER_OVERLAY_TITLE: null,
                PENDING_USER_OVERLAY_CONTENT: null,
                RESPONSE_WATERMARK: null,
            });

        // Get config to verify persistence
        const res = await request(app)
            .get('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`);

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ENABLE_SIGNUP, false);
        assert.strictEqual(res.body.WEBUI_URL, 'http://updated.com');
        assert.strictEqual(res.body.JWT_EXPIRES_IN, '14d');
    });

    test('accepts valid JWT expiration formats', async () => {
        const validFormats = ['7d', '4w', '24h', '30m', '-1'];

        for (const format of validFormats) {
            const res = await request(app)
                .post('/api/v1/auths/admin/config')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    SHOW_ADMIN_DETAILS: true,
                    ADMIN_EMAIL: null,
                    WEBUI_URL: 'http://localhost:3000',
                    ENABLE_SIGNUP: true,
                    ENABLE_API_KEYS: false,
                    ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
                    API_KEYS_ALLOWED_ENDPOINTS: '',
                    DEFAULT_USER_ROLE: 'user' as const,
                    DEFAULT_GROUP_ID: '',
                    JWT_EXPIRES_IN: format,
                    ENABLE_COMMUNITY_SHARING: false,
                    ENABLE_MESSAGE_RATING: false,
                    ENABLE_FOLDERS: true,
                    FOLDER_MAX_FILE_COUNT: null,
                    ENABLE_CHANNELS: false,
                    ENABLE_MEMORIES: false,
                    ENABLE_NOTES: false,
                    ENABLE_USER_WEBHOOKS: false,
                    ENABLE_USER_STATUS: false,
                    PENDING_USER_OVERLAY_TITLE: null,
                    PENDING_USER_OVERLAY_CONTENT: null,
                    RESPONSE_WATERMARK: null,
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
                SHOW_ADMIN_DETAILS: true,
                ADMIN_EMAIL: null,
                WEBUI_URL: 'http://localhost:3000',
                ENABLE_SIGNUP: true,
                ENABLE_API_KEYS: false,
                ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
                API_KEYS_ALLOWED_ENDPOINTS: '',
                DEFAULT_USER_ROLE: 'user',
                DEFAULT_GROUP_ID: '',
                JWT_EXPIRES_IN: 'invalid-format',
                ENABLE_COMMUNITY_SHARING: false,
                ENABLE_MESSAGE_RATING: false,
                ENABLE_FOLDERS: true,
                FOLDER_MAX_FILE_COUNT: null,
                ENABLE_CHANNELS: false,
                ENABLE_MEMORIES: false,
                ENABLE_NOTES: false,
                ENABLE_USER_WEBHOOKS: false,
                ENABLE_USER_STATUS: false,
                PENDING_USER_OVERLAY_TITLE: null,
                PENDING_USER_OVERLAY_CONTENT: null,
                RESPONSE_WATERMARK: null,
            });

        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.body.detail, 'Invalid request body');
    });

    test('rejects invalid user role', async () => {
        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                SHOW_ADMIN_DETAILS: true,
                ADMIN_EMAIL: null,
                WEBUI_URL: 'http://localhost:3000',
                ENABLE_SIGNUP: true,
                ENABLE_API_KEYS: false,
                ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
                API_KEYS_ALLOWED_ENDPOINTS: '',
                DEFAULT_USER_ROLE: 'superuser', // Invalid role
                DEFAULT_GROUP_ID: '',
                JWT_EXPIRES_IN: '7d',
                ENABLE_COMMUNITY_SHARING: false,
                ENABLE_MESSAGE_RATING: false,
                ENABLE_FOLDERS: true,
                FOLDER_MAX_FILE_COUNT: null,
                ENABLE_CHANNELS: false,
                ENABLE_MEMORIES: false,
                ENABLE_NOTES: false,
                ENABLE_USER_WEBHOOKS: false,
                ENABLE_USER_STATUS: false,
                PENDING_USER_OVERLAY_TITLE: null,
                PENDING_USER_OVERLAY_CONTENT: null,
                RESPONSE_WATERMARK: null,
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
                SHOW_ADMIN_DETAILS: true,
                ADMIN_EMAIL: null,
                WEBUI_URL: 'http://localhost:3000',
                ENABLE_SIGNUP: false,
                ENABLE_API_KEYS: false,
                ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
                API_KEYS_ALLOWED_ENDPOINTS: '',
                DEFAULT_USER_ROLE: 'user',
                DEFAULT_GROUP_ID: '',
                JWT_EXPIRES_IN: '7d',
                ENABLE_COMMUNITY_SHARING: false,
                ENABLE_MESSAGE_RATING: false,
                ENABLE_FOLDERS: true,
                FOLDER_MAX_FILE_COUNT: null,
                ENABLE_CHANNELS: false,
                ENABLE_MEMORIES: false,
                ENABLE_NOTES: false,
                ENABLE_USER_WEBHOOKS: false,
                ENABLE_USER_STATUS: false,
                PENDING_USER_OVERLAY_TITLE: null,
                PENDING_USER_OVERLAY_CONTENT: null,
                RESPONSE_WATERMARK: null,
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

    test('accepts null values for optional fields', async () => {
        const res = await request(app)
            .post('/api/v1/auths/admin/config')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                SHOW_ADMIN_DETAILS: true,
                ADMIN_EMAIL: null,
                WEBUI_URL: 'http://localhost:3000',
                ENABLE_SIGNUP: true,
                ENABLE_API_KEYS: false,
                ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
                API_KEYS_ALLOWED_ENDPOINTS: '',
                DEFAULT_USER_ROLE: 'user',
                DEFAULT_GROUP_ID: '',
                JWT_EXPIRES_IN: '7d',
                ENABLE_COMMUNITY_SHARING: false,
                ENABLE_MESSAGE_RATING: false,
                ENABLE_FOLDERS: true,
                FOLDER_MAX_FILE_COUNT: null,
                ENABLE_CHANNELS: false,
                ENABLE_MEMORIES: false,
                ENABLE_NOTES: false,
                ENABLE_USER_WEBHOOKS: false,
                ENABLE_USER_STATUS: false,
                PENDING_USER_OVERLAY_TITLE: null,
                PENDING_USER_OVERLAY_CONTENT: null,
                RESPONSE_WATERMARK: null,
            });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.body.ADMIN_EMAIL, null);
        assert.strictEqual(res.body.FOLDER_MAX_FILE_COUNT, null);
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
                name: 'Timezone Test',
                email: 'timezone@test.com',
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
