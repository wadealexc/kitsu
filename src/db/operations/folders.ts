import { eq, and, isNull, desc } from 'drizzle-orm';

import { db, type DbOrTx } from '../client.js';
import { folders } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import { DatabaseError, RecordCreationError, RecordNotFoundError, ValidationError } from '../errors.js';

const TABLE = 'folder';

/* -------------------- CREATE -------------------- */

export type Folder = typeof folders.$inferSelect;
export type NewFolder = Omit<
    typeof folders.$inferInsert,
    'id' | 'updatedAt' | 'createdAt' | 'isExpanded'
>;

/**
 * Creates a new folder for a user
 * 
 * @param params
 * @param txOrDb
 * 
 * @returns the created folder record
 * 
 * @throws if folder name is shared by another folder under the same parent
 * @throws if invalid parent folder provided
 */
export async function createFolder(
    params: NewFolder,
    txOrDb: DbOrTx = db
): Promise<Folder> {
    const { name, parentId = null, userId } = params;

    // Check for duplicate name within same parent
    const existing = await getFolderByNameAndParentId(name, parentId, userId, txOrDb);
    if (existing) throw new ValidationError('Folder with this name already exists in this location');

    // If parentId provided, validate it exists and belongs to user
    if (parentId) {
        const parent = await getFolderById(parentId, userId, txOrDb);
        if (!parent) throw new ValidationError('Parent folder not found');
    }

    const now = currentUnixTimestamp();
    const folderId = crypto.randomUUID();

    const [folder] = await txOrDb
        .insert(folders)
        .values({
            id: folderId,
            parentId: parentId,
            userId: userId,
            name: name,
            meta: params.meta,
            data: params.data,
            isExpanded: false,
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    if (!folder) throw new RecordCreationError('Error creating folder record');
    return folder;
}

/* -------------------- UPDATE -------------------- */

export type UpdateFolder = Omit<Partial<NewFolder>, 'userId' | 'parentId'>;

/**
 * Update a folder's properties (name, data, meta)
 * 
 * @param id - the folder id
 * @param userId
 * @param params - updated name, data, or meta fields. undefined fields are ignored.
 * @param txOrDb
 * 
 * @returns the updated folder record
 * 
 * @throws if the specified folder does not exist
 * @throws if the name is updated to an existing folder's name at the same level
 * @throws if the update fails
 */
export async function updateFolder(
    id: string,
    userId: string,
    params: UpdateFolder,
    txOrDb: DbOrTx = db
): Promise<Folder> {
    const existing = await getFolderById(id, userId, txOrDb);
    if (!existing) throw new RecordNotFoundError(TABLE, id);

    const { name, data, meta } = params;

    // If name is being updated, check for duplicates
    if (name && name !== existing.name) {
        const duplicate = await getFolderByNameAndParentId(
            name,
            existing.parentId,
            userId,
            txOrDb
        );
        if (duplicate && duplicate.id !== id) {
            throw new ValidationError('Folder with this name already exists in this location');
        }
    }

    // Merge fields with existing values
    const mergedName = name ?? existing.name;

    const mergedMeta = meta === undefined ? existing.meta
        : { ...(existing.meta || {}), ...meta };

    const mergedData = data === undefined ? existing.data
        : { ...(existing.data || {}), ...data };

    const [updated] = await txOrDb
        .update(folders)
        .set({
            name: mergedName,
            meta: mergedMeta,
            data: mergedData,
            updatedAt: currentUnixTimestamp(),
        })
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ))
        .returning();

    if (!updated) throw new DatabaseError(`Error updating folder record`);
    return updated;
}

/**
 * 
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


/**
 * Moves a folder to a different parent (or to root if parentId is null).
 * 
 * @param id - the folder id
 * @param userId
 * @param parentId
 * @param txOrDb
 * 
 * @returns the updated folder record
 * 
 * @throws if the folder id does not exist
 * @throws if the referenced parent folder does not exist
 * @throws if trying to set parent equal to self
 * @throws if trying to move folder into one of its own children
 * @throws if the parent folder has a folder with the same name
 * 
 */
