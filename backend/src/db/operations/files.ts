import { eq, desc, inArray } from 'drizzle-orm';

import { db, type DbOrTx } from '../client.js';
import { files } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { FileData } from '../../routes/types/index.js';
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

