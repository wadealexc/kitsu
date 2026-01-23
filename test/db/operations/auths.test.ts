import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createTestDatabase } from '../helpers.js';
import * as Auths from '../../../src/db/operations/auths.js';
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

const TEST_PASSWORD = 'password123';

/* -------------------- CRUD OPERATIONS TESTS -------------------- */

describe('createAuth', () => {
    test('creates auth record with hashed password', async () => {
        // Create user first (required for FK constraint)
        await Users.createUser(TEST_USER, testDb);

        const auth = await Auths.createAuth(
            TEST_USER.id,
            TEST_USER.username,
            TEST_PASSWORD,
            testDb
        );

        assert.strictEqual(auth.id, TEST_USER.id);
        assert.strictEqual(auth.username, 'testuser');
        assert.ok(auth.password.startsWith('$2'));
        assert.notStrictEqual(auth.password, TEST_PASSWORD);
    });

    test('normalizes username to lowercase', async () => {
        const userId = 'user-uppercase';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'UpperCase' }, testDb);

        const auth = await Auths.createAuth(userId, 'UpperCase', TEST_PASSWORD, testDb);

        assert.strictEqual(auth.username, 'uppercase');
    });

    test('rejects invalid username', async () => {
        const userId = 'user-invalid';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'valid123' }, testDb);

        await assert.rejects(
            async () => await Auths.createAuth(userId, 'ab', TEST_PASSWORD, testDb),
            { message: 'Username must be 3-50 characters' }
        );
    });

    test('rejects invalid password', async () => {
        const userId = 'user-badpw';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'badpw' }, testDb);

        await assert.rejects(
            async () => await Auths.createAuth(userId, 'badpw', 'short', testDb),
            { message: 'Password too short (min 8 characters)' }
        );
    });
});

describe('getAuthById', () => {
    test('retrieves existing auth', async () => {
        const auth = await Auths.getAuthById(TEST_USER.id, testDb);

        assert.ok(auth);
        assert.strictEqual(auth.id, TEST_USER.id);
        assert.strictEqual(auth.username, 'testuser');
    });

    test('returns null for non-existent auth', async () => {
        const auth = await Auths.getAuthById('non-existent', testDb);

        assert.strictEqual(auth, null);
    });
});

describe('getAuthByUsername', () => {
    test('retrieves existing auth', async () => {
        const auth = await Auths.getAuthByUsername('testuser', testDb);

        assert.ok(auth);
        assert.strictEqual(auth.id, TEST_USER.id);
        assert.strictEqual(auth.username, 'testuser');
    });

    test('is case-insensitive', async () => {
        const auth = await Auths.getAuthByUsername('TestUser', testDb);

        assert.ok(auth);
        assert.strictEqual(auth.username, 'testuser');
    });

    test('returns null for non-existent username', async () => {
        const auth = await Auths.getAuthByUsername('nonexistent', testDb);

        assert.strictEqual(auth, null);
    });
});

describe('updatePassword', () => {
    test('updates password successfully', async () => {
        const newPassword = 'newpassword123';
        const success = await Auths.updatePassword(TEST_USER.id, newPassword, testDb);

        assert.strictEqual(success, true);

        // Verify old password doesn't work
        const auth = await Auths.getAuthById(TEST_USER.id, testDb);
        assert.ok(auth);
        const oldValid = await Auths.verifyPassword(TEST_PASSWORD, auth.password);
        assert.strictEqual(oldValid, false);

        // Verify new password works
        const newValid = await Auths.verifyPassword(newPassword, auth.password);
        assert.strictEqual(newValid, true);
    });

    test('validates password format', async () => {
        await assert.rejects(
            async () => await Auths.updatePassword(TEST_USER.id, 'short', testDb),
            { message: 'Password too short (min 8 characters)' }
        );
    });

    test('returns false for non-existent user', async () => {
        const success = await Auths.updatePassword('non-existent', 'newpassword123', testDb);

        assert.strictEqual(success, false);
    });
});

describe('updateUsername', () => {
    test('updates username successfully', async () => {
        const userId = 'user-rename';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'oldname' }, testDb);
        await Auths.createAuth(userId, 'oldname', TEST_PASSWORD, testDb);

        const success = await Auths.updateUsername(userId, 'newname', testDb);

        assert.strictEqual(success, true);

        const auth = await Auths.getAuthById(userId, testDb);
        assert.ok(auth);
        assert.strictEqual(auth.username, 'newname');
    });

    test('normalizes username to lowercase', async () => {
        const userId = 'user-rename2';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'original' }, testDb);
        await Auths.createAuth(userId, 'original', TEST_PASSWORD, testDb);

        await Auths.updateUsername(userId, 'NewName', testDb);

        const auth = await Auths.getAuthById(userId, testDb);
        assert.ok(auth);
        assert.strictEqual(auth.username, 'newname');
    });

    test('validates username format', async () => {
        await assert.rejects(
            async () => await Auths.updateUsername(TEST_USER.id, 'ab', testDb),
            { message: 'Username must be 3-50 characters' }
        );
    });
});

