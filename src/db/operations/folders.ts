import { eq, and, or, isNull, sql, desc } from 'drizzle-orm';
import { db, type DbOrTx } from '../client.js';
import { folders, type Folder, type NewFolder } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { FolderForm, FolderUpdateForm } from '../../routes/types.js';

/* -------------------- CORE CRUD OPERATIONS -------------------- */

/**
 * Creates a new folder for a user.
 *
 * Required fields: userId, data.name, parentId (null for root-level)
 * Auto-generated: id (UUID v4), createdAt, updatedAt
 * Defaults: isExpanded=false
 */
export async function createFolder(
    userId: string,
    data: FolderForm,
    parentId: string | null = null,
    txOrDb: DbOrTx = db
): Promise<Folder> {
    // Check for duplicate name within same parent
    const existing = await getFolderByNameAndParentId(data.name, parentId, userId, txOrDb);
    if (existing) {
        throw new Error('Folder with this name already exists in this location');
    }

    // If parentId provided, validate it exists and belongs to user
    if (parentId) {
        const parent = await getFolderById(parentId, userId, txOrDb);
        if (!parent) {
            throw new Error('Parent folder not found');
        }
    }

    const now = currentUnixTimestamp();
    const folderId = crypto.randomUUID();

    const [folder] = await txOrDb
        .insert(folders)
        .values({
            id: folderId,
            parentId: parentId,
            userId: userId,
            name: data.name,
            meta: data.meta,
            data: data.data,
            isExpanded: false,
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    if (!folder) throw new Error('Error creating folder record');
    return folder;
}

/**
 * Retrieves a folder by ID with ownership verification.
 * Security: Filters by userId to prevent cross-user access.
 */
export async function getFolderById(
    id: string,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Folder | null> {
    const [folder] = await txOrDb
        .select()
        .from(folders)
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ))
        .limit(1);

    return folder || null;
}

/**
 * Retrieves ALL folders for a user (includes all hierarchy levels).
 * Admin or owner only: No pagination.
 */
export async function getFoldersByUserId(
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Folder[]> {
    return await txOrDb
        .select()
        .from(folders)
        .where(eq(folders.userId, userId))
        .orderBy(desc(folders.createdAt));
}

/**
 * Retrieves direct children of a folder.
 * Parameters:
 * - parentId: Parent folder ID (or null for root-level folders)
 * - userId: User to filter by
 *
 * Returns: Array of child folders at this level only (not recursive)
 */
export async function getFoldersByParentId(
    parentId: string | null,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Folder[]> {
    const parentCondition = parentId === null
        ? isNull(folders.parentId)
        : eq(folders.parentId, parentId);

    return await txOrDb
        .select()
        .from(folders)
        .where(and(
            parentCondition,
            eq(folders.userId, userId)
        ))
        .orderBy(desc(folders.createdAt));
}

/**
 * Looks up a folder by name within a parent context.
 * Security: Filters by userId.
 * Use case: Checking for duplicate names before creation/update.
 */
export async function getFolderByNameAndParentId(
    name: string,
    parentId: string | null,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Folder | null> {
    const parentCondition = parentId === null
        ? isNull(folders.parentId)
        : eq(folders.parentId, parentId);

    const [folder] = await txOrDb
        .select()
        .from(folders)
        .where(and(
            eq(folders.name, name),
            parentCondition,
            eq(folders.userId, userId)
        ))
        .limit(1);

    return folder || null;
}

/**
 * Recursively retrieves all descendant folders.
 * Parameters:
 * - folderId: Root folder to start from
 * - userId: User filter
 *
 * Returns: Array of all descendant folders (recursive tree flattened)
 * Notes: Used for cascading deletion logic.
 */
export async function getChildrenFolders(
    folderId: string,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Folder[]> {
    const allDescendants: Folder[] = [];
    const toProcess: string[] = [folderId];

    while (toProcess.length > 0) {
        const currentId = toProcess.shift();
        if (!currentId) continue;

        const children = await txOrDb
            .select()
            .from(folders)
            .where(and(
                eq(folders.parentId, currentId),
                eq(folders.userId, userId)
            ));

        for (const child of children) {
            allDescendants.push(child);
            toProcess.push(child.id);
        }
    }

    return allDescendants;
}

/**
 * Updates folder properties (name, data, meta).
 *
 * Auto-updated fields: updatedAt
 * Behavior:
 * - Only updates provided fields (partial update)
 * - Data and meta are merged with existing values
 * - If name is updated, checks for duplicate names within same parent
 * - Returns null if folder not found or update fails
 */
export async function updateFolder(
    id: string,
    userId: string,
    data: FolderUpdateForm,
    txOrDb: DbOrTx = db
): Promise<Folder | null> {
    const existing = await getFolderById(id, userId, txOrDb);
    if (!existing) return null;

    // If name is being updated, check for duplicates
    if (data.name && data.name !== existing.name) {
        const duplicate = await getFolderByNameAndParentId(
            data.name,
            existing.parentId,
            userId,
            txOrDb
        );
        if (duplicate && duplicate.id !== id) {
            throw new Error('Folder with this name already exists in this location');
        }
    }

    const now = currentUnixTimestamp();

    // Merge data and meta fields with existing values
    const mergedMeta = data.meta !== undefined
        ? { ...(existing.meta || {}), ...data.meta }
        : existing.meta;

    const mergedData = data.data !== undefined
        ? { ...(existing.data || {}), ...data.data }
        : existing.data;

    const [updated] = await txOrDb
        .update(folders)
        .set({
            name: data.name ?? existing.name,
            meta: mergedMeta,
            data: mergedData,
            updatedAt: now,
        })
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ))
        .returning();

    return updated || null;
}

/**
 * Moves a folder to a different parent (or to root if parentId is null).
 *
 * Behavior:
 * - Validates new parent exists (if not null)
 * - Checks for duplicate folder names in target parent
 * - Updates parentId and updatedAt timestamp
 * - Returns null if folder not found
 *
 * Validations:
 * - Cannot move a folder to itself as parent (circular reference)
 * - Cannot move a folder to one of its own descendants (circular reference)
 * - Parent folder must exist and belong to user
 */
export async function updateFolderParent(
    id: string,
    userId: string,
    parentId: string | null,
    txOrDb: DbOrTx = db
): Promise<Folder | null> {
    const existing = await getFolderById(id, userId, txOrDb);
    if (!existing) return null;

    // Validate: Cannot move folder to itself
    if (parentId === id) {
        throw new Error('Folder cannot be its own parent');
    }

    // Validate: Cannot move folder to one of its descendants
    if (parentId) {
        const descendants = await getChildrenFolders(id, userId, txOrDb);
        if (descendants.some(d => d.id === parentId)) {
            throw new Error('Cannot move folder to its own descendant');
        }

        // Validate: Parent must exist and belong to user
        const parent = await getFolderById(parentId, userId, txOrDb);
        if (!parent) {
            throw new Error('Parent folder not found');
        }
    }

    // Check for duplicate name in target parent
    const duplicate = await getFolderByNameAndParentId(
        existing.name,
        parentId,
        userId,
        txOrDb
    );
    if (duplicate && duplicate.id !== id) {
        throw new Error('Folder with this name already exists in target location');
    }

    const now = currentUnixTimestamp();

    const [updated] = await txOrDb
        .update(folders)
        .set({
            parentId: parentId,
            updatedAt: now,
        })
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ))
        .returning();

    return updated || null;
}

/**
 * Updates the UI expansion state of a folder.
 *
 * Behavior:
 * - Sets isExpanded to boolean value
 * - Updates updatedAt timestamp
 * - Returns null if folder not found
 *
 * Use case: Persisting UI tree view state for user
 */
export async function updateFolderExpanded(
    id: string,
    userId: string,
    isExpanded: boolean,
    txOrDb: DbOrTx = db
): Promise<Folder | null> {
    const now = currentUnixTimestamp();

    const [updated] = await txOrDb
        .update(folders)
        .set({
            isExpanded: isExpanded,
            updatedAt: now,
        })
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ))
        .returning();

    return updated || null;
}

/**
 * Deletes a folder and all its descendants (recursive deletion).
 *
 * Returns: Array of deleted folder IDs (for cascading to chats)
 *
 * Behavior:
 * - Recursively deletes all child folders
 * - Returns list of all deleted folder IDs
 * - Related chats are handled separately (see folder deletion in routes)
 *
 * Cascade:
 * - All descendant folders are deleted
 * - Chats in deleted folders are moved to root or deleted (based on deleteContents parameter in API)
 */
export async function deleteFolder(
    id: string,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<string[]> {
    const folder = await getFolderById(id, userId, txOrDb);
    if (!folder) return [];

    // Get all descendants before deletion (to return their IDs)
    const descendants = await getChildrenFolders(id, userId, txOrDb);
    const allFolderIds = [id, ...descendants.map(d => d.id)];

    // Delete parent folder - cascade automatically deletes children
    await txOrDb
        .delete(folders)
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ));

    return allFolderIds;
}
