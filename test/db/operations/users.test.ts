import { describe, test, before } from 'node:test';
import assert from 'node:assert';

import { createTestDatabase, newDBWithAdmin, newUserParams, type TestDatabase } from '../../helpers.js';
import * as Users from '../../../src/db/operations/users.js';
import type { User } from '../../../src/db/operations/users.js';
import { currentUnixTimestamp } from '../../../src/db/utils.js';

/* -------------------- CRUD OPERATIONS TESTS -------------------- */

describe('createUser', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('creates user with auto-generated timestamps', async () => {
        const user = await Users.createUser(newUserParams(), db);

        assert.strictEqual(user.role, 'user');
        assert.strictEqual(user.profileImageUrl, '/static/user.png');
        assert.ok(user.createdAt);
        assert.ok(user.updatedAt);
        assert.ok(user.lastActiveAt);
    });

    test('normalizes username to lowercase', async () => {
        const user = await Users.createUser(
            { ...newUserParams(), username: 'UpperCase' },
            db
        );

        assert.strictEqual(user.username, 'uppercase');
    });

    test('validates username format', async () => {
        await assert.rejects(
            async () =>
                await Users.createUser({ ...newUserParams(), username: 'ab' }, db),
            { message: 'Username must be 3-50 characters' }
        );
    });

    test('uses custom profile image if provided', async () => {
        const user = await Users.createUser(
            {
                ...newUserParams(),
                profileImageUrl: 'https://example.com/avatar.jpg',
            },
            db
        );

        assert.strictEqual(user.profileImageUrl, 'https://example.com/avatar.jpg');
    });
});

describe('getUserById', () => {
    let db: TestDatabase;
    let testUser: User;

    before(async () => {
        db = await newDBWithAdmin();
        testUser = await Users.createUser(newUserParams(), db);
    });

    test('retrieves existing user', async () => {
        const user = await Users.getUserById(testUser.id, db);

        assert.ok(user);
        assert.strictEqual(user.id, testUser.id);
        assert.strictEqual(user.username, testUser.username);
    });

    test('returns null for non-existent user', async () => {
        const user = await Users.getUserById('non-existent', db);

        assert.strictEqual(user, null);
    });
});

describe('getUserByUsername', () => {
    let db: TestDatabase;
    let testUser: User;

    before(async () => {
        db = await newDBWithAdmin();
        testUser = await Users.createUser(newUserParams(), db);
    });

    test('retrieves existing user', async () => {
        const user = await Users.getUserByUsername(testUser.username, db);

        assert.ok(user);
        assert.strictEqual(user.id, testUser.id);
        assert.strictEqual(user.username, testUser.username);
    });

    test('is case-insensitive', async () => {
        const user = await Users.getUserByUsername(testUser.username.toUpperCase(), db);

        assert.ok(user);
        assert.strictEqual(user.username, testUser.username);
    });

    test('returns null for non-existent username', async () => {
        const user = await Users.getUserByUsername('nonexistent', db);

        assert.strictEqual(user, null);
    });
});

describe('getUsers', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
        // Create additional test users
        await Users.createUser(newUserParams(), db);
        await Users.createUser(newUserParams(), db);
        await Users.createUser(newUserParams('admin'), db);
    });

    test('returns all users with pagination', async () => {
        const result = await Users.getUsers({}, db);

        assert.ok(result.users.length >= 3);
        assert.ok(result.total >= 3);
    });

    test('filters by role', async () => {
        const result = await Users.getUsers({ role: 'admin' }, db);

        assert.ok(result.users.length >= 1);
        assert.ok(result.users.every((u) => u.role === 'admin'));
    });

    test('searches by username', async () => {
        const result = await Users.getUsers({ query: 'user' }, db);

        assert.ok(result.users.length >= 1);
        assert.ok(result.users.some((u) => u.username.includes('user')));
    });

    test('sorts by different fields', async () => {
        const byUsername = await Users.getUsers({ orderBy: 'username', direction: 'asc' }, db);
        const byCreated = await Users.getUsers({ orderBy: 'created_at', direction: 'desc' }, db);

        assert.ok(byUsername.users.length > 0);
        assert.ok(byCreated.users.length > 0);
    });

    test('paginates results', async () => {
        const page1 = await Users.getUsers({ limit: 2, skip: 0 }, db);
        const page2 = await Users.getUsers({ limit: 2, skip: 2 }, db);

        assert.ok(page1.users.length <= 2);
        assert.ok(page2.users.length <= 2);
        if (page1.users.length > 0 && page2.users.length > 0) {
            assert.notStrictEqual(page1.users[0]!.id, page2.users[0]!.id);
        }
    });
});

describe('updateUser', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('updates user fields', async () => {
        const user = await Users.createUser(newUserParams(), db);

        const updated = await Users.updateUser(
            user.id,
            { role: 'admin', profileImageUrl: 'https://new.jpg' },
            db
        );

        assert.strictEqual(updated.role, 'admin');
        assert.strictEqual(updated.profileImageUrl, 'https://new.jpg');
        assert.ok(updated.updatedAt >= updated.createdAt);
    });

    test('filters out undefined values', async () => {
        const original = await Users.createUser(
            { ...newUserParams(), role: 'admin' },
            db
        );

        const updated = await Users.updateUser(
            original.id,
            { profileImageUrl: undefined, role: 'user' },
            db
        );

        // profileImageUrl should remain unchanged
        assert.strictEqual(updated.profileImageUrl, original.profileImageUrl);
        // role should be updated
        assert.strictEqual(updated.role, 'user');
    });

    test('throws for non-existent user', async () => {
        await assert.rejects(
            async () => await Users.updateUser('non-existent', { role: 'admin' }, db),
            { message: `user record with id 'non-existent' not found` }
        );
    });
});

