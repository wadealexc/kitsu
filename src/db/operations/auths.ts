import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../client.js';
import { auths, users, validateUsername, type User } from '../schema.js';
import { RecordCreationError, RecordNotFoundError, ValidationError } from '../errors.js';

const TABLE = 'auths';

/* -------------------- CREATE -------------------- */

export type NewAuth = typeof auths.$inferInsert;
export type Auth = typeof auths.$inferSelect;

/**
 * Creates a new auth record. Used during signup and admin user creation.
 *
 * @param {NewAuth} params - User id, username, and plaintext password
 * @param txOrDb
 * 
 * @throws if username format validation fails
 * @throws if password format validation fails
 * @throws if db creation fails
 */
export async function createAuth(
    params: NewAuth,
    txOrDb: DbOrTx = db
): Promise<Auth> {
    const normalizedUsername = validateUsername(params.username);

    validatePasswordFormat(params.password);
    const hashedPassword = await hashPassword(params.password);

    const [auth] = await txOrDb
        .insert(auths)
        .values({
            id: params.id,
            username: normalizedUsername,
            password: hashedPassword,
        })
        .returning();

    if (!auth) throw new RecordCreationError(TABLE);
    return auth;
}

/* -------------------- UPDATE -------------------- */

/**
 * Updates a user's password.
 *
 * @param id - User id
 * @param newPlainPassword - New plaintext password
 * @param txOrDb
 * 
 * @throws if password format validation fails
 * @throws if auths record not found
 */
export async function updatePassword(
    id: string,
    newPlainPassword: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    validatePasswordFormat(newPlainPassword);
    const hashedPassword = await hashPassword(newPlainPassword);

    const result = await txOrDb
        .update(auths)
        .set({ password: hashedPassword })
        .where(eq(auths.id, id));

    if (result.rowsAffected === 0) throw new RecordNotFoundError(TABLE, id);
}

/**
 * Updates user's username.
 * 
 * @note Caller is responsible for also updating corresponding user.username field
 * 
 * @param id - User id
 * @param newUsername
 * @param txOrDb
 * 
 * @throws if username format validation fails
 * @throws if auths record not found
 */
export async function updateUsername(
    id: string,
    newUsername: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    const normalizedUsername = validateUsername(newUsername);

    const result = await txOrDb
        .update(auths)
        .set({ username: normalizedUsername })
        .where(eq(auths.id, id));

    if (result.rowsAffected === 0) throw new RecordNotFoundError(TABLE, id);
}

/* -------------------- READ -------------------- */

/**
 * Retrieve auth record by user id.
 * 
 * @param id - User id
 * @param txOrDb
 * 
 * @returns the auth record (or null, if not found)
 */
export async function getAuthById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<Auth | null> {
    const [auth] = await txOrDb
        .select()
        .from(auths)
        .where(eq(auths.id, id))
        .limit(1);

    return auth || null;
}

/**
 * Retrieve auth record by username. Username will be automatically normalized
 * before querying.
 * 
 * @param username
 * @param txOrDb
 * 
 * @returns the auth record (or null, if not found)
 */
export async function getAuthByUsername(
    username: string,
    txOrDb: DbOrTx = db
): Promise<Auth | null> {
    const normalizedUsername = username.toLowerCase();

    const [auth] = await txOrDb
        .select()
        .from(auths)
        .where(eq(auths.username, normalizedUsername))
        .limit(1);

    return auth || null;
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
 * @param username
 * @param plainPassword - Plaintext password
 * 
 * @returns User and auth records if valid, null if invalid
 */
export async function authenticateUser(
    username: string,
    plainPassword: string,
    txOrDb: DbOrTx = db
): Promise<{ user: User; auth: Auth } | null> {
    // Lookup auth by username
    const auth = await getAuthByUsername(username, txOrDb);
    if (!auth) return null;

    // Verify password
    const isValid = await verifyPassword(plainPassword, auth.password);
    if (!isValid) return null;

    // Fetch corresponding user
    const [user] = await txOrDb
        .select()
        .from(users)
        .where(eq(users.id, auth.id))
        .limit(1);

    if (!user) return null;
    return { user, auth };
}

/* -------------------- PASSWORD UTILS -------------------- */

/**
 * Validates password meets security requirements.
 *
 * Rules:
 * - Min length: 8 characters
 * - Max length: 72 bytes (bcrypt limitation)
 *
 * @throws Error if validation fails
 */
export function validatePasswordFormat(password: string): void {
    if (password.length < 8) {
        throw new ValidationError('Password too short (min 8 characters)');
    }

    const encoded = Buffer.from(password, 'utf-8');
    if (encoded.length > 72) {
        throw new ValidationError('Password too long (max 72 bytes)');
    }
}

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
