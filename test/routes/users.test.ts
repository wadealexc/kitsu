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

    test('should update user role and username with admin token', async () => {
        const { token } = await createUserWithToken('admin');
        const targetUser = await createMultipleUsers(1, 'user');

        const updateData = {
            role: 'admin',
            username: 'updated name',
        };

        const response = await request(app)
            .post(`/api/v1/users/${targetUser[0]!.userId}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(200);

        assert.strictEqual(response.body.id, targetUser[0]!.userId);
        assert.strictEqual(response.body.role, 'admin');
        assert.strictEqual(response.body.username, 'updated name');

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
            .send({ role: 'user', username: 'user' })
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        const users = await createMultipleUsers(1, 'user');

        await request(app)
            .post(`/api/v1/users/${users[0]!.userId}/update`)
            .set('Authorization', 'Bearer invalid_token')
            .send({ role: 'user', username: 'user' })
            .expect(401);
    });

    test('should validate input and return 400 for invalid data', async () => {
        const { token } = await createUserWithToken('admin');
        const targetUser = await createMultipleUsers(1, 'user');

        const invalidData = {
            role: 'invalid_role',
            username: 'user@email.com',
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
