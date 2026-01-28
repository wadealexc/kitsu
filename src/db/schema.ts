import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { UserSettings, UserRole } from '../routes/types.js';

/* -------------------- USER TABLE -------------------- */

export const DEFAULT_USER_ROLE: UserRole = 'user';
export const DEFAULT_USER_IMAGE = '/user.png';

export const users = sqliteTable('user', {
    // Identity
    id: text('id').primaryKey().notNull(),
    username: text('username').notNull().unique(),
    role: text('role').$type<UserRole>().notNull().default(DEFAULT_USER_ROLE),

    // Profile
    profileImageUrl: text('profile_image_url').notNull().default(DEFAULT_USER_IMAGE),
    profileBannerImageUrl: text('profile_banner_image_url'),

    // Settings & Metadata (JSON)
    info: text('info', { mode: 'json' }).$type<Record<string, any>>(),
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

export const chats = sqliteTable('chat', {
    // Identity
    id: text('id').primaryKey().notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),

    // Content
    title: text('title').notNull(),
    chat: text('chat', { mode: 'json' }).$type<Record<string, any>>().notNull(),

    // Organization
    folderId: text('folder_id')
        .references(() => folders.id, { onDelete: 'set null' }),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    pinned: integer('pinned', { mode: 'boolean' }).default(false),

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
    index('idx_chat_user_id_pinned').on(table.userId, table.pinned),
    index('idx_chat_user_id_archived').on(table.userId, table.archived),
    index('idx_chat_updated_at_user_id').on(table.updatedAt, table.userId),
    index('idx_chat_folder_id_user_id').on(table.folderId, table.userId),
]);

/* -------------------- CHAT FILE TABLE -------------------- */

export const chatFiles = sqliteTable('chat_file', {
    // Identity
    id: text('id').primaryKey().notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => users.id),
    chatId: text('chat_id')
        .notNull()
        .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: text('message_id'),
    fileId: text('file_id')
        .notNull()
        .references(() => files.id, { onDelete: 'cascade' }),

    // Timestamps (unix seconds)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
}, (table) => [
    uniqueIndex('idx_chat_file_chat_file').on(table.chatId, table.fileId),
    index('idx_chat_file_chat_id').on(table.chatId),
    index('idx_chat_file_user_id').on(table.userId),
    index('idx_chat_file_file_id').on(table.fileId),
]);

/* -------------------- FOLDER TABLE -------------------- */

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
    items: text('items', { mode: 'json' }).$type<Record<string, any>>(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, any>>(),
    data: text('data', { mode: 'json' }).$type<Record<string, any>>(),

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

/* -------------------- FILE TABLE -------------------- */

export const files = sqliteTable('file', {
    // Identity
    id: text('id').primaryKey().notNull(),
    userId: text('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),

    // File Info
    hash: text('hash'),
    filename: text('filename').notNull(),
    path: text('path'),

    // Metadata (JSON)
    data: text('data', { mode: 'json' }).$type<Record<string, any>>(),
    meta: text('meta', { mode: 'json' }).$type<Record<string, any>>(),
    accessControl: text('access_control', { mode: 'json' }).$type<Record<string, any>>(),

    // Timestamps (unix seconds)
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
}, (table) => [
    uniqueIndex('idx_file_id').on(table.id),
    index('idx_file_user_id').on(table.userId),
    index('idx_file_created_at').on(table.createdAt),
    index('idx_file_updated_at').on(table.updatedAt),
    index('idx_file_hash').on(table.hash),
]);

/* -------------------- VALIDATION -------------------- */

/**
 * Validate and normalize username.
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

    // TODO: Temporarily disabled alphanumeric constraint for email-based signup compatibility
    // Once we migrate to proper username-based auth, uncomment these validations:
    //
    // // Format check: alphanumeric + underscore + dash only
    // if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    //     throw new Error('Username can only contain letters, numbers, underscore, and dash');
    // }
    //
    // // Must start with alphanumeric
    // if (!/^[a-zA-Z0-9]/.test(trimmed)) {
    //     throw new Error('Username must start with a letter or number');
    // }

    // Normalize to lowercase for case-insensitive uniqueness
    return trimmed.toLowerCase();
}

/* -------------------- TYPE EXPORTS -------------------- */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Auth = typeof auths.$inferSelect;
export type NewAuth = typeof auths.$inferInsert;

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

export type ChatFile = typeof chatFiles.$inferSelect;
export type NewChatFile = typeof chatFiles.$inferInsert;

export type Folder = typeof folders.$inferSelect;
export type NewFolder = typeof folders.$inferInsert;

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;

