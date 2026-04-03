// Client
export { db, type Db, type Tx, type DbOrTx, databasePath, libsqlClient } from './client.js';

// Operations (namespace re-exports)
export * as Auths from './operations/auths.js';
export * as Chats from './operations/chats.js';
export * as Files from './operations/files.js';
export * as Folders from './operations/folders.js';
export * as Models from './operations/models.js';
export * as Users from './operations/users.js';

// Schema (tables + constants)
export * as schema from './schema.js';
export { DEFAULT_USER_ROLE, validateUsername } from './schema.js';

// Utilities
export { currentUnixTimestamp, toUnixTimestamp, fromUnixTimestamp } from './utils.js';

// Errors
export { DatabaseError, RecordCreationError, RecordNotFoundError, ValidationError } from './errors.js';

// Top-level type re-exports (for convenient access)
export type { Chat } from './operations/chats.js';
export type { Folder } from './operations/folders.js';
export type { File } from './operations/files.js';
export type { Model } from './operations/models.js';
export type { User } from './operations/users.js';
