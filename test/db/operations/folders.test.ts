import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestDatabase, newUserParams, type TestDatabase } from '../../helpers.js';
import * as Folders from '../../../src/db/operations/folders.js';
import * as Users from '../../../src/db/operations/users.js';
import * as Chats from '../../../src/db/operations/chats.js';
import { folders, type Folder } from '../../../src/db/schema.js';
import type { FolderForm, FolderUpdateForm, FolderMeta, FolderData } from '../../../src/routes/types.js';
import { currentUnixTimestamp } from '../../../src/db/utils.js';

/* -------------------- TEST HELPERS -------------------- */

/**
 * Creates a minimal FolderForm for testing.
 */
function createTestFolderForm(
    name: string = 'Test Folder',
    meta?: FolderMeta,
    data?: FolderData
): FolderForm {
    return {
        name: name,
        meta: meta,
        data: data,
    };
}

/**
 * Create a folder with 'createdAt' and 'updatedAt' set to specific values
 */
async function _createOldFolder(
    userId: string,
    data: FolderForm,
    parentId: string | null = null,
    txOrDb: TestDatabase,
    createdAt?: number,
    updatedAt?: number,
): Promise<Folder> {
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
            createdAt: createdAt ?? now - 1000,
            updatedAt: updatedAt ?? createdAt ?? now - 1000,
        })
        .returning();

    if (!folder) throw new Error('_createOldFolder: error creating folder record');
    return folder;
}

/* -------------------- CORE CRUD OPERATIONS -------------------- */

