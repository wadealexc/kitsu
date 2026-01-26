import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { createTestDatabase, newDBWithAdmin, newUserParams, TEST_PASSWORD, type TestDatabase } from '../helpers.js';
import * as Auths from '../../../src/db/operations/auths.js';
import * as Users from '../../../src/db/operations/users.js';
import { validateUsername, type Auth } from '../../../src/db/schema.js';

/* -------------------- CRUD OPERATIONS TESTS -------------------- */

describe('createAuth', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('creates auth record with hashed password', async () => {
        const user = await Users.createUser(newUserParams(), db);

        const auth = await Auths.createAuth(
            user.id,
            user.username,
            TEST_PASSWORD,
            db
        );

        assert.strictEqual(auth.id, user.id);
        assert.strictEqual(auth.username, user.username);
        assert.ok(auth.password.startsWith('$2'));
        assert.notStrictEqual(auth.password, TEST_PASSWORD);
    });

    test('normalizes username to lowercase', async () => {
        const user = await Users.createUser({ ...newUserParams(), username: 'UpperCase' }, db);
        const auth = await Auths.createAuth(user.id, 'UpperCase', TEST_PASSWORD, db);

        assert.strictEqual(auth.username, 'uppercase');
    });

    test('rejects invalid username', async () => {
        const user = await Users.createUser(newUserParams(), db);

        await assert.rejects(
            async () => await Auths.createAuth(user.id, 'ab', TEST_PASSWORD, db),
            { message: 'Username must be 3-50 characters' }
        );
    });

    test('rejects invalid password', async () => {
        const user = await Users.createUser(newUserParams(), db);

        await assert.rejects(
            async () => await Auths.createAuth(user.id, user.username, 'short', db),
            { message: 'Password too short (min 8 characters)' }
        );
    });
});

describe('getAuthById', () => {
    let db: TestDatabase;
    let testAuth: Auth;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testAuth = await Auths.createAuth(user.id, user.username, TEST_PASSWORD, db);
    });

    test('retrieves existing auth', async () => {
        const auth = await Auths.getAuthById(testAuth.id, db);

        assert.ok(auth);
        assert.strictEqual(auth.id, testAuth.id);
        assert.strictEqual(auth.username, testAuth.username);
    });

    test('returns null for non-existent auth', async () => {
        const auth = await Auths.getAuthById('non-existent', db);

        assert.strictEqual(auth, null);
    });
});

describe('getAuthByUsername', () => {
    let db: TestDatabase;
    let testAuth: Auth;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testAuth = await Auths.createAuth(user.id, user.username, TEST_PASSWORD, db);
    });

    test('retrieves existing auth', async () => {
        const auth = await Auths.getAuthByUsername(testAuth.username, db);

        assert.ok(auth);
        assert.strictEqual(auth.id, testAuth.id);
        assert.strictEqual(auth.username, testAuth.username);
    });

    test('is case-insensitive', async () => {
        const auth = await Auths.getAuthByUsername(testAuth.username.toUpperCase(), db);

        assert.ok(auth);
        assert.strictEqual(auth.username, testAuth.username);
    });

    test('returns null for non-existent username', async () => {
        const auth = await Auths.getAuthByUsername('nonexistent', db);

        assert.strictEqual(auth, null);
    });
});

describe('updatePassword', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('updates password successfully', async () => {
        const user = await Users.createUser(newUserParams(), db);
        await Auths.createAuth(user.id, user.username, TEST_PASSWORD, db);

        const newPassword = 'newpassword123';
        const success = await Auths.updatePassword(user.id, newPassword, db);

        assert.strictEqual(success, true);

        // Verify old password doesn't work
        const auth = await Auths.getAuthById(user.id, db);
        assert.ok(auth);
        const oldValid = await Auths.verifyPassword(TEST_PASSWORD, auth.password);
        assert.strictEqual(oldValid, false);

        // Verify new password works
        const newValid = await Auths.verifyPassword(newPassword, auth.password);
        assert.strictEqual(newValid, true);
    });

    test('validates password format', async () => {
        const user = await Users.createUser(newUserParams(), db);
        await Auths.createAuth(user.id, user.username, TEST_PASSWORD, db);

        await assert.rejects(
            async () => await Auths.updatePassword(user.id, 'short', db),
            { message: 'Password too short (min 8 characters)' }
        );
    });

    test('returns false for non-existent user', async () => {
        const success = await Auths.updatePassword('non-existent', 'newpassword123', db);

        assert.strictEqual(success, false);
    });
});

