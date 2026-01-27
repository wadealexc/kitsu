import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/* -------------------- USER TABLE -------------------- */

export type UserRole = 'admin' | 'user' | 'pending';
export const DEFAULT_USER_ROLE: UserRole = 'user';
export const DEFAULT_USER_IMAGE = '/user.png';

export type UserSettings = {
    ui?: Record<string, any>;
    // TODO: See /docs/extra.md for full UserSettings specification with source locations
};

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

