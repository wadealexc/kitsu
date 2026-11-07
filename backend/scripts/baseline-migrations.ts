/**
 * One-time: marks migrations as already applied in a database that was created
 * with `drizzle-kit push` (which records no migrations), so the startup migrator
 * only runs the ones after it.
 *
 *   npx tsx scripts/baseline-migrations.ts <path/to/app.db> <last applied tag>
 *   e.g. npx tsx scripts/baseline-migrations.ts data/app.db 0006_opposite_marvel_zombies
 *
 * Records exactly what drizzle's migrator would have (hash of each .sql file and
 * the journal timestamp). Refuses if the database already has migration records,
 * or if a table those migrations create (and the current schema keeps) is missing.
 * Check the schema matches the migrations before running it.
 */
import { createClient } from '@libsql/client';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readFileSync } from 'node:fs';

const [dbPath, lastTag] = process.argv.slice(2);
if (!dbPath || !lastTag) {
    console.error('usage: baseline-migrations.ts <app.db> <last applied migration tag>');
    process.exit(1);
}

const journal = JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8')) as { entries: { idx: number; tag: string; when: number }[] };
const last = journal.entries.find(e => e.tag === lastTag);
if (!last) {
    console.error(`no migration tagged ${lastTag}; tags: ${journal.entries.map(e => e.tag).join(', ')}`);
    process.exit(1);
}

const migrations = readMigrationFiles({ migrationsFolder: './drizzle' })
    .filter(m => m.folderMillis <= last.when);

const client = createClient({ url: `file:${dbPath}` });

const existing = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`);
if (existing.rows.length) {
    const count = await client.execute('SELECT count(*) AS n FROM __drizzle_migrations');
    if (Number(count.rows[0]!.n) > 0) {
        console.error('this database already has migration records; nothing to do');
        process.exit(1);
    }
}

// The tables the current schema expects from these migrations must all be there
const tables = new Set((await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)).rows.map(r => String(r.name)));
for (const expected of ['user', 'auth', 'chat', 'folder', 'model', 'config']) {
    if (!tables.has(expected)) {
        console.error(`table ${expected} is missing: this database doesn't match the migrations`);
        process.exit(1);
    }
}

await client.execute(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
for (const m of migrations) {
    await client.execute({ sql: 'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)', args: [m.hash, m.folderMillis] });
}
console.log(`recorded ${migrations.length} migrations as applied, up to ${lastTag}`);
client.close();
