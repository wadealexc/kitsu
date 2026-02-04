import { eq, desc, asc, like, inArray, sql, and } from 'drizzle-orm';
import { db, type DbOrTx } from '../client.js';
import { files, users, chatFiles, type File, type NewFile } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { FileMeta, FileData, AccessControl } from '../../routes/types.js';

/* -------------------- TYPES -------------------- */

/**
 * Form data for creating a file.
 */
export type FileForm = {
    id: string;
    filename: string;
    path: string | null;
    hash?: string | null;
    data?: FileData;
    meta?: FileMeta;
    accessControl?: AccessControl;
};

/**
 * Form data for updating a file.
 */
export type FileUpdateForm = {
    hash?: string;
    data?: FileData;
    meta?: FileMeta;
};

/**
 * Lightweight file metadata (excludes content).
 */
export type FileMetadata = {
    id: string;
    hash: string | null;
    meta: FileMeta | null;
    createdAt: number;
    updatedAt: number;
};

/**
 * Pagination options.
 */
export type PaginationOptions = {
    skip?: number;
    limit?: number;
    orderBy?: 'createdAt' | 'updatedAt';
    direction?: 'asc' | 'desc';
};

/* -------------------- CORE CRUD OPERATIONS -------------------- */

/**
 * Creates a new file record after upload.
 *
 * Required fields: userId, data.id, data.filename, data.path
 * Auto-generated: createdAt, updatedAt
 */
