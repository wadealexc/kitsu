import { eq, desc, asc, like, inArray, sql, and } from 'drizzle-orm';

import { db, type DbOrTx } from '../client.js';
import { files, chatFiles } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { FileMeta, FileData, AccessControl } from '../../routes/types.js';
import * as Chats from './chats.js';
import { DatabaseError, RecordCreationError, RecordNotFoundError } from '../errors.js';

const TABLE = 'file';

/* -------------------- CREATE -------------------- */

export type File = typeof files.$inferSelect;
export type NewFile = Omit<
    typeof files.$inferInsert,
    'id' | 'createdAt' | 'updatedAt' | 'accessControl'
>;

/**
 * Creates a new file record after upload.
 * @note Files are created with empty accessControl. By default, this grants the owner
 * sole read/write permissions. See `hasFileAccess`.
 * 
 * @param data
 * @param txOrDb
 * 
 * @returns the new file record
 * 
 * @throws if record creation fails
 */
export async function createFile(
    data: NewFile,
    txOrDb: DbOrTx = db
): Promise<File> {
    const fileId = crypto.randomUUID();
    const now = currentUnixTimestamp();

    const [file] = await txOrDb
        .insert(files)
        .values({
            id: fileId,
            userId: data.userId,
            filename: data.filename,
            path: data.path,
            hash: data.hash,
            data: data.data,
            meta: data.meta,
            accessControl: {},
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    if (!file) throw new RecordCreationError('Error creating file record');
    return file;
}

/* -------------------- UPDATE -------------------- */

/**
 * Updates only the data field (processing status, content, errors)
 * TODO - not 100% sure this is needed.
 * 
 * @param id - file id
 * @param data
 * @param txOrDb
 * 
 * @returns the updated file record
 * 
 * @throws if the specified file cannot be found
 * @throws if the file update fails
 */
export async function updateFileData(
    id: string,
    data: Partial<FileData>,
    txOrDb: DbOrTx = db
): Promise<File> {
    const existing = await getFileById(id, txOrDb);
    if (!existing) throw new RecordNotFoundError(TABLE, id);

    const now = currentUnixTimestamp();

    // Merge data field
    const mergedData = { ...existing.data, ...data };

    const [updated] = await txOrDb
        .update(files)
        .set({
            data: mergedData,
            updatedAt: now,
        })
        .where(eq(files.id, id))
        .returning();

    if (!updated) throw new DatabaseError(`file update failed`);
    return updated;
}

/* -------------------- DELETE -------------------- */

/**
 * Deletes a file record. Corresponding chat_file records are deleted by cascade.
 * @note this does NOT delete the file from the storage provider; that is the caller's
 * responsibility.
 * 
 * @param id - file id
 * @param txOrDb
 * 
 * @throws if deletion fails
 */
export async function deleteFile(
    id: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    const result = await txOrDb
        .delete(files)
        .where(eq(files.id, id));

    if (result.rowsAffected === 0) throw new RecordNotFoundError(TABLE, id);
}

/**
 * Deletes all file records from the database. Corresponding chat_file records are
 * deleted by cascade.
 * @note this does NOT delete files from the storage provider; that is the caller's
 * responsibility.
 * 
 * @param txOrDb
 */
export async function deleteAllFiles(
    txOrDb: DbOrTx = db
): Promise<void> {
    await txOrDb.delete(files);
}

/* -------------------- READ -------------------- */

/**
 * Retrieves a complete file record
 * 
 * @param id
 * @param txOrDb
 * 
 * @returns the file record (or null, if not found)
 */
export async function getFileById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<File | null> {
    const [file] = await txOrDb
        .select()
        .from(files)
        .where(eq(files.id, id))
        .limit(1);

    return file || null;
}

/**
 * Retrieve complete file records for each specified file id
 * 
 * @param ids - list of file ids
 * @param txOrDb
 * 
 * @returns a list of file records
 */
export async function getFilesByIds(
    ids: string[],
    txOrDb: DbOrTx = db
): Promise<File[]> {
    if (ids.length === 0) return [];

    return await txOrDb
        .select()
        .from(files)
        .where(inArray(files.id, ids))
        .orderBy(desc(files.updatedAt));
}

/**
 * Admin only: Retrieves ALL files from ALL users (no filtering).
 * Used for admin data export/backup.
 */
export async function getFiles(
    txOrDb: DbOrTx = db
): Promise<File[]> {
    return await txOrDb
        .select()
        .from(files)
        .orderBy(desc(files.updatedAt));
}

/**
 * Pagination options.
 */
export type PaginationOptions = {
    skip?: number;
    limit?: number;
    orderBy?: 'createdAt' | 'updatedAt';
    direction?: 'asc' | 'desc';
};

/**
 * Retrieves all files for a specific user with pagination and sorting.
 */
export async function getFilesByUserId(
    userId: string,
    options: PaginationOptions = {},
    txOrDb: DbOrTx = db
): Promise<{ items: File[]; total: number }> {
    const {
        skip = 0,
        limit,
        orderBy = 'updatedAt',
        direction = 'desc',
    } = options;

    // Determine sort column
    const sortColumn = orderBy === 'createdAt' ? files.createdAt : files.updatedAt;
    const sortFn = direction === 'asc' ? asc : desc;

    // Execute query
    const items = await txOrDb
        .select()
        .from(files)
        .where(eq(files.userId, userId))
        .orderBy(sortFn(sortColumn))
        .limit(limit ?? 999999)
        .offset(skip);

    // Get total count
    const countResult = await txOrDb
        .select({ count: sql<number>`count(*)` })
        .from(files)
        .where(eq(files.userId, userId));

    const total = countResult[0]?.count ?? 0;

    return { items, total };
}

/* -------------------- SEARCH & FILTERING -------------------- */

/**
 * Search a user's files by filename with glob pattern matching. Orders results
 * by updatedAt DESC.
 * 
 * @param userId - the user whose files will be searched
 * @param filename - Glob pattern: * matches any, ? matches one char
 * @param skip - pagination offset
 * @param limit - page size
 * 
 * @returns a list of file records matching the search
 */
export async function searchFiles(
    userId: string,
    filename: string,
    skip: number = 0,
    limit: number = 100,
    txOrDb: DbOrTx = db
): Promise<File[]> {
    // Convert glob patterns to SQL LIKE patterns
    const pattern = filename
        .replace(/\*/g, '%')
        .replace(/\?/g, '_');

    // Build where conditions
    const whereClause = and(
        like(files.filename, pattern),
        eq(files.userId, userId)
    );

    // Enforce max limit
    const effectiveLimit = Math.min(limit, 1000);
    return await txOrDb
        .select()
        .from(files)
        .where(whereClause)
        .orderBy(desc(files.updatedAt))
        .limit(effectiveLimit)
        .offset(skip);
}

/* -------------------- ACCESS CONTROL -------------------- */

/**
 * Check whether the user has access to a file. Returns true if ANY:
 * 1. User owns file (via file.userId)
 * 2. User has been granted permission to the file (via file.accessControl)
 * 3. File is in a publicly shared chat
 * 
 * @param fileId
 * @param userId
 * @param accessType - whether we're looking for 'read' or 'write' access
 * @param txOrDb
 * 
 * @returns true if the user has access
 */
export async function hasFileAccess(
    fileId: string,
    userId: string,
    accessType: 'read' | 'write',
    txOrDb: DbOrTx = db
): Promise<boolean> {
    // Get file
    const file = await getFileById(fileId, txOrDb);
    if (!file) return false;

    // 1. User owns file
    if (file.userId === userId) return true;

    // 2. Explicit permission in accessControl
    const accessLevel = accessType === 'read'
        ? file.accessControl.read
        : file.accessControl.write;

    if (accessLevel && accessLevel.user_ids.includes(userId)) return true;

    // At this point, if we're checking for 'write' access, that's a no.
    if (accessType === 'write') return false;

    // 3. User has read access if the file is in a publicly-shared chat.
    const sharedChats = await Chats.getSharedChatsByFileId(fileId, txOrDb);
    if (sharedChats.length > 0) return true;

    return false;
}

/**
 * Updates file's granular access control permissions.
 * 
 * @param id - file id
 * @param accessControl - the new permissions
 * @param txOrDb
 * 
 * @returns the updated file record
 * 
 * @throws if the update fails
 */
export async function updateFileAccessControl(
    id: string,
    accessControl: AccessControl,
    txOrDb: DbOrTx = db
): Promise<File> {
    const now = currentUnixTimestamp();

    const [updated] = await txOrDb
        .update(files)
        .set({
            accessControl: accessControl,
            updatedAt: now,
        })
        .where(eq(files.id, id))
        .returning();

    if (!updated) throw new RecordNotFoundError(TABLE, id);
    return updated;
}
