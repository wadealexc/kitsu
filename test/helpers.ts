import assert from 'node:assert';

import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';

import * as JWT from '../src/routes/jwt.js';
import * as Users from '../src/db/operations/users.js';
import * as Auths from '../src/db/operations/auths.js';
import * as Files from '../src/db/operations/files.js';
import * as Chats from '../src/db/operations/chats.js';
import * as Folders from '../src/db/operations/folders.js';
import type { FileMeta, FileData, ChatObject, FolderMeta, FolderData } from '../src/routes/types.js';
import * as schema from '../src/db/schema.js';
import { databasePath } from '../src/db/client.js';
import { db } from '../src/db/client.js';
import type { UserRole } from '../src/routes/types.js';
import { currentUnixTimestamp } from '../src/db/utils.js';

/**
 * Creates an in-memory SQLite database with the full schema applied.
 * Each test file should create its own database for isolation.
 *
 * Uses Drizzle's migrate() to apply migration files from ./drizzle folder,
 * ensuring tests stay in sync with src/db/schema.ts.
 *
 * Migration files are generated via: npm run db:generate
 */
export async function createTestDatabase() {
    const client = createClient({ url: ':memory:' });
    const db = drizzle(client, { schema });

    // Apply migrations from ./drizzle folder
    await migrate(db, { migrationsFolder: './drizzle' });

    return db;
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

/* -------------------- TEST FIXTURES -------------------- */

export const TEST_PASSWORD = 'password123';

const TEST_ADMIN = newUserParams('admin');

export function newUserParams(role: UserRole = 'user'): Users.NewUser {
    return {
        username: `${role}-${crypto.randomUUID()}`,
        role: role,
    }
}

// Create a new test db with a single admin user
export async function newDBWithAdmin() {
    const testDb = await createTestDatabase();

    const admin = await Users.createUser(TEST_ADMIN, testDb);
    await Auths.createAuth({
        id: admin.id, 
        username: TEST_ADMIN.username, 
        password: TEST_PASSWORD
    }, testDb);

    return testDb;
}

/**
 * Create a test user and return JWT token
 */
export async function createUserWithToken(role: UserRole = 'user', profileImageUrl?: string): Promise<{ 
    userId: string;
    token: string;
    user: Users.User;
}> {
    const userParams = newUserParams(role);
    if (profileImageUrl) userParams.profileImageUrl = profileImageUrl;

    const user = await Users.createUser(userParams, db);
    await Auths.createAuth({
        id: user.id, 
        username: userParams.username, 
        password: TEST_PASSWORD
    }, db);
    
    const token = JWT.createToken(user.id);

    assert.strictEqual(user.role, role);
    return { 
        userId: user.id, 
        token,
        user,
    };
}

/**
 * Creates a minimal FileForm for testing.
 */
export function createTestFileForm(
    userId: string,
    filename: string = 'test-file.pdf',
    meta?: FileMeta,
    data: FileData = { },
): Files.NewFile {
    return {
        userId: userId,
        filename: filename,
        path: `${crypto.randomUUID()}_${filename}`,
        meta: meta || {
            name: filename,
            contentType: '',
            size: 0,
        },
        data: data,
    };
}

/**
 * Creates a minimal ChatObject for testing.
 */
export function createTestChatObject(
    title: string = 'Test Chat',
    model: string = 'test-model',
): ChatObject {
    return {
        title: title,
        model: model,
        history: {
            messages: {},
            currentId: null,
        },
        messages: [],
        timestamp: currentUnixTimestamp(),
    };
}

/**
 * Creates a NewChat for testing.
 */
export function createTestChatData(title: string = 'Test Chat', folderId: string | null = null): Chats.NewChat {
    return {
        title,
        chat: createTestChatObject(title),
        folderId,
    };
}

/**
 * Creates a minimal FolderForm for testing.
 */
export function createTestFolderForm(
    userId: string,
    name: string = 'Test Folder',
    parentId?: string,
    meta?: FolderMeta,
    data?: FolderData
): Folders.NewFolder {
    const newFolder: Folders.NewFolder = {
        userId,
        name: name,
        meta: meta,
        data: data,
    };

    if (parentId) newFolder.parentId = parentId;
    return newFolder;
}

/* -------------------- TEST SAFETY -------------------- */

/**
 * Assert that the global db from client.ts is in-memory.
 * This prevents tests from accidentally modifying the production database.
 *
 * @throws {Error} if the database is not in-memory
 */
export function assertInMemoryDatabase(): void {
    // Check if the database path is :memory:
    if (databasePath !== 'file::memory:?cache=shared') {
        throw new Error(
            `SAFETY CHECK FAILED: Database is not in-memory (path: ${databasePath}). ` +
            'Tests must use in-memory database to prevent modifying production data. ' +
            'Set NODE_ENV=test to use in-memory database.'
        );
    }
}