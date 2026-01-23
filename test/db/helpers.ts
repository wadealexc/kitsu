import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../src/db/schema.js';

/**
 * Creates an in-memory SQLite database with the full schema applied.
 * Each test file should create its own database for isolation.
 */
export function createTestDatabase() {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema });

    // Apply schema: Create tables with indexes
    sqlite.exec(`
        CREATE TABLE user (
            id TEXT PRIMARY KEY NOT NULL,
            username TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'pending',
            profile_image_url TEXT NOT NULL DEFAULT '/user.png',
            profile_banner_image_url TEXT,
            info TEXT,
            settings TEXT,
            last_active_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE UNIQUE INDEX idx_user_username ON user(username);
        CREATE INDEX idx_user_role ON user(role);
        CREATE INDEX idx_user_last_active_at ON user(last_active_at);
        CREATE INDEX idx_user_created_at ON user(created_at);

        CREATE TABLE auth (
            id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
            username TEXT NOT NULL UNIQUE,
            password TEXT NOT NULL
        );

        CREATE UNIQUE INDEX idx_auth_username ON auth(username);
    `);

    return db;
}
