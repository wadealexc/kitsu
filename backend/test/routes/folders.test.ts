import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { assertInMemoryDatabase, createUserWithToken, createTestFolderForm } from '../helpers.js';
import { db, schema, Folders, Chats, type Chat } from '../../src/db/index.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import foldersRouter from '../../src/routes/folders.js';

/* -------------------- TEST SETUP -------------------- */

// Ensure tests use in-memory database
assertInMemoryDatabase();

// Apply migrations to the in-memory database
await migrate(db, { migrationsFolder: './drizzle' });

// Helper function to clear database tables
async function clearDatabase() {
    await db.delete(schema.chats);
    await db.delete(schema.folders);
    await db.delete(schema.auths);
    await db.delete(schema.users);
}

// Create Express app with folders routes
const app: Express = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v1/folders', foldersRouter);

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Create a test folder
 */
async function createTestFolder(userId: string, name: string, parentId?: string): Promise<Folders.Folder> {
    const folder = await Folders.createFolder(createTestFolderForm(
        userId,
        name,
        parentId,
        { icon: ':folder:' },
        { systemPrompt: 'Test prompt' }
     ), db);

    return folder;
}

/**
 * Create multiple test folders
 */
async function createMultipleFolders(userId: string, count: number): Promise<Folders.Folder[]> {
    const folders: Folders.Folder[] = [];
    for (let i = 0; i < count; i++) {
        const folder = await createTestFolder(userId, `Folder ${i + 1}`);
        folders.push(folder);
    }
    return folders;
}

/**
 * Create a test chat
 */
async function createTestChat(userId: string, title: string = 'Test Chat', folderId: string | null = null): Promise<Chat> {
    const chat = await Chats.createChat(userId, {
        title,
        chat: {
            title: title,
            model: 'gpt-4',
            history: { messages: {} },
            timestamp: 0,
        },
        folderId
    }, db);

    return chat;
}

/* -------------------- TESTS -------------------- */