export async function createFile(
    userId: string,
    data: FileForm,
    txOrDb: DbOrTx = db
): Promise<File> {
    const now = currentUnixTimestamp();

    const [file] = await txOrDb
        .insert(files)
        .values({
            id: data.id,
            userId: userId,
            filename: data.filename,
            path: data.path,
            hash: data.hash,
            data: data.data,
            meta: data.meta,
            accessControl: data.accessControl,
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    if (!file) throw new Error('Error creating file record');
    return file;
}

/**
 * Retrieves full file by ID, including all metadata and internal path.
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
 * Retrieves file by ID, verifying ownership.
 * Used for ownership verification before operations.
 */
export async function getFileByIdAndUserId(
    id: string,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<File | null> {
    const [file] = await txOrDb
        .select()
        .from(files)
        .where(and(
            eq(files.id, id),
            eq(files.userId, userId)
        ))
        .limit(1);

    return file || null;
}

/**
 * Retrieves lightweight file metadata without full content.
 * Faster queries when content not needed (e.g., file listing).
 */
export async function getFileMetadataById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<FileMetadata | null> {
    const [file] = await txOrDb
        .select({
            id: files.id,
            hash: files.hash,
            meta: files.meta,
            createdAt: files.createdAt,
            updatedAt: files.updatedAt,
        })
        .from(files)
        .where(eq(files.id, id))
        .limit(1);

    return file || null;
}

/**
 * Retrieves multiple files by ID list.
 * Returns array ordered by updatedAt DESC.
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

/**
 * Updates file metadata and data fields.
 * Performs merge on JSON fields (doesn't overwrite entirely).
 * Auto-updated: updatedAt timestamp.
 */
export async function updateFile(
    id: string,
    updates: FileUpdateForm,
    txOrDb: DbOrTx = db
): Promise<File | null> {
    const existing = await getFileById(id, txOrDb);
    if (!existing) return null;

    const now = currentUnixTimestamp();

    // Merge JSON fields
    const mergedData = updates.data
        ? { ...existing.data, ...updates.data }
        : existing.data;

    const mergedMeta = updates.meta
        ? { ...existing.meta, ...updates.meta }
        : existing.meta;

    const [updated] = await txOrDb
        .update(files)
        .set({
            hash: updates.hash !== undefined ? updates.hash : existing.hash,
            data: mergedData,
            meta: mergedMeta,
            updatedAt: now,
        })
        .where(eq(files.id, id))
        .returning();

    return updated || null;
}

/**
 * Updates only the data field (processing status, content, errors).
 * Used for setting processing status during file processing pipeline.
 */
export async function updateFileData(
    id: string,
    data: Partial<FileData>,
    txOrDb: DbOrTx = db
): Promise<File | null> {
    const existing = await getFileById(id, txOrDb);
    if (!existing) return null;

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

    return updated || null;
}

/**
 * Updates only the meta field (name, contentType, size, custom data).
 * Used for updating file metadata after processing or user edits.
 */
export async function updateFileMetadata(
    id: string,
    meta: Partial<FileMeta>,
    txOrDb: DbOrTx = db
): Promise<File | null> {
    const existing = await getFileById(id, txOrDb);
    if (!existing) return null;

    const now = currentUnixTimestamp();

    // Merge meta field
    const mergedMeta = { ...existing.meta, ...meta };

    const [updated] = await txOrDb
        .update(files)
        .set({
            meta: mergedMeta,
            updatedAt: now,
        })
        .where(eq(files.id, id))
        .returning();

    return updated || null;
}

/**
 * Hard deletes a file record.
 *
 * Cascade: chat_file records with this fileId are automatically deleted (FK ON DELETE CASCADE).
 *
 * Manual cleanup required in application code:
 * - Physical file at {DATA_DIR}/uploads/{path}
 * - Vector database collection named file-{id}
 */
export async function deleteFile(
    id: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(files)
        .where(eq(files.id, id));

    return result.rowsAffected > 0;
}

/**
 * Admin only: Deletes all file records from the database.
 *
 * Cascade: All junction table records are automatically deleted (FK ON DELETE CASCADE).
 *
 * Manual cleanup required in application code:
 * - All physical files in {DATA_DIR}/uploads/
 * - All vector database collections
 */
export async function deleteAllFiles(
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(files);

    return result.rowsAffected > 0;
}

/* -------------------- SEARCH & FILTERING -------------------- */

/**
 * Searches files by filename with glob pattern matching.
 *
 * Parameters:
 * - userId: Optional - filter by owner. If null, searches all files (admin).
 * - filename: Glob pattern - * matches any, ? matches single char.
 * - skip: Pagination offset (default: 0).
 * - limit: Page size (default: 100, max: 1000).
 *
 * Behavior:
 * - Case-insensitive SQL LIKE matching.
 * - Converts glob patterns: * → %, ? → _.
 * - Returns empty array if no matches.
 * - Ordered by updatedAt DESC.
 */
export async function searchFiles(
    userId: string | null,
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
    const conditions = [like(files.filename, pattern)];
    if (userId !== null) {
        conditions.push(eq(files.userId, userId));
    }

    const whereClause = and(...conditions);

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
 * Checks if user has access to a file.
 *
 * Access checks (in order) - returns true if ANY is satisfied:
 * 1. User owns file (file.user_id == userId)
 * 2. User is admin
 * 3. User has explicit permission in accessControl
 * 4. File is in user's shared chats
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

    // Check 1: User owns file
    if (file.userId === userId) return true;

    // Check 2: User is admin
    const [user] = await txOrDb
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

    if (user && user.role === 'admin') return true;

    // Check 3: Explicit permission in accessControl
    if (file.accessControl) {
        const ac = file.accessControl;
        const accessLevel = accessType === 'read' ? ac?.read : ac?.write;

        if (accessLevel && accessLevel.user_ids?.includes(userId)) return true;
    }

    // Check 4: File is in user's shared chats
    // Get all chats where this file is attached
    const chatFileRecords = await txOrDb
        .select({ chatId: chatFiles.chatId })
        .from(chatFiles)
        .where(eq(chatFiles.fileId, fileId));

    const chatIds = chatFileRecords.map((cf: { chatId: string }) => cf.chatId);

    if (chatIds.length > 0) {
        // Check if user has access to any of these chats
        // This is a simplified check - in production you'd check shareId or chat ownership
        const userChats = await txOrDb
            .select({ chatId: chatFiles.chatId })
            .from(chatFiles)
            .where(and(
                inArray(chatFiles.chatId, chatIds),
                eq(chatFiles.userId, userId)
            ))
            .limit(1);

        if (userChats.length > 0) return true;
    }

    return false;
}

/**
 * Updates file's granular access control permissions.
 */
export async function updateFileAccessControl(
    id: string,
    accessControl: AccessControl,
    txOrDb: DbOrTx = db
): Promise<File | null> {
    const now = currentUnixTimestamp();

    const [updated] = await txOrDb
        .update(files)
        .set({
            accessControl: accessControl,
            updatedAt: now,
        })
        .where(eq(files.id, id))
        .returning();

    return updated || null;
}