describe('updateUsername', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('updates username successfully', async () => {
        const user = await Users.createUser({ ...newUserParams(), username: 'oldname' }, db);
        await Auths.createAuth(user.id, 'oldname', TEST_PASSWORD, db);

        const success = await Auths.updateUsername(user.id, 'newname', db);

        assert.strictEqual(success, true);

        const auth = await Auths.getAuthById(user.id, db);
        assert.ok(auth);
        assert.strictEqual(auth.username, 'newname');
    });

    test('normalizes username to lowercase', async () => {
        const user = await Users.createUser({ ...newUserParams(), username: 'original' }, db);
        await Auths.createAuth(user.id, 'original', TEST_PASSWORD, db);

        await Auths.updateUsername(user.id, 'NewUsername', db);

        const auth = await Auths.getAuthById(user.id, db);
        assert.ok(auth);
        assert.strictEqual(auth.username, 'newusername');
    });

    test('validates username format', async () => {
        const user = await Users.createUser(newUserParams(), db);
        await Auths.createAuth(user.id, user.username, TEST_PASSWORD, db);

        await assert.rejects(
            async () => await Auths.updateUsername(user.id, 'ab', db),
            { message: 'Username must be 3-50 characters' }
        );
    });
});

describe('deleteAuth', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('deletes auth successfully', async () => {
        const user = await Users.createUser(newUserParams(), db);
        await Auths.createAuth(user.id, user.username, TEST_PASSWORD, db);

        const success = await Auths.deleteAuth(user.id, db);

        assert.strictEqual(success, true);

        const auth = await Auths.getAuthById(user.id, db);
        assert.strictEqual(auth, null);
    });

    test('returns false for non-existent auth', async () => {
        const success = await Auths.deleteAuth('non-existent', db);

        assert.strictEqual(success, false);
    });
});

/* -------------------- AUTHENTICATION TESTS -------------------- */

describe('authenticateUser', () => {
    let db: TestDatabase;

    before(async () => {
        db = await newDBWithAdmin();
    });

    test('authenticates with valid credentials', async () => {
        const password = 'authpassword';
        const user = await Users.createUser(newUserParams(), db);
        await Auths.createAuth(user.id, user.username, password, db);

        const result = await Auths.authenticateUser(user.username, password, db);

        assert.ok(result);
        assert.strictEqual(result.user.id, user.id);
        assert.strictEqual(result.user.username, user.username);
        assert.strictEqual(result.auth.id, user.id);
        assert.strictEqual(result.auth.username, user.username);
    });

    test('is case-insensitive for username', async () => {
        const password = 'testpassword';
        const user = await Users.createUser(newUserParams(), db);
        await Auths.createAuth(user.id, user.username, password, db);

        const result = await Auths.authenticateUser(user.username.toUpperCase(), password, db);

        assert.ok(result);
        assert.strictEqual(result.user.username, user.username);
    });

    test('returns null for non-existent username', async () => {
        const result = await Auths.authenticateUser('nonexistent', 'password123', db);

        assert.strictEqual(result, null);
    });

    test('returns null for incorrect password', async () => {
        const user = await Users.createUser(newUserParams(), db);
        await Auths.createAuth(user.id, user.username, 'correctpassword', db);

        const result = await Auths.authenticateUser(user.username, 'wrongpassword', db);

        assert.strictEqual(result, null);
    });
});

/* -------------------- VALIDATION TESTS -------------------- */

describe('validateUsername', () => {
    test('accepts valid usernames', () => {
        assert.strictEqual(validateUsername('john'), 'john');
        assert.strictEqual(validateUsername('john_doe'), 'john_doe');
        assert.strictEqual(validateUsername('john-doe'), 'john-doe');
        assert.strictEqual(validateUsername('john123'), 'john123');
    });

    test('normalizes to lowercase', () => {
        assert.strictEqual(validateUsername('JohnDoe'), 'johndoe');
        assert.strictEqual(validateUsername('ADMIN'), 'admin');
    });

    test('rejects too short usernames', () => {
        assert.throws(() => validateUsername('ab'), {
            message: 'Username must be 3-50 characters',
        });
    });

    test('rejects too long usernames', () => {
        const longUsername = 'a'.repeat(51);
        assert.throws(() => validateUsername(longUsername), {
            message: 'Username must be 3-50 characters',
        });
    });

    // TODO: Re-enable these tests once alphanumeric constraint is restored
    // (currently disabled for email-based signup compatibility)
    //
    // test('rejects invalid characters', () => {
    //     assert.throws(() => validateUsername('john@doe'), {
    //         message: 'Username can only contain letters, numbers, underscore, and dash',
    //     });
    //     assert.throws(() => validateUsername('john.doe'), {
    //         message: 'Username can only contain letters, numbers, underscore, and dash',
    //     });
    // });
    //
    // test('rejects usernames starting with special char', () => {
    //     assert.throws(() => validateUsername('_john'), {
    //         message: 'Username must start with a letter or number',
    //     });
    //     assert.throws(() => validateUsername('-john'), {
    //         message: 'Username must start with a letter or number',
    //     });
    // });
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