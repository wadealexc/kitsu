import { describe, test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { assertInMemoryDatabase, createUserWithToken, newUserParams, TEST_PASSWORD } from '../helpers.js';
import { db } from '../../src/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.js';
import * as Users from '../../src/db/operations/users.js';
import * as Auths from '../../src/db/operations/auths.js';
import * as JWT from '../../src/routes/jwt.js';
import { type UserRole } from '../../src/routes/types.js';
import usersRouter from '../../src/routes/users.js';

/* -------------------- TEST SETUP -------------------- */

// Ensure tests use in-memory database
assertInMemoryDatabase();

// Apply migrations to the in-memory database
await migrate(db, { migrationsFolder: './drizzle' });

// Helper function to clear database tables
async function clearDatabase() {
    await db.delete(schema.auths);
    await db.delete(schema.users);
}

// Create Express app with users routes
const app: Express = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v1/users', usersRouter);

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Create multiple test users and return their data
 */
async function createMultipleUsers(count: number, role: UserRole = 'user'): Promise<Array<{ userId: string; username: string }>> {
    const users = [];
    for (let i = 0; i < count; i++) {
        const userParams = newUserParams(role);
        const user = await Users.createUser(userParams, db);
        await Auths.createAuth({
            id: user.id, 
            username: userParams.username, 
            password: TEST_PASSWORD
        }, db);
        users.push({ userId: user.id, username: userParams.username });
    }
    return users;
}

/* -------------------- TESTS -------------------- */

describe('GET /api/v1/users/search', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return paginated user list with valid token', async () => {
        const { token } = await createUserWithToken('user');
        await createMultipleUsers(5, 'user');

        const response = await request(app)
            .get('/api/v1/users/search')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.users);
        assert.ok(Array.isArray(response.body.users));
        assert.strictEqual(response.body.users.length, 6); // 1 original + 5 created
        assert.strictEqual(response.body.total, 6);

        // Verify response structure
        const user = response.body.users[0];
        assert.ok(user.id);
        assert.ok(user.username);
        assert.ok(user.role);
    });

    test('should return single user when only authenticated user exists', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/users/search')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.users.length, 1);
        assert.strictEqual(response.body.total, 1);
    });

    test('should filter users by query parameter', async () => {
        const { token } = await createUserWithToken('admin');
        const users = await createMultipleUsers(3, 'user');

        // Search for specific username
        const searchQuery = users[0]!.username.substring(0, 5);

        const response = await request(app)
            .get('/api/v1/users/search')
            .query({ query: searchQuery })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.users.length >= 1);
        response.body.users.forEach((user: any) => {
            assert.ok(user.username.includes(searchQuery));
        });
    });

    test('should support pagination with page parameter', async () => {
        const { token } = await createUserWithToken('user');
        await createMultipleUsers(35, 'user'); // Create more than page size (30)

        const page1Response = await request(app)
            .get('/api/v1/users/search')
            .query({ page: 1 })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(page1Response.body.users.length, 30);
        assert.strictEqual(page1Response.body.total, 36);

        const page2Response = await request(app)
            .get('/api/v1/users/search')
            .query({ page: 2 })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(page2Response.body.users.length, 6);
        assert.strictEqual(page2Response.body.total, 36);
    });

    test('should support sorting by order_by parameter', async () => {
        const { token } = await createUserWithToken('admin');
        await createMultipleUsers(3, 'user');

        const response = await request(app)
            .get('/api/v1/users/search')
            .query({ order_by: 'username', direction: 'asc' })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.users.length > 0);
        // Verify ascending order
        for (let i = 1; i < response.body.users.length; i++) {
            assert.ok(response.body.users[i].username >= response.body.users[i - 1].username);
        }
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/users/search')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/users/search')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });

    test('should validate query parameters and return 400 for invalid input', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/users/search')
            .query({ page: 'not_a_number' })
            .set('Authorization', `Bearer ${token}`)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });

    test('should work with both Bearer token and cookie authentication', async () => {
        const { token } = await createUserWithToken('user');

        // Test with cookie
        const response = await request(app)
            .get('/api/v1/users/search')
            .set('Cookie', [`token=${token}`])
            .expect(200);

        assert.ok(response.body.users);
    });
});

