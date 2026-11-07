import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { StringValue } from 'ms';
import type {
    UserSettings,
    UserRole,
    ChatObject,
    FolderMeta,
    FolderData,
    ModelParams,
    ModelMeta,
} from '../routes/types/index.js';

/* -------------------- USER TABLE -------------------- */

export const DEFAULT_USER_ROLE: UserRole = 'user';

/**
 * The user table stores user profile information, settings, permissions, and metadata.
 * It is the root table for a user; deleting a user from this table will cascade
 * deletion to their auth, chats, files, folders, etc.
 */
export const users = sqliteTable('user', {
    // Identity
    id: text('id').primaryKey().notNull(),
    username: text('username').notNull().unique(),
    role: text('role').$type<UserRole>().notNull(),

    // Settings & Metadata (JSON)
    settings: text('settings', { mode: 'json' }).$type<UserSettings>(),

    // Timestamps (unix seconds)
    lastActiveAt: integer('last_active_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    createdAt: integer('created_at').notNull(),
}, (table) => [
    uniqueIndex('idx_user_username').on(table.username),
    index('idx_user_role').on(table.role),
    index('idx_user_last_active_at').on(table.lastActiveAt),
    index('idx_user_created_at').on(table.createdAt),
]);

/* -------------------- AUTH TABLE -------------------- */

/**
 * The auth table stores authentication credentials (username and password) for users. 
 * It has a 1:1 relationship with users via the `id` field.
 */
export const auths = sqliteTable('auth', {
    id: text('id')
        .primaryKey()
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    username: text('username').notNull().unique(),
    password: text('password').notNull(),
}, (table) => [
    uniqueIndex('idx_auth_username').on(table.username),
]);

/* -------------------- CHAT TABLE -------------------- */

/**
 * The chat table stores conversation data, including message history, metadata, and sharing information.
 */
export const chats = sqliteTable('chat', {
    // Identity
    id: text('id').primaryKey().notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),

    // Content
    title: text('title').notNull(),
    chat: text('chat', { mode: 'json' }).$type<ChatObject>().notNull(),

    // Organization
    folderId: text('folder_id')
        .references(() => folders.id, { onDelete: 'set null' }),

    // Metadata
    meta: text('meta', { mode: 'json' }).$type<Record<string, any>>().default({}),
    shareId: text('share_id'),

    // Timestamps (unix seconds)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
}, (table) => [
    uniqueIndex('idx_chat_id').on(table.id),
    uniqueIndex('idx_chat_share_id').on(table.shareId),
    index('idx_chat_user_id').on(table.userId),
    index('idx_chat_folder_id').on(table.folderId),
    index('idx_chat_created_at').on(table.createdAt),
    index('idx_chat_updated_at').on(table.updatedAt),
    index('idx_chat_updated_at_user_id').on(table.updatedAt, table.userId),
    index('idx_chat_folder_id_user_id').on(table.folderId, table.userId),
]);

/* -------------------- FOLDER TABLE -------------------- */

/**
 * The file table stores hierarchical folder structures for organizing chats. Folders 
 * support parent-child relationships, allowing users to create nested folder trees. 
 * 
 * Each folder is user-scoped and can contain chats and other folders.
 * 
 * Folders maintain UI state (expansion), custom metadata, and flexible data payloads.
 */
export const folders = sqliteTable('folder', {
    // Identity
    id: text('id').primaryKey().notNull(),
    parentId: text('parent_id')
        .references((): any => folders.id, { onDelete: 'cascade' }),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),

    // Content
    name: text('name').notNull(),

    // Metadata (JSON)
    meta: text('meta', { mode: 'json' }).$type<FolderMeta>(),
    data: text('data', { mode: 'json' }).$type<FolderData>(),

    // UI State
    isExpanded: integer('is_expanded', { mode: 'boolean' }).notNull().default(false),

    // Timestamps (unix seconds)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
}, (table) => [
    uniqueIndex('idx_folder_id').on(table.id),
    index('idx_folder_user_id').on(table.userId),
    index('idx_folder_parent_id').on(table.parentId),
    index('idx_folder_parent_id_user_id').on(table.parentId, table.userId),
    index('idx_folder_user_id_parent_id_name').on(table.userId, table.parentId, table.name),
    index('idx_folder_created_at').on(table.createdAt),
    index('idx_folder_updated_at').on(table.updatedAt),
]);

