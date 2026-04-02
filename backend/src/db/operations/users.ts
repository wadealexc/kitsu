import { eq, ne, desc, asc, or, like, sql, count } from 'drizzle-orm';

import { db, type DbOrTx } from '../client.js';
import { users, validateUsername, DEFAULT_USER_ROLE } from '../schema.js';
import type { UserSettings, UserRole } from '../../routes/types.js';
import { currentUnixTimestamp } from '../utils.js';
import { DatabaseError, RecordCreationError, RecordNotFoundError } from '../errors.js';

const TABLE = 'user';

/* -------------------- CREATE -------------------- */

export type User = typeof users.$inferSelect;
export type NewUser = Omit<
    typeof users.$inferInsert,
    'id' | 'lastActiveAt' | 'createdAt' | 'updatedAt'
>;

/**
 * Creates a new user record.
 * @note Caller should combine with auth creation in a transaction
 *
 * @param {NewUser} params - username and role
 * @param txOrDb
 * 
 * @returns the created User record
 * 
 * @throws if username format validation fails
 * @throws if record creation fails
 */
export async function createUser(
    params: NewUser,
    txOrDb: DbOrTx = db
): Promise<User> {
    const normalizedUsername = validateUsername(params.username);
    
    const now = currentUnixTimestamp();
    const userId = crypto.randomUUID();

    const [user] = await txOrDb
        .insert(users)
        .values({
            ...params,
            id: userId,
            username: normalizedUsername,
            createdAt: now,
            updatedAt: now,
            lastActiveAt: now,
        })
        .returning();

    if (!user) throw new RecordCreationError(TABLE);
    return user;
}

/* -------------------- UPDATE -------------------- */

export type UpdateUser = Partial<NewUser>;

/**
 * Updates user record. Also automatically updates `updatedAt`.
 * @note This is intended for admin-only access. Caller should validate that the user
 * modification is valid (e.g. not modifying primary admin role).
 * 
 * @param id - User id
 * @param {UpdateUser} params - fields to update. Only explicitly provided fields are updated.
 * @param txOrDb
 * 
 * @returns the updated User record
 * 
 * @throws if attempting to update username to an invalid username
 * @throws if record update fails
 */