describe('GET /api/v1/users/:user_id', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return user details with valid user_id', async () => {
        const { token } = await createUserWithToken('user');
        const users = await createMultipleUsers(1, 'user');

        const response = await request(app)
            .get(`/api/v1/users/${users[0]!.userId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.username, users[0]!.username);
        assert.ok(response.body.profile_image_url !== undefined);
        assert.strictEqual(response.body.is_active, true);
    });

    test('should return 400 when user not found', async () => {
        const { token } = await createUserWithToken('user');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .get(`/api/v1/users/${nonExistentId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(400);

        assert.strictEqual(response.body.detail, 'User not found');
    });

    test('should skip to next route when user_id is not UUID format', async () => {
        const { token } = await createUserWithToken('user');

        // "user" is not a UUID, should skip this route
        const response = await request(app)
            .get('/api/v1/users/user')
            .set('Authorization', `Bearer ${token}`);

        // Should match /api/v1/users/user/info or similar route, not 400 from validateUserId
        // If it returns 404, that's expected (route not matched)
        assert.ok(response.status === 200 || response.status === 404);
    });

    test('should return is_active as true (activity tracking not implemented)', async () => {
        const { token, userId } = await createUserWithToken('user');

        const response = await request(app)
            .get(`/api/v1/users/${userId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.is_active, true);
    });

    test('should fail without authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .get(`/api/v1/users/${users[0]!.userId}`)
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .get(`/api/v1/users/${users[0]!.userId}`)
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('GET /api/v1/users/user/settings', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return null when user has no settings', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/users/user/settings')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body, null);
    });

    test('should return user settings when they exist', async () => {
        const { token, userId } = await createUserWithToken('user');

        // Update settings
        const settings = { ui: { theme: 'dark', language: 'en' } };
        await Users.updateUserSettings(userId, settings, db);

        const response = await request(app)
            .get('/api/v1/users/user/settings')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.deepStrictEqual(response.body, settings);
    });

    test('should return settings for authenticated user only', async () => {
        const { token: token1, userId: userId1 } = await createUserWithToken('user');
        const { token: token2, userId: userId2 } = await createUserWithToken('user');

        // Set different settings for both users
        const settings1 = { ui: { theme: 'dark' } };
        const settings2 = { ui: { theme: 'light' } };
        await Users.updateUserSettings(userId1, settings1, db);
        await Users.updateUserSettings(userId2, settings2, db);

        // User 1 should get their own settings
        const response1 = await request(app)
            .get('/api/v1/users/user/settings')
            .set('Authorization', `Bearer ${token1}`)
            .expect(200);

        assert.deepStrictEqual(response1.body, settings1);

        // User 2 should get their own settings
        const response2 = await request(app)
            .get('/api/v1/users/user/settings')
            .set('Authorization', `Bearer ${token2}`)
            .expect(200);

        assert.deepStrictEqual(response2.body, settings2);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/users/user/settings')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/users/user/settings')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('GET /api/v1/users/user/info', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return null when user has no info', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/users/user/info')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body, null);
    });

    test('should return user info when it exists', async () => {
        const { token, userId } = await createUserWithToken('user');

        // Update info
        const info = { bio: 'Test bio', location: 'Test location', customField: 'custom value' };
        await Users.updateUserInfo(userId, info, db);

        const response = await request(app)
            .get('/api/v1/users/user/info')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.deepStrictEqual(response.body, info);
    });

    test('should return info for authenticated user only', async () => {
        const { token: token1, userId: userId1 } = await createUserWithToken('user');
        const { token: token2, userId: userId2 } = await createUserWithToken('user');

        // Set different info for both users
        const info1 = { bio: 'User 1 bio' };
        const info2 = { bio: 'User 2 bio' };
        await Users.updateUserInfo(userId1, info1, db);
        await Users.updateUserInfo(userId2, info2, db);

        // User 1 should get their own info
        const response1 = await request(app)
            .get('/api/v1/users/user/info')
            .set('Authorization', `Bearer ${token1}`)
            .expect(200);

        assert.deepStrictEqual(response1.body, info1);

        // User 2 should get their own info
        const response2 = await request(app)
            .get('/api/v1/users/user/info')
            .set('Authorization', `Bearer ${token2}`)
            .expect(200);

        assert.deepStrictEqual(response2.body, info2);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/users/user/info')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/users/user/info')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('POST /api/v1/users/user/settings/update', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should update user settings with valid data', async () => {
        const { token, userId } = await createUserWithToken('user');

        const settings = { ui: { theme: 'dark', language: 'en' } };

        const response = await request(app)
            .post('/api/v1/users/user/settings/update')
            .set('Authorization', `Bearer ${token}`)
            .send(settings)
            .expect(200);

        assert.deepStrictEqual(response.body, settings);

        // Verify settings were saved to database
        const user = await Users.getUserById(userId, db);
        assert.deepStrictEqual(user?.settings, settings);
    });

    test('should replace existing settings', async () => {
        const { token, userId } = await createUserWithToken('user');

        // Set initial settings
        const initialSettings = { ui: { theme: 'light' } };
        await Users.updateUserSettings(userId, initialSettings, db);

        // Update with new settings
        const newSettings = { ui: { theme: 'dark', language: 'en' } };

        const response = await request(app)
            .post('/api/v1/users/user/settings/update')
            .set('Authorization', `Bearer ${token}`)
            .send(newSettings)
            .expect(200);

        assert.deepStrictEqual(response.body, newSettings);
    });

    test('should accept any valid JSON object as settings', async () => {
        const { token } = await createUserWithToken('user');

        const complexSettings = {
            ui: {
                theme: 'dark',
                sidebar: { collapsed: true },
                customColors: ['#FF0000', '#00FF00'],
            },
            notifications: { enabled: true },
            customField: 'custom value',
        };

        const response = await request(app)
            .post('/api/v1/users/user/settings/update')
            .set('Authorization', `Bearer ${token}`)
            .send(complexSettings)
            .expect(200);

        assert.deepStrictEqual(response.body, complexSettings);
    });

    test('should fail with invalid settings format', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/users/user/settings/update')
            .set('Authorization', `Bearer ${token}`)
            .send('not an object')
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .post('/api/v1/users/user/settings/update')
            .send({ ui: { theme: 'dark' } })
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .post('/api/v1/users/user/settings/update')
            .set('Authorization', 'Bearer invalid_token')
            .send({ ui: { theme: 'dark' } })
            .expect(401);
    });
});

describe('POST /api/v1/users/user/info/update', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should update user info with valid data', async () => {
        const { token, userId } = await createUserWithToken('user');

        const info = { bio: 'Test bio', location: 'Test location' };

        const response = await request(app)
            .post('/api/v1/users/user/info/update')
            .set('Authorization', `Bearer ${token}`)
            .send(info)
            .expect(200);

        assert.deepStrictEqual(response.body, info);

        // Verify info was saved to database
        const user = await Users.getUserById(userId, db);
        assert.deepStrictEqual(user?.info, info);
    });

    test('should replace existing info', async () => {
        const { token, userId } = await createUserWithToken('user');

        // Set initial info
        const initialInfo = { bio: 'Initial bio' };
        await Users.updateUserInfo(userId, initialInfo, db);

        // Update with new info
        const newInfo = { bio: 'Updated bio', location: 'New location' };

        const response = await request(app)
            .post('/api/v1/users/user/info/update')
            .set('Authorization', `Bearer ${token}`)
            .send(newInfo)
            .expect(200);

        assert.deepStrictEqual(response.body, newInfo);
    });

    test('should accept any valid JSON object as info', async () => {
        const { token } = await createUserWithToken('user');

        const complexInfo = {
            bio: 'Test bio',
            location: 'Test location',
            socialLinks: { twitter: '@test', github: 'test' },
            customField: 'custom value',
        };

        const response = await request(app)
            .post('/api/v1/users/user/info/update')
            .set('Authorization', `Bearer ${token}`)
            .send(complexInfo)
            .expect(200);

        assert.deepStrictEqual(response.body, complexInfo);
    });

    test('should allow empty object', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/users/user/info/update')
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(200);

        assert.deepStrictEqual(response.body, {});
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .post('/api/v1/users/user/info/update')
            .send({ bio: 'Test bio' })
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .post('/api/v1/users/user/info/update')
            .set('Authorization', 'Bearer invalid_token')
            .send({ bio: 'Test bio' })
            .expect(401);
    });
});

describe('GET /api/v1/users/:user_id/profile/image', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return 302 redirect for HTTP URL profile images', async () => {
        const profileImage = 'https://example.com/image.png';
        const { token, user } = await createUserWithToken('user', profileImage);

        const response = await request(app)
            .get(`/api/v1/users/${user.id}/profile/image`)
            .set('Authorization', `Bearer ${token}`)
            .expect(302);

        assert.strictEqual(response.headers.location, 'https://example.com/image.png');
    });

    test('should return 302 redirect to default image for missing profile image', async () => {
        const profileImage = '/user.png';
        const { token, user } = await createUserWithToken('user', profileImage);

        const response = await request(app)
            .get(`/api/v1/users/${user.id}/profile/image`)
            .set('Authorization', `Bearer ${token}`)
            .expect(302);

        assert.strictEqual(response.headers.location, '/user.png');
    });

    test('should decode and return data URI images with correct content type', async () => {
        // Simple 1x1 red PNG as data URI
        const profileImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
        const { token, user } = await createUserWithToken('user', profileImage);
        
        const response = await request(app)
            .get(`/api/v1/users/${user.id}/profile/image`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.headers['content-type'], 'image/png');
        assert.ok(response.body.length > 0);
    });

    test('should handle JPEG data URIs correctly', async () => {
        const profileImage = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAIBAQIBAQICAgICAgICAwUDAwMDAwYEBAMFBwYHBwcGBwcICQsJCAgKCAcHCg0KCgsMDAwMBwkODw0MDgsMDAz/2wBDAQICAgMDAwYDAwYMCAcIDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA==';
        const { token, user } = await createUserWithToken('user', profileImage);

        const response = await request(app)
            .get(`/api/v1/users/${user.id}/profile/image`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.headers['content-type'], 'image/jpeg');
    });

    test('should fallback to default image for invalid data URIs', async () => {
        // Invalid data URI (missing data after comma)
        const profileImage = 'data:image/png;base64,';
        const { token, user } = await createUserWithToken('user', profileImage);

        const response = await request(app)
            .get(`/api/v1/users/${user.id}/profile/image`)
            .set('Authorization', `Bearer ${token}`)
            .expect(302);

        assert.strictEqual(response.headers.location, '/user.png');
    });

    test('should fallback to default image for malformed data URIs', async () => {
        // Malformed data URI (no comma separator)
        const profileImage = 'data:image/png;base64';
        const { token, user } = await createUserWithToken('user', profileImage);

        const response = await request(app)
            .get(`/api/v1/users/${user.id}/profile/image`)
            .set('Authorization', `Bearer ${token}`)
            .expect(302);

        assert.strictEqual(response.headers.location, '/user.png');
    });

    test('should return 400 when user not found', async () => {
        const { token } = await createUserWithToken('user');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .get(`/api/v1/users/${nonExistentId}/profile/image`)
            .set('Authorization', `Bearer ${token}`)
            .expect(400);

        assert.strictEqual(response.body.detail, 'User not found');
    });

    test('should fail without authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .get(`/api/v1/users/${users[0]!.userId}/profile/image`)
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .get(`/api/v1/users/${users[0]!.userId}/profile/image`)
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('GET /api/v1/users/', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return paginated user list with admin token', async () => {
        const { token } = await createUserWithToken('admin');
        await createMultipleUsers(5, 'user');

        const response = await request(app)
            .get('/api/v1/users/')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.users);
        assert.ok(Array.isArray(response.body.users));
        assert.strictEqual(response.body.users.length, 6); // 1 admin + 5 users
        assert.strictEqual(response.body.total, 6);

        // Verify response structure includes group_ids (placeholder to make frontend happy)
        const user = response.body.users[0];
        assert.ok(user.id);
        assert.ok(user.username);
        assert.ok(user.role);
    });

    test('should support pagination with page parameter', async () => {
        const { token } = await createUserWithToken('admin');
        await createMultipleUsers(35, 'user'); // Create more than page size (30)

        const page1Response = await request(app)
            .get('/api/v1/users/')
            .query({ page: 1 })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(page1Response.body.users.length, 30);
        assert.strictEqual(page1Response.body.total, 36);

        const page2Response = await request(app)
            .get('/api/v1/users/')
            .query({ page: 2 })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(page2Response.body.users.length, 6);
        assert.strictEqual(page2Response.body.total, 36);
    });

    test('should filter users by query parameter', async () => {
        const { token } = await createUserWithToken('admin');
        const users = await createMultipleUsers(3, 'user');

        // Search for specific username
        const searchQuery = users[0]!.username.substring(0, 5);

        const response = await request(app)
            .get('/api/v1/users/')
            .query({ query: searchQuery })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.users.length >= 1);
        response.body.users.forEach((user: any) => {
            assert.ok(user.username.includes(searchQuery));
        });
    });

    test('should support sorting by order_by and direction parameters', async () => {
        const { token } = await createUserWithToken('admin');
        await createMultipleUsers(3, 'user');

        const response = await request(app)
            .get('/api/v1/users/')
            .query({ order_by: 'username', direction: 'asc' })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.users.length > 0);
        // Verify ascending order
        for (let i = 1; i < response.body.users.length; i++) {
            assert.ok(response.body.users[i].username >= response.body.users[i - 1].username);
        }
    });

    test('should fail with 403 when non-admin user tries to access', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/users/')
            .set('Authorization', `Bearer ${token}`)
            .expect(403);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/users/')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/users/')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });

    test('should validate query parameters and return 400 for invalid input', async () => {
        const { token } = await createUserWithToken('admin');

        const response = await request(app)
            .get('/api/v1/users/')
            .query({ page: 'not_a_number' })
            .set('Authorization', `Bearer ${token}`)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('GET /api/v1/users/all', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return all users without pagination with admin token', async () => {
        const { token } = await createUserWithToken('admin');
        await createMultipleUsers(40, 'user'); // More than typical page size

        const response = await request(app)
            .get('/api/v1/users/all')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.users);
        assert.ok(Array.isArray(response.body.users));
        assert.strictEqual(response.body.users.length, 41); // All users returned
        assert.strictEqual(response.body.total, 41);
    });

    test('should return basic user info structure', async () => {
        const { token } = await createUserWithToken('admin');
        await createMultipleUsers(1, 'user');

        const response = await request(app)
            .get('/api/v1/users/all')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        const user = response.body.users[0];
        assert.ok(user.id);
        assert.ok(user.username);
        assert.ok(user.role);
    });

    test('should fail with 403 when non-admin user tries to access', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/users/all')
            .set('Authorization', `Bearer ${token}`)
            .expect(403);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/users/all')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/users/all')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('POST /api/v1/users/:user_id/update', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should update user role, username, and profile_image_url with admin token', async () => {
        const { token } = await createUserWithToken('admin');
        const targetUser = await createMultipleUsers(1, 'user');

        const updateData = {
            role: 'admin',
            username: 'updated name',
            profile_image_url: 'https://example.com/newimage.png',
        };

        const response = await request(app)
            .post(`/api/v1/users/${targetUser[0]!.userId}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(200);

        assert.strictEqual(response.body.id, targetUser[0]!.userId);
        assert.strictEqual(response.body.role, 'admin');
        assert.strictEqual(response.body.username, 'updated name');
        assert.strictEqual(response.body.profile_image_url, 'https://example.com/newimage.png');

        // Verify database was updated
        const user = await Users.getUserById(targetUser[0]!.userId, db);
        assert.strictEqual(user!.role, 'admin');
        assert.strictEqual(user!.username, 'updated name');
    });

    test('should update user password when password provided', async () => {
        const { token } = await createUserWithToken('admin');
        const targetUser = await createMultipleUsers(1, 'user');

        const updateData = {
            role: 'user',
            username: targetUser[0]!.username,
            profile_image_url: '/user.png',
            password: 'newpassword123',
        };

        await request(app)
            .post(`/api/v1/users/${targetUser[0]!.userId}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(200);

        // Verify password was updated by trying to authenticate
        const auth = await Auths.authenticateUser(targetUser[0]!.username, 'newpassword123', db);
        assert.ok(auth);
        assert.strictEqual(auth!.user.id, targetUser[0]!.userId);
    });

    test('should return 400 when username is already taken by another user', async () => {
        const { token } = await createUserWithToken('admin');
        const users = await createMultipleUsers(2, 'user');

        const updateData = {
            role: 'user',
            username: users[1]!.username, // Try to use second user's username
            profile_image_url: '/user.png',
        };

        const response = await request(app)
            .post(`/api/v1/users/${users[0]!.userId}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(400);

        assert.strictEqual(response.body.detail, 'Username already taken');
    });

    test('should return 403 when trying to modify primary admin', async () => {
        // Create primary admin (first user)
        const primaryAdmin = newUserParams('admin');
        const admin = await Users.createUser(primaryAdmin, db);
        await Auths.createAuth({
            id: admin.id, 
            username: primaryAdmin.username, 
            password: TEST_PASSWORD
        }, db);

        // Create second admin
        const { token } = await createUserWithToken('admin');

        const updateData = {
            role: 'admin',
            username: primaryAdmin.username,
            profile_image_url: '/user.png',
        };

        const response = await request(app)
            .post(`/api/v1/users/${admin.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(403);

        assert.strictEqual(response.body.detail, 'User cannot modify primary admin');
    });

    test('should return 403 when trying to change primary admin role', async () => {
        // Create primary admin (first user)
        const primaryAdmin = newUserParams('admin');
        const admin = await Users.createUser(primaryAdmin, db);
        await Auths.createAuth({
            id: admin.id, 
            username: primaryAdmin.username, 
            password: TEST_PASSWORD
        }, db);
        const token = JWT.createToken(admin.id);

        const updateData = {
            role: 'user', // Try to demote primary admin
            username: primaryAdmin.username,
            profile_image_url: '/user.png',
        };

        const response = await request(app)
            .post(`/api/v1/users/${admin.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(403);

        assert.strictEqual(response.body.detail, 'Cannot change primary admin role');
    });

    test('should return 404 when user not found', async () => {
        const { token } = await createUserWithToken('admin');
        const nonExistentId = crypto.randomUUID();

        const updateData = {
            role: 'user',
            username: 'user',
            profile_image_url: '/user.png',
        };

        const response = await request(app)
            .post(`/api/v1/users/${nonExistentId}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(404);

        assert.strictEqual(response.body.detail, 'User not found');
    });

    test('should fail with 403 when non-admin user tries to update', async () => {
        const { token } = await createUserWithToken('user');
        const targetUser = await createMultipleUsers(1, 'user');

        const updateData = {
            role: 'admin',
            username: targetUser[0]!.username,
            profile_image_url: '/user.png',
        };

        const response = await request(app)
            .post(`/api/v1/users/${targetUser[0]!.userId}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(403);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .post(`/api/v1/users/${users[0]!.userId}/update`)
            .send({ role: 'user', username: 'user', profile_image_url: '/user.png' })
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .post(`/api/v1/users/${users[0]!.userId}/update`)
            .set('Authorization', 'Bearer invalid_token')
            .send({ role: 'user', username: 'user', profile_image_url: '/user.png' })
            .expect(401);
    });

    test('should validate input and return 400 for invalid data', async () => {
        const { token } = await createUserWithToken('admin');
        const targetUser = await createMultipleUsers(1, 'user');

        const invalidData = {
            role: 'invalid_role',
            username: 'user@email.com',
            profile_image_url: '/user.png',
        };

        const response = await request(app)
            .post(`/api/v1/users/${targetUser[0]!.userId}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(invalidData)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('DELETE /api/v1/users/:user_id', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should delete user successfully with admin token', async () => {
        const { token } = await createUserWithToken('admin');
        const targetUser = await createMultipleUsers(1, 'user');

        const response = await request(app)
            .delete(`/api/v1/users/${targetUser[0]!.userId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body, true);

        // Verify user was deleted from database
        const user = await Users.getUserById(targetUser[0]!.userId, db);
        assert.strictEqual(user, null);
    });

    test('should return 403 when trying to delete primary admin', async () => {
        // Create primary admin (first user)
        const primaryAdmin = newUserParams('admin');
        const admin = await Users.createUser(primaryAdmin, db);
        await Auths.createAuth({
            id: admin.id, 
            username: primaryAdmin.username, 
            password: TEST_PASSWORD
        }, db);

        // Create second admin
        const { token } = await createUserWithToken('admin');

        const response = await request(app)
            .delete(`/api/v1/users/${admin.id}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(403);

        assert.strictEqual(response.body.detail, 'Cannot delete primary admin');

        // Verify primary admin still exists
        const user = await Users.getUserById(admin.id, db);
        assert.ok(user);
    });

    test('should return 404 when user not found', async () => {
        const { token } = await createUserWithToken('admin');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .delete(`/api/v1/users/${nonExistentId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(404);

        assert.strictEqual(response.body.detail, 'User not found');
    });

    test('should fail with 403 when non-admin user tries to delete', async () => {
        const { token } = await createUserWithToken('user');
        const targetUser = await createMultipleUsers(1, 'user');

        const response = await request(app)
            .delete(`/api/v1/users/${targetUser[0]!.userId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(403);

        assert.ok(response.body.detail);

        // Verify user was not deleted
        const user = await Users.getUserById(targetUser[0]!.userId, db);
        assert.ok(user);
    });

    test('should fail without authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .delete(`/api/v1/users/${users[0]!.userId}`)
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .delete(`/api/v1/users/${users[0]!.userId}`)
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('GET /api/v1/users/permissions', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return admin permissions for admin user', async () => {
        const { token } = await createUserWithToken('admin');

        const response = await request(app)
            .get('/api/v1/users/permissions')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Verify admin has full workspace permissions
        assert.strictEqual(response.body.workspace.models, true);
        assert.strictEqual(response.body.workspace.knowledge, true);
        assert.strictEqual(response.body.workspace.prompts, true);
        assert.strictEqual(response.body.workspace.tools, true);
        assert.strictEqual(response.body.features.api_keys, true);
        assert.strictEqual(response.body.features.direct_tool_servers, true);

        // Verify structure contains all permission categories
        assert.ok(response.body.workspace);
        assert.ok(response.body.sharing);
        assert.ok(response.body.chat);
        assert.ok(response.body.features);
        assert.ok(response.body.settings);
    });

    test('should return limited permissions for regular user', async () => {
        await createUserWithToken('admin');
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/users/permissions')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Verify regular user has limited workspace permissions
        assert.strictEqual(response.body.workspace.models, false);
        assert.strictEqual(response.body.workspace.knowledge, false);
        assert.strictEqual(response.body.workspace.prompts, false);
        assert.strictEqual(response.body.workspace.tools, false);
        assert.strictEqual(response.body.features.api_keys, false);
        assert.strictEqual(response.body.features.direct_tool_servers, false);

        // Verify user still has some permissions
        assert.strictEqual(response.body.chat.controls, true);
        assert.strictEqual(response.body.settings.interface, true);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/users/permissions')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/users/permissions')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('GET /api/v1/users/default/permissions', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return default permissions config with admin token', async () => {
        const { token } = await createUserWithToken('admin');

        const response = await request(app)
            .get('/api/v1/users/default/permissions')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Verify structure contains all permission categories
        assert.ok(response.body.workspace);
        assert.ok(response.body.sharing);
        assert.ok(response.body.chat);
        assert.ok(response.body.features);
        assert.ok(response.body.settings);

        // Verify default values exist
        assert.ok(typeof response.body.workspace.models === 'boolean');
        assert.ok(typeof response.body.chat.controls === 'boolean');
        assert.ok(typeof response.body.features.folders === 'boolean');
    });

    test('should fail with 403 when non-admin user tries to access', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/users/default/permissions')
            .set('Authorization', `Bearer ${token}`)
            .expect(403);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/users/default/permissions')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/users/default/permissions')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('POST /api/v1/users/default/permissions', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should update default permissions with admin token', async () => {
        const { token } = await createUserWithToken('admin');

        const newPermissions = {
            workspace: {
                models: true,
                knowledge: true,
                prompts: true,
                tools: true,
                models_import: true,
                models_export: true,
                prompts_import: true,
                prompts_export: true,
                tools_import: true,
                tools_export: true,
            },
            sharing: {
                models: true,
                public_models: true,
                knowledge: false,
                public_knowledge: false,
                prompts: false,
                public_prompts: false,
                tools: false,
                public_tools: true,
                notes: false,
                public_notes: true,
            },
            chat: {
                controls: true,
                valves: true,
                system_prompt: true,
                params: true,
                file_upload: true,
                delete: true,
                delete_message: true,
                continue_response: true,
                regenerate_response: true,
                rate_response: true,
                edit: true,
                share: true,
                export: true,
                stt: true,
                tts: true,
                call: true,
                multiple_models: true,
                temporary: true,
                temporary_enforced: false,
            },
            features: {
                api_keys: true,
                notes: true,
                channels: true,
                folders: true,
                direct_tool_servers: true,
                web_search: true,
                image_generation: true,
                code_interpreter: true,
                memories: true,
            },
            settings: {
                interface: true,
            },
        };

        const response = await request(app)
            .post('/api/v1/users/default/permissions')
            .set('Authorization', `Bearer ${token}`)
            .send(newPermissions)
            .expect(200);

        assert.deepStrictEqual(response.body, {});

        // Verify permissions were updated by fetching them
        const getResponse = await request(app)
            .get('/api/v1/users/default/permissions')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(getResponse.body.workspace.models, true);
        assert.strictEqual(getResponse.body.sharing.models, true);
        assert.strictEqual(getResponse.body.features.api_keys, true);
    });

    test('should persist changes across requests', async () => {
        const { token } = await createUserWithToken('admin');

        const newPermissions = {
            workspace: {
                models: true,
                knowledge: true,
                prompts: false,
                tools: false,
                models_import: false,
                models_export: false,
                prompts_import: false,
                prompts_export: false,
                tools_import: false,
                tools_export: false,
            },
            sharing: {
                models: false,
                public_models: false,
                knowledge: false,
                public_knowledge: false,
                prompts: false,
                public_prompts: false,
                tools: false,
                public_tools: false,
                notes: false,
                public_notes: false,
            },
            chat: {
                controls: true,
                valves: true,
                system_prompt: true,
                params: true,
                file_upload: true,
                delete: true,
                delete_message: true,
                continue_response: true,
                regenerate_response: true,
                rate_response: true,
                edit: true,
                share: true,
                export: true,
                stt: true,
                tts: true,
                call: true,
                multiple_models: true,
                temporary: true,
                temporary_enforced: false,
            },
            features: {
                api_keys: false,
                notes: false,
                channels: false,
                folders: true,
                direct_tool_servers: false,
                web_search: true,
                image_generation: false,
                code_interpreter: false,
                memories: false,
            },
            settings: {
                interface: true,
            },
        };

        // Update permissions
        await request(app)
            .post('/api/v1/users/default/permissions')
            .set('Authorization', `Bearer ${token}`)
            .send(newPermissions)
            .expect(200);

        // Fetch again to verify persistence
        const getResponse = await request(app)
            .get('/api/v1/users/default/permissions')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(getResponse.body.workspace.models, true);
        assert.strictEqual(getResponse.body.workspace.knowledge, true);
        assert.strictEqual(getResponse.body.workspace.prompts, false);
    });

    test('should validate input with Zod schema', async () => {
        const { token } = await createUserWithToken('admin');

        const invalidPermissions = {
            workspace: {
                models: 'not_a_boolean', // Invalid type
            },
        };

        const response = await request(app)
            .post('/api/v1/users/default/permissions')
            .set('Authorization', `Bearer ${token}`)
            .send(invalidPermissions)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });

    test('should fail with 403 when non-admin user tries to update', async () => {
        const { token } = await createUserWithToken('user');

        const newPermissions = {
            workspace: {
                models: true,
                knowledge: true,
                prompts: true,
                tools: true,
                models_import: true,
                models_export: true,
                prompts_import: true,
                prompts_export: true,
                tools_import: true,
                tools_export: true,
            },
            sharing: {
                models: false,
                public_models: false,
                knowledge: false,
                public_knowledge: false,
                prompts: false,
                public_prompts: false,
                tools: false,
                public_tools: false,
                notes: false,
                public_notes: false,
            },
            chat: {
                controls: true,
                valves: true,
                system_prompt: true,
                params: true,
                file_upload: true,
                delete: true,
                delete_message: true,
                continue_response: true,
                regenerate_response: true,
                rate_response: true,
                edit: true,
                share: true,
                export: true,
                stt: true,
                tts: true,
                call: true,
                multiple_models: true,
                temporary: true,
                temporary_enforced: false,
            },
            features: {
                api_keys: false,
                notes: false,
                channels: false,
                folders: true,
                direct_tool_servers: false,
                web_search: true,
                image_generation: false,
                code_interpreter: false,
                memories: false,
            },
            settings: {
                interface: true,
            },
        };

        const response = await request(app)
            .post('/api/v1/users/default/permissions')
            .set('Authorization', `Bearer ${token}`)
            .send(newPermissions)
            .expect(403);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .post('/api/v1/users/default/permissions')
            .send({ workspace: { models: true } })
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .post('/api/v1/users/default/permissions')
            .set('Authorization', 'Bearer invalid_token')
            .send({ workspace: { models: true } })
            .expect(401);
    });
});
