import { eq, ne, desc, asc, or, like, sql } from 'drizzle-orm';
import { db } from '../client.js';
import { users, DEFAULT_USER_ROLE, type User, type UserRole, type UserSettings } from '../schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { validateUsername } from './auths.js';

/* -------------------- CORE CRUD OPERATIONS -------------------- */

/**
 * Parameters for creating a new user.
 * Timestamps are auto-generated and not included as parameters.
 */
export type CreateUserParams = {
    // Required
    id: string;
    username: string;
    role: UserRole;

    // Optional profile fields
    profileImageUrl?: string;
    profileBannerImageUrl?: string;
    info?: Record<string, any>;
    settings?: UserSettings;
};

/**
 * Creates a new user record.
 * Typically combined with auth creation in a transaction.
 *
 * Required fields: id, username, role
 * Auto-generated: createdAt, updatedAt, lastActiveAt, profileImageUrl (defaults to '/user.png')
 */
export async function createUser(
    data: CreateUserParams,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<User> {
    const now = currentUnixTimestamp();

    // Validate and normalize username
    const normalizedUsername = validateUsername(data.username);

    const [user] = await txOrDb
        .insert(users)
        .values({
            ...data,
            username: normalizedUsername,
            createdAt: now,
            updatedAt: now,
            lastActiveAt: now,
            profileImageUrl: data.profileImageUrl ?? '/user.png',
        })
        .returning();

    if (!user) throw new Error('Error creating user record');
    return user;
}

/**
 * Retrieves user by ID.
 */
export async function getUserById(
    id: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<User | null> {
    const [user] = await txOrDb
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

    return user || null;
}

/**
 * Retrieves user by username.
 * Username should be normalized to lowercase before querying.
 */
export async function getUserByUsername(
    username: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<User | null> {
    const normalizedUsername = username.toLowerCase();

    const [user] = await txOrDb
        .select()
        .from(users)
        .where(eq(users.username, normalizedUsername))
        .limit(1);

    return user || null;
}

/**
 * Options for listing users with pagination, filtering, and sorting.
 */
export type GetUsersOptions = {
    query?: string;                                                // Search by username
    role?: UserRole;                                               // Filter by role
    orderBy?: 'role' | 'username' | 'lastActiveAt' | 'createdAt';  // Sort field (default: 'createdAt')
    direction?: 'asc' | 'desc';                                    // Sort direction (default: 'desc')
    skip?: number;                                                 // Offset for pagination
    limit?: number;                                                // Page size (default: 30)
};

/**
 * Lists users with pagination, filtering, and sorting.
 */
export async function getUsers(
    options: GetUsersOptions = {},
    txOrDb: BetterSQLite3Database<any> = db
): Promise<{ users: User[]; total: number }> {
    const {
        query,
        role,
        orderBy = 'createdAt',
        direction = 'desc',
        skip = 0,
        limit = 30,
    } = options;

    // Build where conditions
    const conditions = [];
    if (query) conditions.push(like(users.username, `%${query}%`));
    if (role) conditions.push(eq(users.role, role));

    // Determine sort column
    const sortColumn =
        orderBy === 'role' ? users.role :
        orderBy === 'username' ? users.username :
        orderBy === 'lastActiveAt' ? users.lastActiveAt :
        users.createdAt;

    const sortFn = direction === 'asc' ? asc : desc;

    // Execute query
    const whereClause = conditions.length > 0 ? or(...conditions) : undefined;

    const usersList = await txOrDb
        .select()
        .from(users)
        .where(whereClause)
        .orderBy(sortFn(sortColumn))
        .limit(limit)
        .offset(skip);

    // Get total count
    const countResult = await txOrDb
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(whereClause);

    const total = countResult[0]?.count ?? 0;

    return {
        users: usersList,
        total,
    };
}

/**
 * Updates user fields.
 * Automatically sets updatedAt to current timestamp.
 * Only updates fields that are explicitly provided (not undefined).
 */
export async function updateUser(
    id: string,
    updates: Partial<User>,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<User> {
    // Filter out undefined values to avoid overwriting with NULL
    const filteredUpdates: Partial<User> = { updatedAt: currentUnixTimestamp() };
    
    for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) filteredUpdates[key as keyof User] = value as any;
    }

    const [user] = await txOrDb
        .update(users)
        .set(filteredUpdates)
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new Error('Error updating user record');
    return user;
}

/**
 * Updates user's last activity timestamp.
 * 
 * TODO: Throttle to avoid excessive writes (e.g., max once per minute).
 */
export async function updateLastActive(
    id: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<void> {
    await txOrDb
        .update(users)
        .set({ lastActiveAt: currentUnixTimestamp() })
        .where(eq(users.id, id));
}

/**
 * Deletes user and cascades to auth, chats, files, folders.
 * Protected: Cannot delete primary admin (first user).
 */
export async function deleteUser(
    id: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<boolean> {
    // Protect primary admin from deletion
    const isPrimary = await isPrimaryAdmin(id, txOrDb);
    if (isPrimary) throw new Error('Cannot delete primary admin');

    const result = await txOrDb
        .delete(users)
        .where(eq(users.id, id));

    return result.changes > 0;
}

/* -------------------- USER QUERIES -------------------- */

/**
 * Checks if any users exist in the system.
 * Used to determine if first signup should be admin.
 */
export async function hasUsers(
    txOrDb: BetterSQLite3Database<any> = db
): Promise<boolean> {
    const [result] = await txOrDb
        .select({ exists: sql<number>`1` })
        .from(users)
        .limit(1);

    return result !== undefined;
}

/**
 * Returns the user with the earliest created_at timestamp.
 * Used to identify primary admin for protection logic.
 */
export async function getFirstUser(
    txOrDb: BetterSQLite3Database<any> = db
): Promise<User | null> {
    const [user] = await txOrDb
        .select()
        .from(users)
        .orderBy(asc(users.createdAt))
        .limit(1);

    return user || null;
}

/**
 * Searches users by username (case-insensitive).
 */
export async function searchUsers(
    query: string,
    limit: number = 10,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<User[]> {
    return await txOrDb
        .select()
        .from(users)
        .where(like(users.username, `%${query.toLowerCase()}%`))
        .limit(limit);
}

/* -------------------- SETTINGS & METADATA -------------------- */

/**
 * Updates user's settings object.
 */
export async function updateUserSettings(
    id: string,
    settings: UserSettings,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<UserSettings> {
    const [user] = await txOrDb
        .update(users)
        .set({
            settings,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new Error('Error updating user record');
    return user.settings || {};
}

/**
 * Updates user's custom info object.
 */
export async function updateUserInfo(
    id: string,
    info: Record<string, any>,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<Record<string, any>> {
    const [user] = await txOrDb
        .update(users)
        .set({
            info,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new Error('Error updating user record');
    return user.info || {};
}

/* -------------------- ROLE & PERMISSIONS -------------------- */

/**
 * Updates user's role.
 * Protected: Cannot change primary admin's role from 'admin'.
 */
export async function updateUserRole(
    id: string,
    role: UserRole,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<User> {
    const [user] = await txOrDb
        .update(users)
        .set({
            role,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new Error('Error updating user record');
    return user;
}

/* -------------------- PROFILE OPERATIONS -------------------- */

export type UpdateProfileData = {
    profileImageUrl?: string;
    profileBannerImageUrl?: string;
};

/**
 * Updates user's profile fields.
 * Only updates fields that are explicitly provided (not undefined).
 */
export async function updateProfile(
    id: string,
    profile: UpdateProfileData,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<User> {
    // Filter out undefined values to avoid overwriting with NULL
    const updates: Partial<User> = { updatedAt: currentUnixTimestamp() };

    if (profile.profileImageUrl !== undefined) 
        updates.profileImageUrl = profile.profileImageUrl;
    if (profile.profileBannerImageUrl !== undefined) 
        updates.profileBannerImageUrl = profile.profileBannerImageUrl;

    const [user] = await txOrDb
        .update(users)
        .set(updates)
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new Error('Error updating user record');
    return user;
}

/* -------------------- SPECIAL LOGIC -------------------- */

/**
 * Determines role for new user.
 * First user is admin, subsequent users get DEFAULT_USER_ROLE.
 */
export async function determineRole(
    txOrDb: BetterSQLite3Database<any> = db
): Promise<UserRole> {
    const hasExistingUsers = await hasUsers(txOrDb);
    return hasExistingUsers ? DEFAULT_USER_ROLE : 'admin';
}

/**
 * Checks if user is the primary admin (first user created).
 */
export async function isPrimaryAdmin(
    userId: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<boolean> {
    const firstUser = await getFirstUser(txOrDb);
    return firstUser?.id === userId;
}

/**
 * Checks if actor can modify target user.
 * Other admins cannot modify primary admin.
 */
export async function canModifyUser(
    actorId: string,
    targetId: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<boolean> {
    const isPrimary = await isPrimaryAdmin(targetId, txOrDb);

    if (isPrimary && actorId !== targetId) {
        // Other admins cannot modify primary admin
        return false;
    }

    return true;
}

/* -------------------- TIMESTAMP UTILITIES -------------------- */

/**
 * Returns current timestamp in unix seconds (not milliseconds).
 */
export function currentUnixTimestamp(): number {
    return Math.floor(Date.now() / 1000);
}

/**
 * Converts Date to unix timestamp (seconds).
 */
export function toUnixTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
}

/**
 * Converts unix timestamp (seconds) to Date.
 */
export function fromUnixTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
}

/* -------------------- VALIDATION UTILITIES -------------------- */

/**
 * Validates that a role is one of the allowed values.
 * @throws Error if role is invalid
 */
export function validateRole(role: string): asserts role is UserRole {
    const validRoles: UserRole[] = ['admin', 'user', 'pending'];

    if (!validRoles.includes(role as UserRole)) {
        throw new Error(`Invalid role: ${role}`);
    }
}