export async function updateUser(
    id: string,
    params: UpdateUser,
    txOrDb: DbOrTx = db
): Promise<User> {
    // Validate new username if provided
    if (params.username) 
        params.username = validateUsername(params.username);

    const [user] = await txOrDb
        .update(users)
        .set({
            ...params,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new RecordNotFoundError(TABLE, id);
    return user;
}

/**
 * Updates user's last activity timestamp.
 * 
 * @param id - User id
 * @param txOrDb
 * 
 * @throws if record update fails
 */
export async function updateLastActive(
    id: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    await txOrDb
        .update(users)
        .set({ lastActiveAt: currentUnixTimestamp() })
        .where(eq(users.id, id));
}

/**
 * Update user's settings object.
 * 
 * @param id - User id
 * @param settings
 * @param txOrDb
 * 
 * @returns the updated UserSettings
 * 
 * @throws if record update fails
 */
export async function updateUserSettings(
    id: string,
    settings: UserSettings,
    txOrDb: DbOrTx = db
): Promise<UserSettings> {
    const [user] = await txOrDb
        .update(users)
        .set({
            settings,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new RecordNotFoundError(TABLE, id);
    if (!user.settings) throw new DatabaseError('Settings not found after update');
    return user.settings;
}

/**
 * Update user's info object.
 * 
 * @param id - User id
 * @param info
 * @param txOrDb
 * 
 * @returns the updated user info object
 * 
 * @throws if record update fails
 */
export async function updateUserInfo(
    id: string,
    info: Record<string, any>,
    txOrDb: DbOrTx = db
): Promise<Record<string, any>> {
    const [user] = await txOrDb
        .update(users)
        .set({
            info,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new RecordNotFoundError(TABLE, id);
    return user.info || {};
}

export type UpdateUserProfile = {
    username?: string;
};

/**
 * Update user's username and/or profile image
 * 
 * @param id - User id
 * @param {UpdateUserProfile} params
 * @param txOrDb
 * 
 * @returns the updated User record
 * 
 * @throws if record update fails
 */
export async function updateProfile(
    id: string,
    params: UpdateUserProfile,
    txOrDb: DbOrTx = db
): Promise<User> {
    const [user] = await txOrDb
        .update(users)
        .set({
            ...params,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(users.id, id))
        .returning();

    if (!user) throw new RecordNotFoundError(TABLE, id);
    return user;
}

/* -------------------- DELETE -------------------- */

/**
 * Delete user record, automatically cascading deletion to auth, chats, files, etc.
 * @note This method explicitly checks that the target for deletion is not the primary
 * admin. Any other checks are the responsibility of the caller.
 * 
 * @param id 
 * @param txOrDb 
 * 
 * @throws if attempting to delete the primary admin
 * @throws if deletion fails
 */
export async function deleteUser(
    id: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    // Protect primary admin from deletion
    const isPrimary = await isPrimaryAdmin(id, txOrDb);
    if (isPrimary) throw new DatabaseError('Cannot delete primary admin');

    const result = await txOrDb
        .delete(users)
        .where(eq(users.id, id));

    if (result.rowsAffected === 0) throw new RecordNotFoundError(TABLE, id);
}

/* -------------------- READ -------------------- */

/**
 * Retrieves user by ID.
 * 
 * @param id - User id
 * @param txOrDb
 * 
 * @returns the user record (or null, if not found)
 */
export async function getUserById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<User | null> {
    const [user] = await txOrDb
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);

    return user || null;
}

/**
 * Retrieve auth record by username. 
 * @note Username will be automatically normalized to lowercase before querying.
 * 
 * @param username
 * @param txOrDb
 * 
 * @returns the user record (or null, if not found)
 */
export async function getUserByUsername(
    username: string,
    txOrDb: DbOrTx = db
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
    limit?: number;                                                // Page size (optional, no default)
};

/**
 * List users with optional pagination, filtering, and sorting
 * @note if no skip or limit is specified, returns all users matching username query/role
 * 
 * @param {GetUsersOptions} opts
 * @param txOrDb
 * 
 * @returns a list of user records matching the query with pagination settings
 * @returns the total number of users
 */
export async function getUsers(
    opts: GetUsersOptions = {},
    txOrDb: DbOrTx = db
): Promise<{ users: User[]; total: number }> {
    const {
        query,
        role,
        orderBy = 'createdAt',
        direction = 'desc',
        skip,
        limit,
    } = opts;

    // Determine output order
    const sortFn = direction === 'asc' ? asc : desc;
    const sortColumn =
        orderBy === 'role' ? users.role :
        orderBy === 'username' ? users.username :
        orderBy === 'lastActiveAt' ? users.lastActiveAt :
        users.createdAt;

    // Build where conditions
    const conditions = [];
    if (query) conditions.push(like(users.username, `%${query.toLowerCase()}%`));
    if (role) conditions.push(eq(users.role, role));
    const whereClause = or(...conditions);

    // Execute query
    const usersList = await txOrDb
        .select()
        .from(users)
        .where(whereClause)
        .orderBy(sortFn(sortColumn))
        .limit(limit ?? 999999)
        .offset(skip ?? 0);

    // Get total count
    const [countResult] = await txOrDb
        .select({ value: count() })
        .from(users)
        .where(whereClause);

    return {
        users: usersList,
        total: countResult?.value || 0,
    };
}

/**
 * Returns the user with the earliest created_at timestamp.
 * Used to identify primary admin for protection logic.
 */
export async function getFirstUser(
    txOrDb: DbOrTx = db
): Promise<User | null> {
    const [user] = await txOrDb
        .select()
        .from(users)
        .orderBy(asc(users.createdAt))
        .limit(1);

    return user || null;
}

/* -------------------- SPECIAL LOGIC -------------------- */

/**
 * Determines role for new user.
 * First user is admin, subsequent users get DEFAULT_USER_ROLE.
 */
export async function determineRole(
    txOrDb: DbOrTx = db
): Promise<UserRole> {
    const hasExistingUsers = await getFirstUser(txOrDb);
    return hasExistingUsers ? DEFAULT_USER_ROLE : 'admin';
}

/**
 * Checks if user is the primary admin (first user created).
 */
export async function isPrimaryAdmin(
    userId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const firstUser = await getFirstUser(txOrDb);
    return firstUser?.id === userId;
}