/* -------------------- MODEL TABLE -------------------- */

export const models = sqliteTable('model', {
    // Identity
    id: text('id').primaryKey().notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),

    // Model Reference
    baseModelId: text('base_model_id').notNull(),

    // Content
    name: text('name').notNull(),

    // Configuration (JSON)
    params: text('params', { mode: 'json' }).$type<ModelParams>().notNull(),
    meta: text('meta', { mode: 'json' }).$type<ModelMeta>().notNull(),
    isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true),

    // Status
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),

    // Timestamps (unix seconds)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
}, (table) => [
    uniqueIndex('idx_model_id').on(table.id),
    index('idx_model_user_id').on(table.userId),
    index('idx_model_base_model_id').on(table.baseModelId),
    index('idx_model_is_active').on(table.isActive),
    index('idx_model_user_base').on(table.userId, table.baseModelId),
    index('idx_model_created_at').on(table.createdAt),
    index('idx_model_updated_at').on(table.updatedAt),
    index('idx_model_base_updated').on(table.baseModelId, table.updatedAt),
]);

/* -------------------- CONFIG TABLE -------------------- */

/**
 * The config table stores system-wide configuration settings.
 * Uses a single-row pattern with CHECK constraint to enforce id = 1.
 */
export const config = sqliteTable('config', {
    id: integer('id').primaryKey().notNull().default(1),
    name: text('name').notNull().default('kitsu'),
    enableSignup: integer('enable_signup', { mode: 'boolean' }).notNull().default(true),
    defaultUserRole: text('default_user_role').$type<UserRole>().notNull().default(DEFAULT_USER_ROLE),
    jwtExpiresIn: text('jwt_expires_in').$type<StringValue>().notNull().default('7d'),
    updatedAt: integer('updated_at').notNull(),
}, (table) => [
    // Enforce single-row pattern
    check('config_id_check', sql`${table.id} = 1`),
]);

/* -------------------- VALIDATION -------------------- */

/**  
 * Validate and normalize username.  
 * - Length: 3-50 characters  
 * - Characters: Alphanumeric + underscore + dash + space only
 * - Normalized to lowercase for consistency
 * 
 * @param username - Username to validate  
 * @returns Normalized username (lowercase, trimmed)  
 * @throws {Error} if username is invalid  
 */  
export function validateUsername(username: string): string {  
    const trimmed = username.trim();  
  
    // Length check: 3-50 characters  
    if (trimmed.length < 3 || trimmed.length > 50) {  
        throw new Error('Username must be 3-50 characters');  
    }  
  
    // Format check: alphanumeric + underscore + dash + space only  
    if (!/^[a-zA-Z0-9_ -]+$/.test(trimmed)) {  
        throw new Error('Username can only contain letters, numbers, underscore, dash, and space');  
    }  
  
    // Must start with alphanumeric (space not allowed at start)  
    if (!/^[a-zA-Z0-9]/.test(trimmed)) {  
        throw new Error('Username must start with a letter or number');  
    }  
  
    // Normalize to lowercase for case-insensitive uniqueness  
    return trimmed.toLowerCase();  
}  

/* -------------------- MCP SERVER TABLE -------------------- */

/**
 * MCP servers an admin has added. Their tools are offered to every chat; users
 * turn each server on or off per chat.
 */
export const mcpServers = sqliteTable('mcp_server', {
    id: text('id').primaryKey().notNull(),
    name: text('name').notNull().unique(),
    url: text('url').notNull(),
    // Sent as `Authorization: Bearer <token>`. Never returned by the API.
    token: text('token'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),

    // Timestamps (unix seconds)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
});
