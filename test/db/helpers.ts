import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import * as Users from '../../src/db/operations/users.js';
import * as Auths from '../../src/db/operations/auths.js';
import * as schema from '../../src/db/schema.js';

/**
 * Creates an in-memory SQLite database with the full schema applied.
 * Each test file should create its own database for isolation.
 *
 * Uses Drizzle's migrate() to apply migration files from ./drizzle folder,
 * ensuring tests stay in sync with src/db/schema.ts.
 *
 * Migration files are generated via: npm run db:generate
 */
export function createTestDatabase() {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });

    // Apply migrations from ./drizzle folder
    migrate(db, { migrationsFolder: './drizzle' });

    return db;
}

export type TestDatabase = ReturnType<typeof createTestDatabase>;

/* -------------------- TEST FIXTURES -------------------- */

let userNonce = 0;

const TEST_PASSWORD = 'password123';

const TEST_ADMIN = newUserParams('admin');
const TEST_USER = newUserParams();

export function newUserParams(role: schema.UserRole = 'user'): Users.CreateUserParams {
    const id = userNonce + '';
    userNonce++;

    return {
        id: id,
        username: `${role}-${id}`,
        role: role,
    }
}

// Create a new test db with a single admin user
export async function newDBWithAdmin() {
    const testDb = createTestDatabase();

    await Users.createUser(TEST_ADMIN, testDb);
    await Auths.createAuth(TEST_ADMIN.id, TEST_ADMIN.username, TEST_PASSWORD, testDb);

    return testDb;
}