describe('updateLastActive', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('updates last active timestamp', async () => {
        const user = await Users.createUser(newUserParams(), db);
        const originalLastActive = user.lastActiveAt;

        // Wait a bit to ensure timestamp changes
        await new Promise((resolve) => setTimeout(resolve, 10));

        await Users.updateLastActive(user.id, db);

        const updated = await Users.getUserById(user.id, db);
        assert.ok(updated);
        assert.ok(updated.lastActiveAt >= originalLastActive);
    });
});

describe('deleteUser', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    // TODO - test cascading behavior

    test('deletes non-admin user successfully', async () => {
        const user = await Users.createUser(newUserParams(), db);

        await Users.deleteUser(user.id, db);

        const retrieved = await Users.getUserById(user.id, db);
        assert.strictEqual(retrieved, null);
    });

    test('prevents deletion of primary admin', async () => {
        // First user becomes primary admin
        const firstUser = await Users.getFirstUser(db);
        assert.ok(firstUser);

        await assert.rejects(async () => await Users.deleteUser(firstUser.id, db), {
            message: 'Cannot delete primary admin',
        });
    });

    test('throws for non-existent user', async () => {
        await assert.rejects(
            async () => await Users.deleteUser('non-existent', db), 
            { message: `user record with id 'non-existent' not found` }
        );
    });
});

/* -------------------- QUERY OPERATIONS TESTS -------------------- */

describe('getFirstUser', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('returns user with earliest created_at', async () => {
        const firstUser = await Users.getFirstUser(db);

        assert.ok(firstUser);
        // Should be the admin user created in newDBWithAdmin
        assert.strictEqual(firstUser.role, 'admin');
    });
});

/* -------------------- SETTINGS & METADATA TESTS -------------------- */

describe('updateUserSettings', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('updates user settings', async () => {
        const user = await Users.createUser(newUserParams(), db);

        const settings = {
            ui: { theme: 'dark', language: 'en' },
        };

        const result = await Users.updateUserSettings(user.id, settings, db);

        assert.deepStrictEqual(result, settings);

        const retrieved = await Users.getUserById(user.id, db);
        assert.ok(retrieved);
        assert.deepStrictEqual(retrieved.settings, settings);
    });
});

describe('updateUserInfo', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('updates user info', async () => {
        const user = await Users.createUser(newUserParams(), db);

        const info = { location: 'San Francisco', age: 30 };

        const result = await Users.updateUserInfo(user.id, info, db);

        assert.deepStrictEqual(result, info);

        const retrieved = await Users.getUserById(user.id, db);
        assert.ok(retrieved);
        assert.deepStrictEqual(retrieved.info, info);
    });
});

/* -------------------- PROFILE OPERATIONS TESTS -------------------- */

describe('updateProfile', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('updates profile fields', async () => {
        const user = await Users.createUser(newUserParams(), db);

        const updated = await Users.updateProfile(
            user.id,
            {
                profileImageUrl: 'https://new-avatar.jpg',
                profileBannerImageUrl: 'https://new-banner.jpg',
            },
            db
        );

        assert.strictEqual(updated.profileImageUrl, 'https://new-avatar.jpg');
        assert.strictEqual(updated.profileBannerImageUrl, 'https://new-banner.jpg');
    });

    test('filters out undefined values', async () => {
        const original = await Users.createUser(newUserParams(), db);

        const updated = await Users.updateProfile(
            original.id,
            { profileImageUrl: 'https://updated.jpg', profileBannerImageUrl: undefined },
            db
        );

        assert.strictEqual(updated.profileImageUrl, 'https://updated.jpg');
        assert.strictEqual(updated.profileBannerImageUrl, original.profileBannerImageUrl);
    });
});

/* -------------------- SPECIAL LOGIC TESTS -------------------- */

describe('determineRole', () => {
    test('returns admin for first user', async () => {
        // Create empty in-memory DB for this test
        const emptyDb = await createTestDatabase();

        const role = await Users.determineRole(emptyDb);

        assert.strictEqual(role, 'admin');
    });

    test('returns pending for subsequent users', async () => {
        const db = await newDBWithAdmin();

        const role = await Users.determineRole(db);

        assert.strictEqual(role, 'user');
    });
});

describe('isPrimaryAdmin', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('returns true for first user', async () => {
        const firstUser = await Users.getFirstUser(db);
        assert.ok(firstUser);

        const result = await Users.isPrimaryAdmin(firstUser.id, db);

        assert.strictEqual(result, true);
    });

    test('returns false for non-first user', async () => {
        const otherUser = await Users.createUser(newUserParams(), db);

        const result = await Users.isPrimaryAdmin(otherUser.id, db);

        assert.strictEqual(result, false);
    });
});
