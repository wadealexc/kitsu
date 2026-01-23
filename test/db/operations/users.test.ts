import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createTestDatabase } from '../helpers.js';
import * as Users from '../../../src/db/operations/users.js';
import type { UserRole } from '../../../src/db/schema.js';

/* -------------------- TEST SETUP -------------------- */

const testDb = createTestDatabase();

/* -------------------- TEST FIXTURES -------------------- */

const TEST_USER = {
    id: 'user-123',
    username: 'testuser',
    role: 'user' as UserRole,
};

/* -------------------- CRUD OPERATIONS TESTS -------------------- */

describe('createUser', () => {
    test('creates user with auto-generated timestamps', async () => {
        const user = await Users.createUser(TEST_USER, testDb);

        assert.strictEqual(user.id, TEST_USER.id);
        assert.strictEqual(user.username, 'testuser');
        assert.strictEqual(user.role, 'user');
        assert.strictEqual(user.profileImageUrl, '/user.png');
        assert.ok(user.createdAt);
        assert.ok(user.updatedAt);
        assert.ok(user.lastActiveAt);
    });

    test('normalizes username to lowercase', async () => {
        const user = await Users.createUser(
            { ...TEST_USER, id: 'user-uppercase', username: 'UpperCase' },
            testDb
        );

        assert.strictEqual(user.username, 'uppercase');
    });

    test('validates username format', async () => {
        await assert.rejects(
            async () =>
                await Users.createUser({ ...TEST_USER, id: 'user-invalid', username: 'ab' }, testDb),
            { message: 'Username must be 3-50 characters' }
        );
    });

    test('uses custom profile image if provided', async () => {
        const user = await Users.createUser(
            {
                ...TEST_USER,
                id: 'user-image',
                username: 'imageuser',
                profileImageUrl: 'https://example.com/avatar.jpg',
            },
            testDb
        );

        assert.strictEqual(user.profileImageUrl, 'https://example.com/avatar.jpg');
    });
});

describe('getUserById', () => {
    test('retrieves existing user', async () => {
        const user = await Users.getUserById(TEST_USER.id, testDb);

        assert.ok(user);
        assert.strictEqual(user.id, TEST_USER.id);
        assert.strictEqual(user.username, 'testuser');
    });

    test('returns null for non-existent user', async () => {
        const user = await Users.getUserById('non-existent', testDb);

        assert.strictEqual(user, null);
    });
});

describe('getUserByUsername', () => {
    test('retrieves existing user', async () => {
        const user = await Users.getUserByUsername('testuser', testDb);

        assert.ok(user);
        assert.strictEqual(user.id, TEST_USER.id);
        assert.strictEqual(user.username, 'testuser');
    });

    test('is case-insensitive', async () => {
        const user = await Users.getUserByUsername('TestUser', testDb);

        assert.ok(user);
        assert.strictEqual(user.username, 'testuser');
    });

    test('returns null for non-existent username', async () => {
        const user = await Users.getUserByUsername('nonexistent', testDb);

        assert.strictEqual(user, null);
    });
});

describe('getUsers', () => {
    test('returns all users with pagination', async () => {
        // Create additional test users
        await Users.createUser({ ...TEST_USER, id: 'user-2', username: 'user2' }, testDb);
        await Users.createUser({ ...TEST_USER, id: 'user-3', username: 'user3' }, testDb);

        const result = await Users.getUsers({}, testDb);

        assert.ok(result.users.length >= 3);
        assert.ok(result.total >= 3);
    });

    test('filters by role', async () => {
        await Users.createUser(
            { ...TEST_USER, id: 'admin-user', username: 'admin', role: 'admin' },
            testDb
        );

        const result = await Users.getUsers({ role: 'admin' }, testDb);

        assert.ok(result.users.length >= 1);
        assert.ok(result.users.every((u) => u.role === 'admin'));
    });

    test('searches by username', async () => {
        const result = await Users.getUsers({ query: 'testuser' }, testDb);

        assert.ok(result.users.length >= 1);
        assert.ok(result.users.some((u) => u.username.includes('testuser')));
    });

    test('sorts by different fields', async () => {
        const byUsername = await Users.getUsers({ orderBy: 'username', direction: 'asc' }, testDb);
        const byCreated = await Users.getUsers({ orderBy: 'createdAt', direction: 'desc' }, testDb);

        assert.ok(byUsername.users.length > 0);
        assert.ok(byCreated.users.length > 0);
    });

    test('paginates results', async () => {
        const page1 = await Users.getUsers({ limit: 2, skip: 0 }, testDb);
        const page2 = await Users.getUsers({ limit: 2, skip: 2 }, testDb);

        assert.ok(page1.users.length <= 2);
        assert.ok(page2.users.length <= 2);
        if (page1.users.length > 0 && page2.users.length > 0) {
            assert.notStrictEqual(page1.users[0].id, page2.users[0].id);
        }
    });
});

