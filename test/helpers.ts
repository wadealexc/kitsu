import assert from 'node:assert';

import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { migrate } from 'drizzle-orm/libsql/migrator';

import * as JWT from '../src/routes/jwt.js';
import * as Users from '../src/db/operations/users.js';
import * as Auths from '../src/db/operations/auths.js';
import * as schema from '../src/db/schema.js';
import { databasePath } from '../src/db/client.js';
import { db } from '../src/db/client.js';
import type { UserRole } from '../src/routes/types.js';

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
        username: `${role}-${crypto.randomUUID()}@gg.com`,
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