export async function updateFolderParent(
    id: string,
    userId: string,
    parentId: string | null,
    txOrDb: DbOrTx = db
): Promise<Folder> {
    const existing = await getFolderById(id, userId, txOrDb);
    if (!existing) throw new RecordNotFoundError(TABLE, id);

    if (parentId) {
        // Cannot set parent to self
        if (parentId === id) throw new ValidationError('Folder cannot be its own parent');

        // Parent folder should exist
        const parent = await getFolderById(parentId, userId, txOrDb);
        if (!parent) throw new ValidationError('Parent folder not found');

        // Cannot move folder to one of its descendants
        const descendants = await getChildrenFolders(id, userId, txOrDb);
        if (descendants.some(d => d.id === parentId))
            throw new ValidationError('Cannot move folder to its own descendant');
    }

    // Check for duplicate name in target parent
    const duplicate = await getFolderByNameAndParentId(
        existing.name,
        parentId,
        userId,
        txOrDb
    );
    if (duplicate && duplicate.id !== id) {
        throw new ValidationError('Folder with this name already exists in target location');
    }

    const [updated] = await txOrDb
        .update(folders)
        .set({
            parentId: parentId,
            updatedAt: currentUnixTimestamp(),
        })
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ))
        .returning();

    if (!updated) throw new DatabaseError('Error updating folder record');
    return updated;
}

/**
 * Updates the UI expansion state of a folder
 * 
 * @param id - the folder id
 * @param userId
 * @param isExpanded
 * @param txOrDb
 * 
 * @returns the updated folder record
 * 
 * @throws if the update fails
 */
export async function updateFolderExpanded(
    id: string,
    userId: string,
    isExpanded: boolean,
    txOrDb: DbOrTx = db
): Promise<Folder> {
    const [updated] = await txOrDb
        .update(folders)
        .set({
            isExpanded: isExpanded,
            updatedAt: currentUnixTimestamp(),
        })
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ))
        .returning();

    if (!updated) throw new RecordNotFoundError(TABLE, id);
    return updated;
}

/* -------------------- DELETE -------------------- */

/**
 * Delete a folder and all of its descendants.
 * @note this does NOT delete chats contained in these folders. if desired,
 * that responsibility falls to the caller. per the db schema, deleting folders
 * will set any associated chat.folderId to null (e.g. the root folder)
 * 
 * @note this method does not explicitly delete descendants; they are handled
 * by cascade behavior (see folder.parentId)
 * 
 * @param id - the folder id
 * @param userId
 * @param txOrDb
 * 
 * @throws if the referenced folder does not exist
 */
export async function deleteFolder(
    id: string,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    // Delete parent folder - cascade automatically deletes children
    const result = await txOrDb
        .delete(folders)
        .where(and(
            eq(folders.id, id),
            eq(folders.userId, userId)
        ));

    if (result.rowsAffected === 0) throw new RecordNotFoundError(TABLE, id);
}

/* -------------------- READ -------------------- */

/**
 * Retrieves a user's folder by its ID
 * 
 * @param id - Folder id
 * @param userId
 * @param txOrDb
 * 
 * @returns the folder record (or null, if not found)
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
 * Retrieve ALL folders and subfolders for a user
 * 
 * @param userId
 * @param txOrDb
 * 
 * @returns the user's folders
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
 * Look up a folder by exact name within a parent context.
 * 
 * @param name - folder name to search for
 * @param parentId - parent folder id. may be null to search the 'root' folder
 * @param userId
 * @param txOrDb 
 * 
 * @returns the folder record (or null, if none found)
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
            eq(folders.userId, userId),
            eq(folders.name, name),
            parentCondition
        ))
        .limit(1);

    return folder || null;
}

/**
 * Recursively retrieve a folder's descendant folders and subfolders. e.g:
 * 
 * Folders:
 * -cats
 * -dogs
 * |-collies
 * |-greyhounds
 * |--mini
 * 
 * ... getChildrenFolders(dogs) returns:
 * [collies, greyhounds, mini]
 * 
 * @param folderId
 * @param userId
 * @param txOrDb
 * 
 * @returns a list of all the folder's descendant folders/subfolders
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