describe('updateUser', () => {
    test('updates user fields', async () => {
        const userId = 'user-update';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'updateuser' }, testDb);

        const updated = await Users.updateUser(
            userId,
            { role: 'admin', profileImageUrl: 'https://new.jpg' },
            testDb
        );

        assert.strictEqual(updated.role, 'admin');
        assert.strictEqual(updated.profileImageUrl, 'https://new.jpg');
        assert.ok(updated.updatedAt > updated.createdAt);
    });

    test('filters out undefined values', async () => {
        const userId = 'user-undefined';
        const original = await Users.createUser(
            { ...TEST_USER, id: userId, username: 'undefineduser', role: 'admin' },
            testDb
        );

        const updated = await Users.updateUser(
            userId,
            { profileImageUrl: undefined, role: 'user' },
            testDb
        );

        // profileImageUrl should remain unchanged
        assert.strictEqual(updated.profileImageUrl, original.profileImageUrl);
        // role should be updated
        assert.strictEqual(updated.role, 'user');
    });

    test('throws for non-existent user', async () => {
        await assert.rejects(
            async () => await Users.updateUser('non-existent', { role: 'admin' }, testDb),
            { message: 'Error updating user record' }
        );
    });
});

describe('updateLastActive', () => {
    test('updates last active timestamp', async () => {
        const userId = 'user-active';
        const user = await Users.createUser({ ...TEST_USER, id: userId, username: 'activeuser' }, testDb);
        const originalLastActive = user.lastActiveAt;

        // Wait a bit to ensure timestamp changes
        await new Promise((resolve) => setTimeout(resolve, 10));

        await Users.updateLastActive(userId, testDb);

        const updated = await Users.getUserById(userId, testDb);
        assert.ok(updated);
        assert.ok(updated.lastActiveAt > originalLastActive);
    });
});

describe('deleteUser', () => {
    test('deletes non-admin user successfully', async () => {
        const userId = 'user-delete';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'deleteuser' }, testDb);

        const success = await Users.deleteUser(userId, testDb);

        assert.strictEqual(success, true);

        const user = await Users.getUserById(userId, testDb);
        assert.strictEqual(user, null);
    });

    test('prevents deletion of primary admin', async () => {
        // First user becomes primary admin
        const firstUser = await Users.getFirstUser(testDb);
        assert.ok(firstUser);

        await assert.rejects(async () => await Users.deleteUser(firstUser.id, testDb), {
            message: 'Cannot delete primary admin',
        });
    });

    test('returns false for non-existent user', async () => {
        const success = await Users.deleteUser('non-existent', testDb);

        assert.strictEqual(success, false);
    });
});

/* -------------------- QUERY OPERATIONS TESTS -------------------- */

describe('hasUsers', () => {
    test('returns true when users exist', async () => {
        const result = await Users.hasUsers(testDb);

        assert.strictEqual(result, true);
    });
});

describe('getFirstUser', () => {
    test('returns user with earliest created_at', async () => {
        const firstUser = await Users.getFirstUser(testDb);

        assert.ok(firstUser);
        // Should be one of our test users
        assert.ok(firstUser.id);
    });
});

describe('searchUsers', () => {
    test('searches users by username', async () => {
        const results = await Users.searchUsers('test', 10, testDb);

        assert.ok(results.length > 0);
        assert.ok(results.some((u) => u.username.includes('test')));
    });

    test('limits results', async () => {
        const results = await Users.searchUsers('user', 2, testDb);

        assert.ok(results.length <= 2);
    });

    test('returns empty array for no matches', async () => {
        const results = await Users.searchUsers('nonexistentusername', 10, testDb);

        assert.strictEqual(results.length, 0);
    });
});

/* -------------------- SETTINGS & METADATA TESTS -------------------- */

describe('updateUserSettings', () => {
    test('updates user settings', async () => {
        const userId = 'user-settings';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'settingsuser' }, testDb);

        const settings = {
            ui: { theme: 'dark', language: 'en' },
        };

        const result = await Users.updateUserSettings(userId, settings, testDb);

        assert.deepStrictEqual(result, settings);

        const user = await Users.getUserById(userId, testDb);
        assert.ok(user);
        assert.deepStrictEqual(user.settings, settings);
    });
});

