import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import type { Client } from '@libsql/client';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';

const isTest = process.env.NODE_ENV === 'test';

let client: Client;
let dbPath: string;

if (isTest) {
    // Use shared in-memory database for tests
    // Using 'file::memory:?cache=shared' allows the same in-memory DB to be accessed
    // across different connections (e.g., migrations and route handlers)
    dbPath = 'file::memory:?cache=shared';
    client = createClient({ url: dbPath });
    console.warn('⚠️  WARNING: Using in-memory database for testing');
} else {
    // Use on-disk database for production
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    dbPath = path.join(dataDir, 'app.db');
    client = createClient({ url: `file:${dbPath}` });

    console.log(`Database initialized at: ${dbPath}`);
}

// Create Drizzle instance with schema
export const db = drizzle(client, { schema });

// Export the client and DB path for testing assertions
export const libsqlClient = client;
export const databasePath = dbPath;