describe('GET /api/v1/folders/', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return all folders for user', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createMultipleFolders(userId, 3);

        const response = await request(app)
            .get('/api/v1/folders/')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(Array.isArray(response.body));
        assert.strictEqual(response.body.length, 3);

        const folder = response.body[0];
        assert.ok(folder.id);
        assert.ok(folder.name);
        assert.strictEqual(folder.parentId, null);
        assert.strictEqual(folder.isExpanded, false);
        assert.ok(typeof folder.createdAt === 'number');
        assert.ok(typeof folder.updatedAt === 'number');
    });

    test('should return empty array when user has no folders', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/folders/')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.deepStrictEqual(response.body, []);
    });

    test('should only return user own folders', async () => {
        const { userId: user1Id, token: token1 } = await createUserWithToken('user');
        const { userId: user2Id } = await createUserWithToken('user');

        await createTestFolder(user1Id, 'User1 Folder');
        await createTestFolder(user2Id, 'User2 Folder');

        const response = await request(app)
            .get('/api/v1/folders/')
            .set('Authorization', `Bearer ${token1}`)
            .expect(200);

        assert.strictEqual(response.body.length, 1);
        assert.strictEqual(response.body[0].name, 'User1 Folder');
    });

    test('should include hierarchical folders', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent = await createTestFolder(userId, 'Parent');
        await createTestFolder(userId, 'Child', parent.id);

        const response = await request(app)
            .get('/api/v1/folders/')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.length, 2);
        const childFolder = response.body.find((f: any) => f.name === 'Child');
        assert.strictEqual(childFolder.parentId, parent.id);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/folders/')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/folders/')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('POST /api/v1/folders/', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should create folder successfully', async () => {
        const { userId, token } = await createUserWithToken('user');

        const folderData = {
            name: 'My New Folder',
            meta: { icon: ':star:' },
            data: { systemPrompt: 'You are helpful' }
        };

        const response = await request(app)
            .post('/api/v1/folders/')
            .set('Authorization', `Bearer ${token}`)
            .send(folderData)
            .expect(200);

        assert.ok(response.body.id);
        assert.strictEqual(response.body.userId, userId);
        assert.strictEqual(response.body.name, 'My New Folder');
        assert.strictEqual(response.body.parentId, null);
        assert.strictEqual(response.body.isExpanded, false);
        assert.strictEqual(response.body.meta.icon, ':star:');
        assert.strictEqual(response.body.data.systemPrompt, 'You are helpful');
    });

    test('should create folder with minimal data', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/folders/')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Simple Folder' })
            .expect(200);

        assert.ok(response.body.id);
        assert.strictEqual(response.body.name, 'Simple Folder');
    });

    test('should reject duplicate folder names at root level', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createTestFolder(userId, 'Duplicate');

        const response = await request(app)
            .post('/api/v1/folders/')
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Duplicate' })
            .expect(400);

        assert.ok(response.body.detail);
    });

    test('should fail with missing name', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/folders/')
            .set('Authorization', `Bearer ${token}`)
            .send({ meta: { icon: ':folder:' } })
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .post('/api/v1/folders/')
            .send({ name: 'Test' })
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .post('/api/v1/folders/')
            .set('Authorization', 'Bearer invalid_token')
            .send({ name: 'Test' })
            .expect(401);
    });

    test('should validate request body schema', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/folders/')
            .set('Authorization', `Bearer ${token}`)
            .send({ invalid_field: 'value' })
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('GET /api/v1/folders/:folder_id', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return folder by ID', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test Folder');

        const response = await request(app)
            .get(`/api/v1/folders/${folder.id}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.id, folder.id);
        assert.strictEqual(response.body.name, 'Test Folder');
        assert.strictEqual(response.body.userId, userId);
        assert.ok(response.body.meta);
        assert.ok(response.body.data);
    });

    test('should return 404 when folder not found', async () => {
        const { token } = await createUserWithToken('user');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .get(`/api/v1/folders/${nonExistentId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(404);

        assert.strictEqual(response.body.detail, 'Folder not found');
    });

    test('should return 404 when user does not own folder', async () => {
        const { userId: user1Id } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        const folder = await createTestFolder(user1Id, 'User1 Folder');

        const response = await request(app)
            .get(`/api/v1/folders/${folder.id}`)
            .set('Authorization', `Bearer ${token2}`)
            .expect(404);

        assert.strictEqual(response.body.detail, 'Folder not found');
    });

    test('should fail without authentication token', async () => {
        const { userId } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        await request(app)
            .get(`/api/v1/folders/${folder.id}`)
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        const { userId } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        await request(app)
            .get(`/api/v1/folders/${folder.id}`)
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('POST /api/v1/folders/:folder_id/update', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should update folder name', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Old Name');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'New Name' })
            .expect(200);

        assert.strictEqual(response.body.name, 'New Name');
        assert.strictEqual(response.body.id, folder.id);
    });

    test('should update folder meta', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send({ meta: { icon: ':rocket:' } })
            .expect(200);

        assert.strictEqual(response.body.meta.icon, ':rocket:');
    });

    test('should update folder data', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                data: {
                    systemPrompt: 'Updated prompt',
                    modelId: 'gpt-4'
                }
            })
            .expect(200);

        assert.strictEqual(response.body.data.systemPrompt, 'Updated prompt');
        assert.strictEqual(response.body.data.modelId, 'gpt-4');
    });

    test('should merge data and meta with existing values', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await Folders.createFolder(createTestFolderForm(
            userId,
            'Test Folder',
            undefined,
            { icon: ':folder:' },
            { systemPrompt: 'Original', modelId: 'gpt-4' }
        ), db);

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                data: { files: [{ type: 'file', id: 'file-1', name: 'doc.pdf' }] }
            })
            .expect(200);

        // Original fields should still be present
        assert.strictEqual(response.body.data.systemPrompt, 'Original');
        assert.ok(response.body.data.modelId);
        // New field should be added
        assert.ok(response.body.data.files);
    });

    test('should reject duplicate name within same parent', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createTestFolder(userId, 'Existing');
        const folder = await createTestFolder(userId, 'ToRename');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'Existing' })
            .expect(400);

        assert.ok(response.body.detail);
    });

    test('should allow same name in different parents', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent1 = await createTestFolder(userId, 'Parent1');
        const parent2 = await createTestFolder(userId, 'Parent2');

        await createTestFolder(userId, 'SameName', parent1.id);
        const folder2 = await createTestFolder(userId, 'Different', parent2.id);

        const response = await request(app)
            .post(`/api/v1/folders/${folder2.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'SameName' })
            .expect(200);

        assert.strictEqual(response.body.name, 'SameName');
    });

    test('should return 400 when folder not found', async () => {
        const { token } = await createUserWithToken('user');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .post(`/api/v1/folders/${nonExistentId}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send({ name: 'New Name' })
            .expect(400);

        assert.strictEqual(response.body.detail, `folder record with id '${nonExistentId}' not found`);
    });

    test('should fail when user does not own folder', async () => {
        const { userId: user1Id } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        const folder = await createTestFolder(user1Id, 'Test');

        await request(app)
            .post(`/api/v1/folders/${folder.id}/update`)
            .set('Authorization', `Bearer ${token2}`)
            .send({ name: 'New Name' })
            .expect(400);
    });

    test('should fail without authentication token', async () => {
        const { userId } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        await request(app)
            .post(`/api/v1/folders/${folder.id}/update`)
            .send({ name: 'New' })
            .expect(401);
    });

    test('should validate request body', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update`)
            .set('Authorization', `Bearer ${token}`)
            .send('invalid')
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('POST /api/v1/folders/:folder_id/update/parent', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should move folder to new parent', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent1 = await createTestFolder(userId, 'Parent1');
        const parent2 = await createTestFolder(userId, 'Parent2');
        const child = await createTestFolder(userId, 'Child', parent1.id);

        const response = await request(app)
            .post(`/api/v1/folders/${child.id}/update/parent`)
            .set('Authorization', `Bearer ${token}`)
            .send({ parentId: parent2.id })
            .expect(200);

        assert.strictEqual(response.body.parentId, parent2.id);
    });

    test('should move folder to root level', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent = await createTestFolder(userId, 'Parent');
        const child = await createTestFolder(userId, 'Child', parent.id);

        const response = await request(app)
            .post(`/api/v1/folders/${child.id}/update/parent`)
            .set('Authorization', `Bearer ${token}`)
            .send({ parentId: null })
            .expect(200);

        assert.strictEqual(response.body.parentId, null);
    });

    test('should prevent circular reference (folder as own parent)', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update/parent`)
            .set('Authorization', `Bearer ${token}`)
            .send({ parentId: folder.id })
            .expect(400);

        assert.ok(response.body.detail);
    });

    test('should prevent circular reference (folder to its descendant)', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent = await createTestFolder(userId, 'Parent');
        const child = await createTestFolder(userId, 'Child', parent.id);
        const grandchild = await createTestFolder(userId, 'Grandchild', child.id);

        const response = await request(app)
            .post(`/api/v1/folders/${parent.id}/update/parent`)
            .set('Authorization', `Bearer ${token}`)
            .send({ parentId: grandchild.id })
            .expect(400);

        assert.ok(response.body.detail);
    });

    test('should fail when new parent does not exist', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update/parent`)
            .set('Authorization', `Bearer ${token}`)
            .send({ parentId: nonExistentId })
            .expect(400);

        assert.ok(response.body.detail);
    });

    test('should fail when duplicate name exists in target parent', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent1 = await createTestFolder(userId, 'Parent1');
        const parent2 = await createTestFolder(userId, 'Parent2');

        await createTestFolder(userId, 'SameName', parent2.id);
        const child = await createTestFolder(userId, 'SameName', parent1.id);

        const response = await request(app)
            .post(`/api/v1/folders/${child.id}/update/parent`)
            .set('Authorization', `Bearer ${token}`)
            .send({ parentId: parent2.id })
            .expect(400);

        assert.ok(response.body.detail);
    });

    test('should return 400 when folder not found', async () => {
        const { token } = await createUserWithToken('user');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .post(`/api/v1/folders/${nonExistentId}/update/parent`)
            .set('Authorization', `Bearer ${token}`)
            .send({ parentId: null })
            .expect(400);

        assert.strictEqual(response.body.detail, `folder record with id '${nonExistentId}' not found`);
    });

    test('should fail without authentication token', async () => {
        const { userId } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        await request(app)
            .post(`/api/v1/folders/${folder.id}/update/parent`)
            .send({ parentId: null })
            .expect(401);
    });
});

describe('POST /api/v1/folders/:folder_id/update/expanded', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should update expansion state to true', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update/expanded`)
            .set('Authorization', `Bearer ${token}`)
            .send({ isExpanded: true })
            .expect(200);

        assert.strictEqual(response.body.isExpanded, true);
    });

    test('should update expansion state to false', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await Folders.createFolder(createTestFolderForm(
            userId,
            'Test',
        ), db);

        await Folders.updateFolderExpanded(folder.id, userId, true, db);

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update/expanded`)
            .set('Authorization', `Bearer ${token}`)
            .send({ isExpanded: false })
            .expect(200);

        assert.strictEqual(response.body.isExpanded, false);
    });

    test('should return 400 when folder not found', async () => {
        const { token } = await createUserWithToken('user');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .post(`/api/v1/folders/${nonExistentId}/update/expanded`)
            .set('Authorization', `Bearer ${token}`)
            .send({ isExpanded: true })
            .expect(400);

        assert.strictEqual(response.body.detail, `folder record with id '${nonExistentId}' not found`);
    });

    test('should fail when user does not own folder', async () => {
        const { userId: user1Id } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        const folder = await createTestFolder(user1Id, 'Test');

        await request(app)
            .post(`/api/v1/folders/${folder.id}/update/expanded`)
            .set('Authorization', `Bearer ${token2}`)
            .send({ isExpanded: true })
            .expect(400);
    });

    test('should fail without authentication token', async () => {
        const { userId } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        await request(app)
            .post(`/api/v1/folders/${folder.id}/update/expanded`)
            .send({ isExpanded: true })
            .expect(401);
    });

    test('should validate request body', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update/expanded`)
            .set('Authorization', `Bearer ${token}`)
            .send({ isExpanded: 'not_a_boolean' })
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });

    test('should fail with missing is_expanded field', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        const response = await request(app)
            .post(`/api/v1/folders/${folder.id}/update/expanded`)
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('DELETE /api/v1/folders/:folder_id', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should delete folder and chats when delete_contents=true', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');
        await createTestChat(userId, 'Chat 1', folder.id);
        await createTestChat(userId, 'Chat 2', folder.id);

        const response = await request(app)
            .delete(`/api/v1/folders/${folder.id}`)
            .query({ deleteContents: true })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body, true);

        // Verify folder deleted
        const deletedFolder = await Folders.getFolderById(folder.id, userId, db);
        assert.strictEqual(deletedFolder, null);

        // Verify chats deleted
        const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);
        assert.strictEqual(chats.length, 0);
    });

    test('should delete folder and move chats to root when delete_contents=false', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');
        const chat1 = await createTestChat(userId, 'Chat 1', folder.id);
        const chat2 = await createTestChat(userId, 'Chat 2', folder.id);

        const response = await request(app)
            .delete(`/api/v1/folders/${folder.id}`)
            .query({ deleteContents: false })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body, true);

        // Verify folder deleted
        const deletedFolder = await Folders.getFolderById(folder.id, userId, db);
        assert.strictEqual(deletedFolder, null);

        // Verify chats moved to root
        const movedChat1 = await Chats.getChatById(chat1.id, db);
        const movedChat2 = await Chats.getChatById(chat2.id, db);
        assert.strictEqual(movedChat1?.folderId, null);
        assert.strictEqual(movedChat2?.folderId, null);
    });

    test('should default to delete_contents=true', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');
        await createTestChat(userId, 'Chat', folder.id);

        await request(app)
            .delete(`/api/v1/folders/${folder.id}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Verify chats deleted (default behavior)
        const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);
        assert.strictEqual(chats.length, 0);
    });

    test('should delete folder hierarchy recursively', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent = await createTestFolder(userId, 'Parent');
        const child1 = await createTestFolder(userId, 'Child1', parent.id);
        const child2 = await createTestFolder(userId, 'Child2', parent.id);
        const grandchild = await createTestFolder(userId, 'Grandchild', child1.id);

        await request(app)
            .delete(`/api/v1/folders/${parent.id}`)
            .query({ deleteContents: true })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Verify all folders deleted
        const deletedParent = await Folders.getFolderById(parent.id, userId, db);
        const deletedChild1 = await Folders.getFolderById(child1.id, userId, db);
        const deletedChild2 = await Folders.getFolderById(child2.id, userId, db);
        const deletedGrandchild = await Folders.getFolderById(grandchild.id, userId, db);

        assert.strictEqual(deletedParent, null);
        assert.strictEqual(deletedChild1, null);
        assert.strictEqual(deletedChild2, null);
        assert.strictEqual(deletedGrandchild, null);
    });

    test('should delete chats in all descendant folders when delete_contents=true', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent = await createTestFolder(userId, 'Parent');
        const child = await createTestFolder(userId, 'Child', parent.id);

        await createTestChat(userId, 'Parent Chat', parent.id);
        await createTestChat(userId, 'Child Chat', child.id);

        await request(app)
            .delete(`/api/v1/folders/${parent.id}`)
            .query({ deleteContents: true })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Verify all chats deleted
        const chats = await Chats.getChatsByUserId(userId, db);
        assert.strictEqual(chats.length, 0);
    });

    test('should move chats from all descendant folders to root when delete_contents=false', async () => {
        const { userId, token } = await createUserWithToken('user');
        const parent = await createTestFolder(userId, 'Parent');
        const child = await createTestFolder(userId, 'Child', parent.id);

        const chat1 = await createTestChat(userId, 'Parent Chat', parent.id);
        const chat2 = await createTestChat(userId, 'Child Chat', child.id);

        await request(app)
            .delete(`/api/v1/folders/${parent.id}`)
            .query({ deleteContents: false })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Verify all chats moved to root
        const movedChat1 = await Chats.getChatById(chat1.id, db);
        const movedChat2 = await Chats.getChatById(chat2.id, db);
        assert.strictEqual(movedChat1?.folderId, null);
        assert.strictEqual(movedChat2?.folderId, null);
    });

    test('should return 404 when folder not found', async () => {
        const { token } = await createUserWithToken('user');
        const nonExistentId = crypto.randomUUID();

        const response = await request(app)
            .delete(`/api/v1/folders/${nonExistentId}`)
            .set('Authorization', `Bearer ${token}`)
            .expect(404);

        assert.strictEqual(response.body.detail, 'Folder not found');
    });

    test('should fail when user does not own folder', async () => {
        const { userId: user1Id } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        const folder = await createTestFolder(user1Id, 'Test');

        await request(app)
            .delete(`/api/v1/folders/${folder.id}`)
            .set('Authorization', `Bearer ${token2}`)
            .expect(404);
    });

    test('should fail without authentication token', async () => {
        const { userId } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        await request(app)
            .delete(`/api/v1/folders/${folder.id}`)
            .expect(401);
    });

    test('should validate query parameters', async () => {
        const { userId, token } = await createUserWithToken('user');
        const folder = await createTestFolder(userId, 'Test');

        const response = await request(app)
            .delete(`/api/v1/folders/${folder.id}`)
            .query({ deleteContents: 'invalid_boolean' })
            .set('Authorization', `Bearer ${token}`)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});