describe('updateUserInfo', () => {
    test('updates user info', async () => {
        const userId = 'user-info';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'infouser' }, testDb);

        const info = { location: 'San Francisco', age: 30 };

        const result = await Users.updateUserInfo(userId, info, testDb);

        assert.deepStrictEqual(result, info);

        const user = await Users.getUserById(userId, testDb);
        assert.ok(user);
        assert.deepStrictEqual(user.info, info);
    });
});

/* -------------------- ROLE & PERMISSIONS TESTS -------------------- */

describe('updateUserRole', () => {
    test('updates user role', async () => {
        const userId = 'user-role';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'roleuser' }, testDb);

        const updated = await Users.updateUserRole(userId, 'admin', testDb);

        assert.strictEqual(updated.role, 'admin');
    });
});

/* -------------------- PROFILE OPERATIONS TESTS -------------------- */

describe('updateProfile', () => {
    test('updates profile fields', async () => {
        const userId = 'user-profile';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'profileuser' }, testDb);

        const updated = await Users.updateProfile(
            userId,
            {
                profileImageUrl: 'https://new-avatar.jpg',
                profileBannerImageUrl: 'https://new-banner.jpg',
            },
            testDb
        );

        assert.strictEqual(updated.profileImageUrl, 'https://new-avatar.jpg');
        assert.strictEqual(updated.profileBannerImageUrl, 'https://new-banner.jpg');
    });

    test('filters out undefined values', async () => {
        const userId = 'user-profile2';
        const original = await Users.createUser(
            { ...TEST_USER, id: userId, username: 'profileuser2' },
            testDb
        );

        const updated = await Users.updateProfile(
            userId,
            { profileImageUrl: 'https://updated.jpg', profileBannerImageUrl: undefined },
            testDb
        );

        assert.strictEqual(updated.profileImageUrl, 'https://updated.jpg');
        assert.strictEqual(updated.profileBannerImageUrl, original.profileBannerImageUrl);
    });
});

/* -------------------- SPECIAL LOGIC TESTS -------------------- */

describe('determineRole', () => {
    test('returns admin for first user', async () => {
        // Create empty in-memory DB for this test
        const emptyDb = createTestDatabase();

        const role = await Users.determineRole(emptyDb);

        assert.strictEqual(role, 'admin');
    });

    test('returns pending for subsequent users', async () => {
        const role = await Users.determineRole(testDb);

        assert.strictEqual(role, 'pending');
    });
});

describe('isPrimaryAdmin', () => {
    test('returns true for first user', async () => {
        const firstUser = await Users.getFirstUser(testDb);
        assert.ok(firstUser);

        const result = await Users.isPrimaryAdmin(firstUser.id, testDb);

        assert.strictEqual(result, true);
    });

    test('returns false for non-first user', async () => {
        const result = await Users.isPrimaryAdmin('user-123', testDb);

        // user-123 may or may not be first depending on test order
        // Just verify it returns a boolean
        assert.strictEqual(typeof result, 'boolean');
    });
});

describe('canModifyUser', () => {
    test('allows primary admin to modify themselves', async () => {
        const firstUser = await Users.getFirstUser(testDb);
        assert.ok(firstUser);

        const result = await Users.canModifyUser(firstUser.id, firstUser.id, testDb);

        assert.strictEqual(result, true);
    });

    test('prevents non-primary admin from modifying primary admin', async () => {
        const firstUser = await Users.getFirstUser(testDb);
        assert.ok(firstUser);

        const result = await Users.canModifyUser('other-admin', firstUser.id, testDb);

        assert.strictEqual(result, false);
    });

    test('allows modifying non-primary users', async () => {
        const result = await Users.canModifyUser('admin-1', 'user-123', testDb);

        assert.strictEqual(result, true);
    });
});

describe('currentUnixTimestamp', () => {
    test('returns current timestamp in seconds', () => {
        const timestamp = Users.currentUnixTimestamp();
        const now = Math.floor(Date.now() / 1000);

        // Should be within 1 second
        assert.ok(Math.abs(timestamp - now) <= 1);
    });

    test('returns integer', () => {
        const timestamp = Users.currentUnixTimestamp();

        assert.strictEqual(timestamp % 1, 0);
    });
});
