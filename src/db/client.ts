import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';

const isTest = process.env.NODE_ENV === 'test';

let sqlite: Database.Database;
let dbPath: string;

if (isTest) {
    // Use in-memory database for tests
    dbPath = ':memory:';
    sqlite = new Database(dbPath);
    console.warn('⚠️  WARNING: Using in-memory database for testing');
} else {
    // Use on-disk database for production
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    dbPath = path.join(dataDir, 'app.db');
    sqlite = new Database(dbPath);

    // Enable WAL mode for better concurrency (on-disk only)
    sqlite.pragma('journal_mode = WAL');

    console.log(`Database initialized at: ${dbPath}`);
}

// Create Drizzle instance with schema
export const db = drizzle(sqlite, { schema });

// Export the underlying SQLite instance for testing assertions
export const sqliteInstance: Database.Database = sqlite;