describe('Folder Operations', () => {
    let db: TestDatabase;
    let userId: string;

    beforeEach(async () => {
        db = await createTestDatabase();
        // Create test user
        const params = newUserParams('admin');
        const user = await Users.createUser(params, db);
        userId = user.id;
    });

    afterEach(async () => {
        await db.$client?.close();
    });

    describe('createFolder', () => {
        test('should create root-level folder', async () => {
            const folderData = createTestFolderForm('My Folder');
            const folder = await Folders.createFolder(userId, folderData, null, db);

            assert.ok(folder.id);
            assert.strictEqual(folder.userId, userId);
            assert.strictEqual(folder.name, 'My Folder');
            assert.strictEqual(folder.parentId, null);
            assert.strictEqual(folder.isExpanded, false);
            assert.ok(folder.createdAt);
            assert.ok(folder.updatedAt);
            assert.strictEqual(folder.createdAt, folder.updatedAt);
        });

        test('should create subfolder with valid parent', async () => {
            const parentFolder = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent Folder'),
                null,
                db
            );

            const childFolder = await Folders.createFolder(
                userId,
                createTestFolderForm('Child Folder'),
                parentFolder.id,
                db
            );

            assert.ok(childFolder.id);
            assert.strictEqual(childFolder.parentId, parentFolder.id);
            assert.strictEqual(childFolder.userId, userId);
            assert.strictEqual(childFolder.name, 'Child Folder');
        });

        test('should reject duplicate name in same parent', async () => {
            const folderData = createTestFolderForm('Duplicate Folder');
            await Folders.createFolder(userId, folderData, null, db);

            await assert.rejects(
                async () => await Folders.createFolder(userId, folderData, null, db),
                { message: 'Folder with this name already exists in this location' }
            );
        });

        test('should allow same name in different parents', async () => {
            const parent1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent 1'),
                null,
                db
            );
            const parent2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent 2'),
                null,
                db
            );

            const child1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Same Name'),
                parent1.id,
                db
            );
            const child2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Same Name'),
                parent2.id,
                db
            );

            assert.ok(child1.id);
            assert.ok(child2.id);
            assert.notStrictEqual(child1.id, child2.id);
            assert.strictEqual(child1.parentId, parent1.id);
            assert.strictEqual(child2.parentId, parent2.id);
        });

        test('should reject invalid parent_id', async () => {
            const folderData = createTestFolderForm('Test Folder');

            await assert.rejects(
                async () => await Folders.createFolder(
                    userId,
                    folderData,
                    'non-existent-id',
                    db
                ),
                { message: 'Parent folder not found' }
            );
        });

        test('should create folder with meta', async () => {
            const folderData = createTestFolderForm(
                'Folder with Icon',
                { icon: ':star:' }
            );
            const folder = await Folders.createFolder(userId, folderData, null, db);

            assert.ok(folder.meta);
            assert.strictEqual(folder.meta.icon, ':star:');
        });

        test('should create folder with data', async () => {
            const folderData = createTestFolderForm(
                'Folder with Data',
                undefined,
                { system_prompt: 'You are a helpful assistant' }
            );
            const folder = await Folders.createFolder(userId, folderData, null, db);

            assert.ok(folder.data);
            assert.strictEqual(folder.data.system_prompt, 'You are a helpful assistant');
        });

        test('should verify timestamps are set correctly', async () => {
            const now = currentUnixTimestamp();
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );

            assert.ok(folder.createdAt >= now);
            assert.ok(folder.updatedAt >= now);
            assert.strictEqual(folder.createdAt, folder.updatedAt);
        });

        test('should verify default isExpanded is false', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );

            assert.strictEqual(folder.isExpanded, false);
        });
    });

    describe('getFolderById', () => {
        test('should retrieve existing folder', async () => {
            const created = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );
            const retrieved = await Folders.getFolderById(created.id, userId, db);

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, created.id);
            assert.strictEqual(retrieved.name, 'Test Folder');
            assert.strictEqual(retrieved.userId, userId);
        });

        test('should return null for non-existent folder', async () => {
            const retrieved = await Folders.getFolderById('non-existent-id', userId, db);

            assert.strictEqual(retrieved, null);
        });

        test('should enforce user ownership', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('My Folder'),
                null,
                db
            );

            const retrieved = await Folders.getFolderById(folder.id, otherUser.id, db);

            assert.strictEqual(retrieved, null);
        });
    });

    describe('getFoldersByUserId', () => {
        test('should retrieve all folders for user', async () => {
            await Folders.createFolder(userId, createTestFolderForm('Folder 1'), null, db);
            await Folders.createFolder(userId, createTestFolderForm('Folder 2'), null, db);
            await Folders.createFolder(userId, createTestFolderForm('Folder 3'), null, db);

            const folders = await Folders.getFoldersByUserId(userId, db);

            assert.ok(folders.length >= 3);
            assert.ok(folders.every(f => f.userId === userId));
        });

        test('should return folders ordered by createdAt desc', async () => {
            const folder1 = await _createOldFolder(
                userId,
                createTestFolderForm('First'),
                null,
                db,
            );

            const folder2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Second'),
                null,
                db
            );

            const folders = await Folders.getFoldersByUserId(userId, db);

            // Most recent first
            assert.strictEqual(folders[0]!.id, folder2.id);
            assert.strictEqual(folders[1]!.id, folder1.id);
        });

        test('should return empty array if user has no folders', async () => {
            const folders = await Folders.getFoldersByUserId(userId, db);

            assert.strictEqual(folders.length, 0);
        });

        test('should not return other users folders', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);

            await Folders.createFolder(userId, createTestFolderForm('User 1 Folder'), null, db);
            await Folders.createFolder(otherUser.id, createTestFolderForm('User 2 Folder'), null, db);

            const user1Folders = await Folders.getFoldersByUserId(userId, db);
            const user2Folders = await Folders.getFoldersByUserId(otherUser.id, db);

            assert.strictEqual(user1Folders.length, 1);
            assert.strictEqual(user2Folders.length, 1);
            assert.strictEqual(user1Folders[0]!.name, 'User 1 Folder');
            assert.strictEqual(user2Folders[0]!.name, 'User 2 Folder');
        });
    });

    describe('getFoldersByParentId', () => {
        test('should retrieve direct children of folder', async () => {
            const parent = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );
            const child1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Child 1'),
                parent.id,
                db
            );
            const child2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Child 2'),
                parent.id,
                db
            );

            const children = await Folders.getFoldersByParentId(parent.id, userId, db);

            assert.strictEqual(children.length, 2);
            assert.ok(children.some(c => c.id === child1.id));
            assert.ok(children.some(c => c.id === child2.id));
        });

        test('should retrieve root-level folders with null parentId', async () => {
            const root1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Root 1'),
                null,
                db
            );
            const root2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Root 2'),
                null,
                db
            );

            const rootFolders = await Folders.getFoldersByParentId(null, userId, db);

            assert.ok(rootFolders.length >= 2);
            assert.ok(rootFolders.some(f => f.id === root1.id));
            assert.ok(rootFolders.some(f => f.id === root2.id));
            assert.ok(rootFolders.every(f => f.parentId === null));
        });

        test('should not return nested descendants', async () => {
            const parent = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );
            const child = await Folders.createFolder(
                userId,
                createTestFolderForm('Child'),
                parent.id,
                db
            );
            await Folders.createFolder(
                userId,
                createTestFolderForm('Grandchild'),
                child.id,
                db
            );

            const children = await Folders.getFoldersByParentId(parent.id, userId, db);

            assert.strictEqual(children.length, 1);
            assert.strictEqual(children[0]!.id, child.id);
        });

        test('should return empty array if parent has no children', async () => {
            const parent = await Folders.createFolder(
                userId,
                createTestFolderForm('Empty Parent'),
                null,
                db
            );

            const children = await Folders.getFoldersByParentId(parent.id, userId, db);

            assert.strictEqual(children.length, 0);
        });

        test('should return folders ordered by createdAt desc', async () => {
            const parent = await _createOldFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );

            const child1 = await _createOldFolder(
                userId,
                createTestFolderForm('First Child'),
                parent.id,
                db
            );

            const child2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Second Child'),
                parent.id,
                db
            );

            const children = await Folders.getFoldersByParentId(parent.id, userId, db);

            // Most recent first
            assert.strictEqual(children[0]!.id, child2.id);
            assert.strictEqual(children[1]!.id, child1.id);
        });
    });

    describe('getFolderByNameAndParentId', () => {
        test('should lookup folder by name within parent', async () => {
            const parent = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );
            const child = await Folders.createFolder(
                userId,
                createTestFolderForm('Child'),
                parent.id,
                db
            );

            const found = await Folders.getFolderByNameAndParentId(
                'Child',
                parent.id,
                userId,
                db
            );

            assert.ok(found);
            assert.strictEqual(found.id, child.id);
            assert.strictEqual(found.name, 'Child');
        });

        test('should lookup root-level folder with null parentId', async () => {
            const root = await Folders.createFolder(
                userId,
                createTestFolderForm('Root Folder'),
                null,
                db
            );

            const found = await Folders.getFolderByNameAndParentId(
                'Root Folder',
                null,
                userId,
                db
            );

            assert.ok(found);
            assert.strictEqual(found.id, root.id);
        });

        test('should return null if name not found in parent', async () => {
            const parent = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );

            const found = await Folders.getFolderByNameAndParentId(
                'Non-existent',
                parent.id,
                userId,
                db
            );

            assert.strictEqual(found, null);
        });

        test('should distinguish between same names in different parents', async () => {
            const parent1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent 1'),
                null,
                db
            );
            const parent2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent 2'),
                null,
                db
            );

            const child1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Same Name'),
                parent1.id,
                db
            );
            const child2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Same Name'),
                parent2.id,
                db
            );

            const found1 = await Folders.getFolderByNameAndParentId(
                'Same Name',
                parent1.id,
                userId,
                db
            );
            const found2 = await Folders.getFolderByNameAndParentId(
                'Same Name',
                parent2.id,
                userId,
                db
            );

            assert.ok(found1);
            assert.ok(found2);
            assert.strictEqual(found1.id, child1.id);
            assert.strictEqual(found2.id, child2.id);
            assert.notStrictEqual(found1.id, found2.id);
        });
    });

    describe('getChildrenFolders', () => {
        test('should retrieve all descendant folders recursively', async () => {
            const root = await Folders.createFolder(
                userId,
                createTestFolderForm('Root'),
                null,
                db
            );
            const child1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Child 1'),
                root.id,
                db
            );
            const child2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Child 2'),
                root.id,
                db
            );
            const grandchild1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Grandchild 1'),
                child1.id,
                db
            );
            const grandchild2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Grandchild 2'),
                child2.id,
                db
            );

            const descendants = await Folders.getChildrenFolders(root.id, userId, db);

            assert.strictEqual(descendants.length, 4);
            assert.ok(descendants.some(d => d.id === child1.id));
            assert.ok(descendants.some(d => d.id === child2.id));
            assert.ok(descendants.some(d => d.id === grandchild1.id));
            assert.ok(descendants.some(d => d.id === grandchild2.id));
        });

        test('should return empty array for folder with no children', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Leaf Folder'),
                null,
                db
            );

            const descendants = await Folders.getChildrenFolders(folder.id, userId, db);

            assert.strictEqual(descendants.length, 0);
        });

        test('should handle deep nesting', async () => {
            let currentParent = await Folders.createFolder(
                userId,
                createTestFolderForm('Level 0'),
                null,
                db
            );

            for (let i = 1; i <= 5; i++) {
                currentParent = await Folders.createFolder(
                    userId,
                    createTestFolderForm(`Level ${i}`),
                    currentParent.id,
                    db
                );
            }

            const rootFolder = await Folders.getFolderByNameAndParentId('Level 0', null, userId, db);
            assert.ok(rootFolder);

            const descendants = await Folders.getChildrenFolders(rootFolder.id, userId, db);

            assert.strictEqual(descendants.length, 5);
        });
    });

    describe('updateFolder', () => {
        test('should update folder name', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Original Name'),
                null,
                db
            );

            const updated = await Folders.updateFolder(
                folder.id,
                userId,
                { name: 'Updated Name' },
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.name, 'Updated Name');
        });

        test('should check duplicate name in same parent', async () => {
            await Folders.createFolder(userId, createTestFolderForm('Existing Folder'), null, db);
            const folder = await Folders.createFolder(userId, createTestFolderForm('My Folder'), null, db);

            await assert.rejects(
                async () => await Folders.updateFolder(
                    folder.id,
                    userId,
                    { name: 'Existing Folder' },
                    db
                ),
                { message: 'Folder with this name already exists in this location' }
            );
        });

        test('should allow updating to same name', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('My Folder'),
                null,
                db
            );

            const updated = await Folders.updateFolder(
                folder.id,
                userId,
                { name: 'My Folder' },
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.name, 'My Folder');
        });

        test('should update meta with merge semantics', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder', { icon: ':folder:' }),
                null,
                db
            );

            const updated = await Folders.updateFolder(
                folder.id,
                userId,
                { meta: { icon: ':star:' } },
                db
            );

            assert.ok(updated);
            assert.ok(updated.meta);
            assert.strictEqual(updated.meta.icon, ':star:');
        });

        test('should update data with merge semantics', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder', undefined, {
                    system_prompt: 'Original prompt',
                    model_ids: ['model1']
                }),
                null,
                db
            );

            const updated = await Folders.updateFolder(
                folder.id,
                userId,
                { data: { system_prompt: 'Updated prompt' } },
                db
            );

            assert.ok(updated);
            assert.ok(updated.data);
            assert.strictEqual(updated.data.system_prompt, 'Updated prompt');
            assert.deepStrictEqual(updated.data.model_ids, ['model1']);
        });

        test('should perform partial update', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Original Name', { icon: ':folder:' }),
                null,
                db
            );

            const updated = await Folders.updateFolder(
                folder.id,
                userId,
                { meta: { icon: ':star:' } },
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.name, 'Original Name');
            assert.ok(updated.meta);
            assert.strictEqual(updated.meta.icon, ':star:');
        });

        test('should update timestamps on modification', async () => {
            const folder = await _createOldFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );
            const originalCreatedAt = folder.createdAt;
            const originalUpdatedAt = folder.updatedAt;

            const updated = await Folders.updateFolder(
                folder.id,
                userId,
                { name: 'Updated Folder' },
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.createdAt, originalCreatedAt);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        test('should reject cross-user updates', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('My Folder'),
                null,
                db
            );

            const updated = await Folders.updateFolder(
                folder.id,
                otherUser.id,
                { name: 'Hacked Folder' },
                db
            );

            assert.strictEqual(updated, null);
        });

        test('should return null for non-existent folder', async () => {
            const updated = await Folders.updateFolder(
                'non-existent-id',
                userId,
                { name: 'Updated Name' },
                db
            );

            assert.strictEqual(updated, null);
        });
    });

    describe('updateFolderParent', () => {
        test('should move folder to different parent', async () => {
            const parent1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent 1'),
                null,
                db
            );
            const parent2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent 2'),
                null,
                db
            );
            const child = await Folders.createFolder(
                userId,
                createTestFolderForm('Child'),
                parent1.id,
                db
            );

            const updated = await Folders.updateFolderParent(
                child.id,
                userId,
                parent2.id,
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.parentId, parent2.id);
        });

        test('should move folder to root', async () => {
            const parent = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );
            const child = await Folders.createFolder(
                userId,
                createTestFolderForm('Child'),
                parent.id,
                db
            );

            const updated = await Folders.updateFolderParent(
                child.id,
                userId,
                null,
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.parentId, null);
        });

        test('should reject moving folder to itself', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Self-referential'),
                null,
                db
            );

            await assert.rejects(
                async () => await Folders.updateFolderParent(
                    folder.id,
                    userId,
                    folder.id,
                    db
                ),
                { message: 'Folder cannot be its own parent' }
            );
        });

        test('should reject moving folder to its own descendant', async () => {
            const parent = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );
            const child = await Folders.createFolder(
                userId,
                createTestFolderForm('Child'),
                parent.id,
                db
            );
            const grandchild = await Folders.createFolder(
                userId,
                createTestFolderForm('Grandchild'),
                child.id,
                db
            );

            await assert.rejects(
                async () => await Folders.updateFolderParent(
                    parent.id,
                    userId,
                    grandchild.id,
                    db
                ),
                { message: 'Cannot move folder to its own descendant' }
            );
        });

        test('should check duplicate name in target parent', async () => {
            const parent = await Folders.createFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );
            await Folders.createFolder(
                userId,
                createTestFolderForm('Existing Child'),
                parent.id,
                db
            );
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Existing Child'),
                null,
                db
            );

            await assert.rejects(
                async () => await Folders.updateFolderParent(
                    folder.id,
                    userId,
                    parent.id,
                    db
                ),
                { message: 'Folder with this name already exists in target location' }
            );
        });

        test('should verify parent exists', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );

            await assert.rejects(
                async () => await Folders.updateFolderParent(
                    folder.id,
                    userId,
                    'non-existent-parent',
                    db
                ),
                { message: 'Parent folder not found' }
            );
        });

        test('should update timestamps', async () => {
            const parent = await _createOldFolder(
                userId,
                createTestFolderForm('Parent'),
                null,
                db
            );
            const folder = await _createOldFolder(
                userId,
                createTestFolderForm('Child'),
                null,
                db
            );
            const originalUpdatedAt = folder.updatedAt;

            const updated = await Folders.updateFolderParent(
                folder.id,
                userId,
                parent.id,
                db
            );

            assert.ok(updated);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        test('should return null for non-existent folder', async () => {
            const updated = await Folders.updateFolderParent(
                'non-existent-id',
                userId,
                null,
                db
            );

            assert.strictEqual(updated, null);
        });
    });

    describe('updateFolderExpanded', () => {
        test('should update isExpanded to true', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );

            const updated = await Folders.updateFolderExpanded(
                folder.id,
                userId,
                true,
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.isExpanded, true);
        });

        test('should update isExpanded to false', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );

            // First expand it
            await Folders.updateFolderExpanded(folder.id, userId, true, db);

            // Then collapse it
            const updated = await Folders.updateFolderExpanded(
                folder.id,
                userId,
                false,
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.isExpanded, false);
        });

        test('should update timestamps', async () => {
            const folder = await _createOldFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );
            const originalUpdatedAt = folder.updatedAt;

            const updated = await Folders.updateFolderExpanded(
                folder.id,
                userId,
                true,
                db
            );

            assert.ok(updated);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        test('should return null for non-existent folder', async () => {
            const updated = await Folders.updateFolderExpanded(
                'non-existent-id',
                userId,
                true,
                db
            );

            assert.strictEqual(updated, null);
        });
    });

    describe('deleteFolder', () => {
        test('should delete folder and return its ID', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );

            const deletedIds = await Folders.deleteFolder(folder.id, userId, db);

            assert.strictEqual(deletedIds.length, 1);
            assert.strictEqual(deletedIds[0], folder.id);

            const retrieved = await Folders.getFolderById(folder.id, userId, db);
            assert.strictEqual(retrieved, null);
        });

        test('should set chat folderId to null when folder is deleted', async () => {
            // Create folder
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );

            // Create chat in folder
            const chat = await Chats.createChat(
                userId,
                {
                    title: 'Test Chat',
                    chat: {
                        title: 'Test Chat',
                        models: [],
                        messages: [],
                        history: {
                            messages: {},
                        },
                        timestamp: currentUnixTimestamp()
                    },
                    folderId: folder.id,
                },
                db
            );

            assert.strictEqual(chat.folderId, folder.id);

            // Delete folder
            await Folders.deleteFolder(folder.id, userId, db);

            // Verify folder is gone
            const deletedFolder = await Folders.getFolderById(folder.id, userId, db);
            assert.strictEqual(deletedFolder, null);

            // Verify chat still exists but folderId is null
            const remainingChat = await Chats.getChatById(chat.id, db);
            assert.ok(remainingChat);
            assert.strictEqual(remainingChat.folderId, null);
        });

        test('should recursively delete all descendants', async () => {
            const root = await Folders.createFolder(
                userId,
                createTestFolderForm('Root'),
                null,
                db
            );
            const child1 = await Folders.createFolder(
                userId,
                createTestFolderForm('Child 1'),
                root.id,
                db
            );
            const child2 = await Folders.createFolder(
                userId,
                createTestFolderForm('Child 2'),
                root.id,
                db
            );
            const grandchild = await Folders.createFolder(
                userId,
                createTestFolderForm('Grandchild'),
                child1.id,
                db
            );

            const deletedIds = await Folders.deleteFolder(root.id, userId, db);

            assert.strictEqual(deletedIds.length, 4);
            assert.ok(deletedIds.includes(root.id));
            assert.ok(deletedIds.includes(child1.id));
            assert.ok(deletedIds.includes(child2.id));
            assert.ok(deletedIds.includes(grandchild.id));

            // Verify all are deleted
            assert.strictEqual(await Folders.getFolderById(root.id, userId, db), null);
            assert.strictEqual(await Folders.getFolderById(child1.id, userId, db), null);
            assert.strictEqual(await Folders.getFolderById(child2.id, userId, db), null);
            assert.strictEqual(await Folders.getFolderById(grandchild.id, userId, db), null);
        });

        test('should return array of deleted IDs in reverse order', async () => {
            const root = await Folders.createFolder(
                userId,
                createTestFolderForm('Root'),
                null,
                db
            );
            const child = await Folders.createFolder(
                userId,
                createTestFolderForm('Child'),
                root.id,
                db
            );

            const deletedIds = await Folders.deleteFolder(root.id, userId, db);

            assert.strictEqual(deletedIds.length, 2);
            assert.strictEqual(deletedIds[0], root.id);
            assert.strictEqual(deletedIds[1], child.id);
        });

        test('should delete folder with no children', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Leaf Folder'),
                null,
                db
            );

            const deletedIds = await Folders.deleteFolder(folder.id, userId, db);

            assert.strictEqual(deletedIds.length, 1);
            assert.strictEqual(deletedIds[0], folder.id);
        });

        test('should verify user ownership', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('My Folder'),
                null,
                db
            );

            const deletedIds = await Folders.deleteFolder(folder.id, otherUser.id, db);

            assert.strictEqual(deletedIds.length, 0);

            // Verify folder still exists
            const retrieved = await Folders.getFolderById(folder.id, userId, db);
            assert.ok(retrieved);
        });

        test('should return empty array for non-existent folder', async () => {
            const deletedIds = await Folders.deleteFolder('non-existent-id', userId, db);

            assert.strictEqual(deletedIds.length, 0);
        });

        test('should handle deletion of folder with nested hierarchy', async () => {
            let currentParent = await Folders.createFolder(
                userId,
                createTestFolderForm('Level 0'),
                null,
                db
            );

            for (let i = 1; i <= 3; i++) {
                currentParent = await Folders.createFolder(
                    userId,
                    createTestFolderForm(`Level ${i}`),
                    currentParent.id,
                    db
                );
            }

            const rootFolder = await Folders.getFolderByNameAndParentId('Level 0', null, userId, db);
            assert.ok(rootFolder);

            const deletedIds = await Folders.deleteFolder(rootFolder.id, userId, db);

            assert.strictEqual(deletedIds.length, 4);
        });
    });

    /* -------------------- DATA INTEGRITY -------------------- */

    describe('Data Integrity', () => {
        test('should isolate users folders', async () => {
            const user1 = await Users.createUser(newUserParams(), db);
            const user2 = await Users.createUser(newUserParams(), db);

            const user1Folder = await Folders.createFolder(
                user1.id,
                createTestFolderForm('User 1 Folder'),
                null,
                db
            );
            const user2Folder = await Folders.createFolder(
                user2.id,
                createTestFolderForm('User 2 Folder'),
                null,
                db
            );

            // User 1 can't see User 2's folders
            const user1Folders = await Folders.getFoldersByUserId(user1.id, db);
            assert.ok(!user1Folders.some(f => f.id === user2Folder.id));

            // User 2 can't see User 1's folders
            const user2Folders = await Folders.getFoldersByUserId(user2.id, db);
            assert.ok(!user2Folders.some(f => f.id === user1Folder.id));

            // User 1 can't access User 2's folder by ID
            const crossAccess = await Folders.getFolderById(user2Folder.id, user1.id, db);
            assert.strictEqual(crossAccess, null);
        });

        test('should verify timestamps are unix seconds not milliseconds', async () => {
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder'),
                null,
                db
            );

            // Unix seconds are 10 digits, milliseconds are 13
            const secondsLength = folder.createdAt.toString().length;
            assert.ok(secondsLength <= 10, 'Timestamp should be in seconds, not milliseconds');
            assert.ok(secondsLength >= 10, 'Timestamp should be valid unix seconds');
        });

        test('should handle null optional fields', async () => {
            const folderData: FolderForm = {
                name: 'Minimal Folder',
            };

            const folder = await Folders.createFolder(userId, folderData, null, db);

            assert.ok(folder.id);
            assert.strictEqual(folder.name, 'Minimal Folder');
            // Optional fields can be undefined or null based on schema
            assert.ok(folder.meta === undefined || folder.meta === null);
            assert.ok(folder.data === undefined || folder.data === null);
        });
    });

    /* -------------------- EDGE CASES -------------------- */

    describe('Edge Cases', () => {
        test('should handle folders with special characters in name', async () => {
            const specialNames = [
                'Folder/With/Slashes',
                'Folder\\With\\Backslashes',
                'Folder "With" Quotes',
                "Folder 'With' Apostrophes",
                'Folder <With> Brackets',
                'Folder & Ampersand',
            ];

            for (const name of specialNames) {
                const folder = await Folders.createFolder(
                    userId,
                    createTestFolderForm(name),
                    null,
                    db
                );

                assert.strictEqual(folder.name, name);

                const retrieved = await Folders.getFolderById(folder.id, userId, db);
                assert.ok(retrieved);
                assert.strictEqual(retrieved.name, name);
            }
        });

        test('should handle folders with long names', async () => {
            const longName = 'A'.repeat(255);
            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm(longName),
                null,
                db
            );

            assert.strictEqual(folder.name, longName);
        });

        test('should handle folders with unicode characters', async () => {
            const unicodeNames = [
                '文件夹',
                'フォルダ',
                'Папка',
                '📁 Folder',
                'Dossier 🇫🇷',
            ];

            for (const name of unicodeNames) {
                const folder = await Folders.createFolder(
                    userId,
                    createTestFolderForm(name),
                    null,
                    db
                );

                assert.strictEqual(folder.name, name);
            }
        });

        test('should handle complex nested data structures', async () => {
            const complexData: FolderData = {
                system_prompt: 'Complex system prompt',
                files: [
                    {
                        type: 'file',
                        id: 'file-1',
                        name: 'document.pdf',
                        size: 1024000,
                        status: 'uploaded',
                    },
                    {
                        type: 'collection',
                        id: 'collection-1',
                        name: 'Knowledge Base',
                        collection_name: 'kb-main',
                    },
                ],
                model_ids: ['model-1', 'model-2', 'model-3'],
            };

            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Complex Folder', undefined, complexData),
                null,
                db
            );

            assert.ok(folder.data);
            assert.deepStrictEqual(folder.data, complexData);

            const retrieved = await Folders.getFolderById(folder.id, userId, db);
            assert.ok(retrieved);
            assert.ok(retrieved.data);
            assert.deepStrictEqual(retrieved.data, complexData);
        });

        test('should handle updates that merge complex data', async () => {
            const initialData: FolderData = {
                system_prompt: 'Initial prompt',
                files: [
                    { type: 'file', id: 'file-1', name: 'doc1.pdf' },
                ],
                model_ids: ['model-1'],
            };

            const folder = await Folders.createFolder(
                userId,
                createTestFolderForm('Test Folder', undefined, initialData),
                null,
                db
            );

            const updateData: FolderData = {
                system_prompt: 'Updated prompt',
                files: [
                    { type: 'file', id: 'file-1', name: 'doc1.pdf' },
                    { type: 'file', id: 'file-2', name: 'doc2.pdf' },
                ],
            };

            const updated = await Folders.updateFolder(
                folder.id,
                userId,
                { data: updateData },
                db
            );

            assert.ok(updated);
            assert.ok(updated.data);
            assert.strictEqual(updated.data.system_prompt, 'Updated prompt');
            assert.strictEqual(updated.data.files?.length, 2);
            assert.deepStrictEqual(updated.data.model_ids, ['model-1']);
        });
    });
});
