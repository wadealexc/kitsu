import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { auths, users, type Auth, type User } from '../schema.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

/* -------------------- CORE CRUD OPERATIONS -------------------- */

/**
 * Creates a new auth record.
 * Used during signup and admin user creation.
 *
 * @param id - User ID (must match corresponding user.id)
 * @param username - Username (will be normalized to lowercase)
 * @param plainPassword - Plain text password (will be validated and hashed)
 * @param txOrDb - Database or transaction instance
 */
export async function createAuth(
    id: string,
    username: string,
    plainPassword: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<Auth> {
    const normalizedUsername = validateUsername(username);
    validatePasswordFormat(plainPassword);

    const hashedPassword = await hashPassword(plainPassword);

    const [auth] = await txOrDb
        .insert(auths)
        .values({
            id,
            username: normalizedUsername,
            password: hashedPassword,
        })
        .returning();

    if (!auth) throw new Error('Error creating auth record');

    return auth;
}

/**
 * Retrieves auth record by user ID.
 */
export async function getAuthById(
    id: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<Auth | null> {
    const [auth] = await txOrDb
        .select()
        .from(auths)
        .where(eq(auths.id, id))
        .limit(1);

    return auth || null;
}

/**
 * Retrieves auth record by username.
 * Username should be normalized to lowercase before querying.
 */
export async function getAuthByUsername(
    username: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<Auth | null> {
    const normalizedUsername = username.toLowerCase();

    const [auth] = await txOrDb
        .select()
        .from(auths)
        .where(eq(auths.username, normalizedUsername))
        .limit(1);

    return auth || null;
}

/**
 * Updates user's password.
 * Password will be validated and hashed before storing.
 *
 * @param id - User ID
 * @param newPlainPassword - New plain text password (will be validated and hashed)
 * @param txOrDb - Database or transaction instance
 */
export async function updatePassword(
    id: string,
    newPlainPassword: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<boolean> {
    validatePasswordFormat(newPlainPassword);

    const hashedPassword = await hashPassword(newPlainPassword);

    const result = await txOrDb
        .update(auths)
        .set({ password: hashedPassword })
        .where(eq(auths.id, id));

    return result.changes > 0;
}

/**
 * Updates user's username.
 * Must also update corresponding user.username field in transaction.
 */
export async function updateUsername(
    id: string,
    newUsername: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<boolean> {
    const normalizedUsername = validateUsername(newUsername);

    const result = await txOrDb
        .update(auths)
        .set({ username: normalizedUsername })
        .where(eq(auths.id, id));

    return result.changes > 0;
}

/**
 * Deletes auth record.
 * Should cascade delete corresponding user record via FK constraint.
 */
export async function deleteAuth(
    id: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(auths)
        .where(eq(auths.id, id));

    return result.changes > 0;
}

/* -------------------- AUTHENTICATION OPERATIONS -------------------- */

/**
 * Validates user credentials.
 *
 * Flow:
 * 1. Lookup auth record by username
 * 2. Verify password using bcrypt.compare
 * 3. Fetch user record
 * 4. Return user + auth if valid, null otherwise
 *
 * @param username - Username (will be normalized)
 * @param plainPassword - Plain text password
 * @returns User and auth records if valid, null if invalid
 */
export async function authenticateUser(
    username: string,
    plainPassword: string,
    txOrDb: BetterSQLite3Database<any> = db
): Promise<{ user: User; auth: Auth } | null> {
    // Lookup auth by username
    const auth = await getAuthByUsername(username, txOrDb);
    if (!auth) {
        return null;
    }

    // Verify password
    const isValid = await verifyPassword(plainPassword, auth.password);
    if (!isValid) {
        return null;
    }

    // Fetch corresponding user
    const [user] = await txOrDb
        .select()
        .from(users)
        .where(eq(users.id, auth.id))
        .limit(1);

    if (!user) {
        return null;
    }

    return { user, auth };
}

/* -------------------- VALIDATION UTILITIES -------------------- */

/**
 * Validates and normalizes username format.
 *
 * Rules:
 * - Length: 3-50 characters
 * - Characters: Alphanumeric + underscore + dash only (a-zA-Z0-9_-)
 * - Must start with alphanumeric
 * - Normalized to lowercase for consistency
 *
 * @throws Error if validation fails
 * @returns Normalized (lowercase) username
 */
export function validateUsername(username: string): string {
    const trimmed = username.trim();

    // Length check: 3-50 characters
    if (trimmed.length < 3 || trimmed.length > 50) {
        throw new Error('Username must be 3-50 characters');
    }

    // Format check: alphanumeric + underscore + dash only
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        throw new Error('Username can only contain letters, numbers, underscore, and dash');
    }

    // Must start with alphanumeric
    if (!/^[a-zA-Z0-9]/.test(trimmed)) {
        throw new Error('Username must start with a letter or number');
    }

    // Normalize to lowercase for case-insensitive uniqueness
    return trimmed.toLowerCase();
}

/**
 * Validates password meets security requirements.
 *
 * Rules:
 * - Min length: 8 characters
 * - Max length: 72 characters (bcrypt limitation)
 *
 * @throws Error if validation fails
 */
export function validatePasswordFormat(password: string): void {
    // Min length: 8 characters
    if (password.length < 8) {
        throw new Error('Password too short (min 8 characters)');
    }

    // Max length: 72 characters (bcrypt limitation)
    const encoded = Buffer.from(password, 'utf-8');
    if (encoded.length > 72) {
        throw new Error('Password too long (max 72 bytes)');
    }
}

/* -------------------- PASSWORD HANDLING -------------------- */

/**
 * Hashes a plain text password using bcrypt with 10 salt rounds.
 */
export async function hashPassword(plainPassword: string): Promise<string> {
    const saltRounds = 10;
    return await bcrypt.hash(plainPassword, saltRounds);
}

/**
 * Verifies a plain text password against a bcrypt hash.
 */
export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
    return await bcrypt.compare(plainPassword, hashedPassword);
}