describe('deleteAuth', () => {
    test('deletes auth successfully', async () => {
        const userId = 'user-delete';
        await Users.createUser({ ...TEST_USER, id: userId, username: 'deleteuser' }, testDb);
        await Auths.createAuth(userId, 'deleteuser', TEST_PASSWORD, testDb);

        const success = await Auths.deleteAuth(userId, testDb);

        assert.strictEqual(success, true);

        const auth = await Auths.getAuthById(userId, testDb);
        assert.strictEqual(auth, null);
    });

    test('returns false for non-existent auth', async () => {
        const success = await Auths.deleteAuth('non-existent', testDb);

        assert.strictEqual(success, false);
    });
});

/* -------------------- AUTHENTICATION TESTS -------------------- */

describe('authenticateUser', () => {
    test('authenticates with valid credentials', async () => {
        const userId = 'user-auth';
        const username = 'authuser';
        const password = 'authpassword';

        await Users.createUser({ ...TEST_USER, id: userId, username }, testDb);
        await Auths.createAuth(userId, username, password, testDb);

        const result = await Auths.authenticateUser(username, password, testDb);

        assert.ok(result);
        assert.strictEqual(result.user.id, userId);
        assert.strictEqual(result.user.username, username);
        assert.strictEqual(result.auth.id, userId);
        assert.strictEqual(result.auth.username, username);
    });

    test('is case-insensitive for username', async () => {
        const result = await Auths.authenticateUser('AuthUser', 'authpassword', testDb);

        assert.ok(result);
        assert.strictEqual(result.user.username, 'authuser');
    });

    test('returns null for non-existent username', async () => {
        const result = await Auths.authenticateUser('nonexistent', 'password123', testDb);

        assert.strictEqual(result, null);
    });

    test('returns null for incorrect password', async () => {
        const result = await Auths.authenticateUser('authuser', 'wrongpassword', testDb);

        assert.strictEqual(result, null);
    });
});

/* -------------------- VALIDATION TESTS -------------------- */

describe('validateUsername', () => {
    test('accepts valid usernames', () => {
        assert.strictEqual(Auths.validateUsername('john'), 'john');
        assert.strictEqual(Auths.validateUsername('john_doe'), 'john_doe');
        assert.strictEqual(Auths.validateUsername('john-doe'), 'john-doe');
        assert.strictEqual(Auths.validateUsername('john123'), 'john123');
    });

    test('normalizes to lowercase', () => {
        assert.strictEqual(Auths.validateUsername('JohnDoe'), 'johndoe');
        assert.strictEqual(Auths.validateUsername('ADMIN'), 'admin');
    });

    test('rejects too short usernames', () => {
        assert.throws(() => Auths.validateUsername('ab'), {
            message: 'Username must be 3-50 characters',
        });
    });

    test('rejects too long usernames', () => {
        const longUsername = 'a'.repeat(51);
        assert.throws(() => Auths.validateUsername(longUsername), {
            message: 'Username must be 3-50 characters',
        });
    });

    test('rejects invalid characters', () => {
        assert.throws(() => Auths.validateUsername('john@doe'), {
            message: 'Username can only contain letters, numbers, underscore, and dash',
        });
        assert.throws(() => Auths.validateUsername('john.doe'), {
            message: 'Username can only contain letters, numbers, underscore, and dash',
        });
    });

    test('rejects usernames starting with special char', () => {
        assert.throws(() => Auths.validateUsername('_john'), {
            message: 'Username must start with a letter or number',
        });
        assert.throws(() => Auths.validateUsername('-john'), {
            message: 'Username must start with a letter or number',
        });
    });
});

describe('validatePasswordFormat', () => {
    test('accepts valid passwords', () => {
        assert.doesNotThrow(() => Auths.validatePasswordFormat('password123'));
        assert.doesNotThrow(() => Auths.validatePasswordFormat('a'.repeat(72)));
    });

    test('rejects too short passwords', () => {
        assert.throws(() => Auths.validatePasswordFormat('short'), {
            message: 'Password too short (min 8 characters)',
        });
    });

    test('rejects too long passwords', () => {
        const longPassword = 'a'.repeat(73);
        assert.throws(() => Auths.validatePasswordFormat(longPassword), {
            message: 'Password too long (max 72 bytes)',
        });
    });
});

/* -------------------- PASSWORD HASHING TESTS -------------------- */

describe('hashPassword and verifyPassword', () => {
    test('hashes password correctly', async () => {
        const hash = await Auths.hashPassword('password123');
        assert.ok(hash);
        assert.ok(hash.startsWith('$2'));
        assert.notStrictEqual(hash, 'password123');
    });

    test('verifies correct password', async () => {
        const hash = await Auths.hashPassword('password123');
        const isValid = await Auths.verifyPassword('password123', hash);
        assert.strictEqual(isValid, true);
    });

    test('rejects incorrect password', async () => {
        const hash = await Auths.hashPassword('password123');
        const isValid = await Auths.verifyPassword('wrongpassword', hash);
        assert.strictEqual(isValid, false);
    });

    test('produces different hashes for same password', async () => {
        const hash1 = await Auths.hashPassword('password123');
        const hash2 = await Auths.hashPassword('password123');
        assert.notStrictEqual(hash1, hash2);
    });
});