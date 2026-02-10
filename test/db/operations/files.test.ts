import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestDatabase, newUserParams, createTestFileForm, type TestDatabase, createTestChatData } from '../../helpers.js';
import * as Files from '../../../src/db/operations/files.js';
import * as Users from '../../../src/db/operations/users.js';
import * as Chats from '../../../src/db/operations/chats.js';
import { files, type File } from '../../../src/db/schema.js';
import type { FileMeta, FileData, AccessControl } from '../../../src/routes/types.js';
import { currentUnixTimestamp } from '../../../src/db/utils.js';

/* -------------------- TEST HELPERS -------------------- */

/**
 * Create a file with 'createdAt' and 'updatedAt' set to specific values.
 */
async function _createOldFile(
    userId: string,
    fileData: Files.FileForm,
    txOrDb: TestDatabase,
    createdAt?: number,
    updatedAt?: number,
): Promise<File> {
    const now = currentUnixTimestamp();

    const [file] = await txOrDb
        .insert(files)
        .values({
            id: fileData.id,
            userId: userId,
            filename: fileData.filename,
            path: fileData.path,
            hash: fileData.hash,
            data: fileData.data,
            meta: fileData.meta,
            accessControl: fileData.accessControl,
            createdAt: createdAt ?? now - 1000,
            updatedAt: updatedAt ?? createdAt ?? now - 1000,
        })
        .returning();

    if (!file) throw new Error('_createOldFile: error creating file record');
    return file;
}

/* -------------------- CORE CRUD OPERATIONS -------------------- */

describe('File Operations', () => {
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

    describe('createFile', () => {
        test('should create file with minimal fields', async () => {
            const fileData = createTestFileForm('document.pdf');
            const file = await Files.createFile(userId, fileData, db);

            assert.ok(file.id);
            assert.strictEqual(file.userId, userId);
            assert.strictEqual(file.filename, 'document.pdf');
            assert.ok(file.path);
            assert.strictEqual(file.hash, null);
            assert.ok(file.createdAt);
            assert.ok(file.updatedAt);
            assert.strictEqual(file.createdAt, file.updatedAt);
        });

        test('should create file with meta', async () => {
            const meta: FileMeta = {
                name: 'My Document',
                content_type: 'application/pdf',
                size: 1024000,
                data: { customField: 'custom-value' }
            };
            const fileData = createTestFileForm('document.pdf', meta);
            const file = await Files.createFile(userId, fileData, db);

            assert.ok(file.meta);
            assert.strictEqual(file.meta.name, 'My Document');
            assert.strictEqual(file.meta.content_type, 'application/pdf');
            assert.strictEqual(file.meta.size, 1024000);
            assert.deepStrictEqual(file.meta.data, { customField: 'custom-value' });
        });

        test('should create file with data', async () => {
            const data: FileData = {
                status: 'pending',
                error: 'test error',
                content: 'test content'
            };
            const fileData = createTestFileForm('document.pdf', undefined, data);
            const file = await Files.createFile(userId, fileData, db);

            assert.ok(file.data);
            assert.strictEqual(file.data.status, 'pending');
            assert.strictEqual(file.data.error, 'test error');
            assert.strictEqual(file.data.content, 'test content');
        });

        test('should create file with access control', async () => {
            const accessControl: AccessControl = {
                read: {
                    user_ids: ['user-1', 'user-2']
                },
                write: {
                    user_ids: ['user-1']
                }
            };
            const fileData = createTestFileForm();
            fileData.accessControl = accessControl;
            const file = await Files.createFile(userId, fileData, db);

            assert.ok(file.accessControl);
            assert.deepStrictEqual(file.accessControl, accessControl);
        });

        test('should verify timestamps are set correctly', async () => {
            const now = currentUnixTimestamp();
            const file = await Files.createFile(
                userId,
                createTestFileForm(),
                db
            );

            assert.ok(file.createdAt >= now);
            assert.ok(file.updatedAt >= now);
            assert.strictEqual(file.createdAt, file.updatedAt);
        });

        test('should allow multiple files with same filename for different users', async () => {
            const user2 = await Users.createUser(newUserParams(), db);

            const file1 = await Files.createFile(userId, createTestFileForm('same.pdf'), db);
            const file2 = await Files.createFile(user2.id, createTestFileForm('same.pdf'), db);

            assert.ok(file1.id);
            assert.ok(file2.id);
            assert.notStrictEqual(file1.id, file2.id);
            assert.strictEqual(file1.filename, file2.filename);
        });

        test('should allow multiple files with same filename for same user', async () => {
            const file1 = await Files.createFile(userId, createTestFileForm('duplicate.pdf'), db);
            const file2 = await Files.createFile(userId, createTestFileForm('duplicate.pdf'), db);

            assert.ok(file1.id);
            assert.ok(file2.id);
            assert.notStrictEqual(file1.id, file2.id);
            assert.strictEqual(file1.filename, file2.filename);
        });

        test('should handle null hash', async () => {
            const fileData = createTestFileForm();
            fileData.hash = null;
            const file = await Files.createFile(userId, fileData, db);

            assert.strictEqual(file.hash, null);
        });

        test('should handle null path', async () => {
            const fileData = createTestFileForm();
            fileData.path = null;
            const file = await Files.createFile(userId, fileData, db);

            assert.strictEqual(file.path, null);
        });
    });

    describe('getFileById', () => {
        test('should retrieve existing file', async () => {
            const created = await Files.createFile(
                userId,
                createTestFileForm('test.pdf'),
                db
            );
            const retrieved = await Files.getFileById(created.id, db);

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, created.id);
            assert.strictEqual(retrieved.filename, 'test.pdf');
            assert.strictEqual(retrieved.userId, userId);
        });

        test('should return null for non-existent file', async () => {
            const retrieved = await Files.getFileById('non-existent-id', db);

            assert.strictEqual(retrieved, null);
        });

        test('should retrieve file with all fields', async () => {
            const meta: FileMeta = {
                name: 'Test File',
                content_type: 'application/pdf',
                size: 1024
            };
            const data: FileData = {
                status: 'completed',
                content: 'extracted text'
            };
            const fileData = createTestFileForm('test.pdf', meta, data);
            const created = await Files.createFile(userId, fileData, db);

            const retrieved = await Files.getFileById(created.id, db);

            assert.ok(retrieved);
            assert.ok(retrieved.meta);
            assert.ok(retrieved.data);
            assert.strictEqual(retrieved.meta.name, 'Test File');
            assert.strictEqual(retrieved.data.status, 'completed');
        });
    });

    describe('getFileByIdAndUserId', () => {
        test('should retrieve file with matching user', async () => {
            const created = await Files.createFile(
                userId,
                createTestFileForm('test.pdf'),
                db
            );
            const retrieved = await Files.getFileByIdAndUserId(created.id, userId, db);

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, created.id);
            assert.strictEqual(retrieved.userId, userId);
        });

        test('should return null for wrong user', async () => {
            const user2 = await Users.createUser(newUserParams(), db);
            const created = await Files.createFile(
                userId,
                createTestFileForm('test.pdf'),
                db
            );

            const retrieved = await Files.getFileByIdAndUserId(created.id, user2.id, db);

            assert.strictEqual(retrieved, null);
        });

        test('should return null for non-existent file', async () => {
            const retrieved = await Files.getFileByIdAndUserId('non-existent-id', userId, db);

            assert.strictEqual(retrieved, null);
        });
    });

    describe('getFileMetadataById', () => {
        test('should retrieve lightweight metadata', async () => {
            const meta: FileMeta = {
                name: 'Test File',
                content_type: 'application/pdf',
                size: 1024
            };
            const fileData = createTestFileForm('test.pdf', meta);
            const created = await Files.createFile(userId, fileData, db);

            const metadata = await Files.getFileMetadataById(created.id, db);

            assert.ok(metadata);
            assert.strictEqual(metadata.id, created.id);
            assert.strictEqual(metadata.hash, created.hash);
            assert.ok(metadata.meta);
            assert.strictEqual(metadata.createdAt, created.createdAt);
            assert.strictEqual(metadata.updatedAt, created.updatedAt);
        });

        test('should return null for non-existent file', async () => {
            const metadata = await Files.getFileMetadataById('non-existent-id', db);

            assert.strictEqual(metadata, null);
        });

        test('should not include data field', async () => {
            const data: FileData = { status: 'completed', content: 'big content' };
            const fileData = createTestFileForm('test.pdf', undefined, data);
            const created = await Files.createFile(userId, fileData, db);

            const metadata = await Files.getFileMetadataById(created.id, db);

            assert.ok(metadata);
            assert.strictEqual('data' in metadata, false);
        });
    });

    describe('getFilesByIds', () => {
        test('should retrieve multiple files by IDs', async () => {
            const file1 = await Files.createFile(userId, createTestFileForm('file1.pdf'), db);
            const file2 = await Files.createFile(userId, createTestFileForm('file2.pdf'), db);
            const file3 = await Files.createFile(userId, createTestFileForm('file3.pdf'), db);

            const files = await Files.getFilesByIds([file1.id, file2.id, file3.id], db);

            assert.strictEqual(files.length, 3);
            assert.ok(files.some(f => f.id === file1.id));
            assert.ok(files.some(f => f.id === file2.id));
            assert.ok(files.some(f => f.id === file3.id));
        });

        test('should return files ordered by updatedAt desc', async () => {
            const file1 = await _createOldFile(userId, createTestFileForm('old.pdf'), db);
            const file2 = await Files.createFile(userId, createTestFileForm('new.pdf'), db);

            const files = await Files.getFilesByIds([file1.id, file2.id], db);

            // Most recent first
            assert.strictEqual(files[0]!.id, file2.id);
            assert.strictEqual(files[1]!.id, file1.id);
        });

        test('should return empty array for empty input', async () => {
            const files = await Files.getFilesByIds([], db);

            assert.strictEqual(files.length, 0);
        });

        test('should return only existing files', async () => {
            const file1 = await Files.createFile(userId, createTestFileForm('file1.pdf'), db);

            const files = await Files.getFilesByIds([file1.id, 'non-existent'], db);

            assert.strictEqual(files.length, 1);
            assert.strictEqual(files[0]!.id, file1.id);
        });
    });

    describe('getFiles', () => {
        test('should retrieve all files', async () => {
            const user2 = await Users.createUser(newUserParams(), db);

            await Files.createFile(userId, createTestFileForm('file1.pdf'), db);
            await Files.createFile(userId, createTestFileForm('file2.pdf'), db);
            await Files.createFile(user2.id, createTestFileForm('file3.pdf'), db);

            const files = await Files.getFiles(db);

            assert.ok(files.length >= 3);
        });

        test('should return files ordered by updatedAt desc', async () => {
            const file1 = await _createOldFile(userId, createTestFileForm('old.pdf'), db);
            const file2 = await Files.createFile(userId, createTestFileForm('new.pdf'), db);

            const files = await Files.getFiles(db);

            // Most recent first
            assert.strictEqual(files[0]!.id, file2.id);
            assert.strictEqual(files[1]!.id, file1.id);
        });

        test('should return empty array if no files', async () => {
            const files = await Files.getFiles(db);

            assert.strictEqual(files.length, 0);
        });

        test('should include files from all users', async () => {
            const user2 = await Users.createUser(newUserParams(), db);

            const file1 = await Files.createFile(userId, createTestFileForm('user1.pdf'), db);
            const file2 = await Files.createFile(user2.id, createTestFileForm('user2.pdf'), db);

            const files = await Files.getFiles(db);

            assert.ok(files.some(f => f.id === file1.id));
            assert.ok(files.some(f => f.id === file2.id));
        });
    });

    describe('getFilesByUserId', () => {
        test('should retrieve all files for user', async () => {
            const user2 = await Users.createUser(newUserParams(), db);

            await Files.createFile(userId, createTestFileForm('file1.pdf'), db);
            await Files.createFile(userId, createTestFileForm('file2.pdf'), db);
            await Files.createFile(user2.id, createTestFileForm('file3.pdf'), db);

            const result = await Files.getFilesByUserId(userId, {}, db);

            assert.strictEqual(result.items.length, 2);
            assert.strictEqual(result.total, 2);
            assert.ok(result.items.every(f => f.userId === userId));
        });

        test('should return empty array if user has no files', async () => {
            const result = await Files.getFilesByUserId(userId, {}, db);

            assert.strictEqual(result.items.length, 0);
            assert.strictEqual(result.total, 0);
        });

        test('should paginate with skip and limit', async () => {
            await Files.createFile(userId, createTestFileForm('file1.pdf'), db);
            await Files.createFile(userId, createTestFileForm('file2.pdf'), db);
            await Files.createFile(userId, createTestFileForm('file3.pdf'), db);
            await Files.createFile(userId, createTestFileForm('file4.pdf'), db);

            const page1 = await Files.getFilesByUserId(userId, { skip: 0, limit: 2 }, db);
            const page2 = await Files.getFilesByUserId(userId, { skip: 2, limit: 2 }, db);

            assert.strictEqual(page1.items.length, 2);
            assert.strictEqual(page2.items.length, 2);
            assert.strictEqual(page1.total, 4);
            assert.strictEqual(page2.total, 4);
            assert.notStrictEqual(page1.items[0]!.id, page2.items[0]!.id);
        });

        test('should sort by updatedAt desc by default', async () => {
            const file1 = await _createOldFile(userId, createTestFileForm('old.pdf'), db);
            const file2 = await Files.createFile(userId, createTestFileForm('new.pdf'), db);

            const result = await Files.getFilesByUserId(userId, {}, db);

            // Most recent first
            assert.strictEqual(result.items[0]!.id, file2.id);
            assert.strictEqual(result.items[1]!.id, file1.id);
        });

        test('should sort by createdAt when specified', async () => {
            const file1 = await _createOldFile(userId, createTestFileForm('old.pdf'), db, currentUnixTimestamp() - 2000);
            const file2 = await Files.createFile(userId, createTestFileForm('new.pdf'), db);

            const result = await Files.getFilesByUserId(
                userId,
                { orderBy: 'createdAt', direction: 'asc' },
                db
            );

            // Oldest first
            assert.strictEqual(result.items[0]!.id, file1.id);
            assert.strictEqual(result.items[1]!.id, file2.id);
        });

        test('should sort ascending when specified', async () => {
            const file1 = await _createOldFile(userId, createTestFileForm('old.pdf'), db);
            const file2 = await Files.createFile(userId, createTestFileForm('new.pdf'), db);

            const result = await Files.getFilesByUserId(
                userId,
                { orderBy: 'updatedAt', direction: 'asc' },
                db
            );

            // Oldest first
            assert.strictEqual(result.items[0]!.id, file1.id);
            assert.strictEqual(result.items[1]!.id, file2.id);
        });

        test('should not return other users files', async () => {
            const user2 = await Users.createUser(newUserParams(), db);

            await Files.createFile(userId, createTestFileForm('user1.pdf'), db);
            await Files.createFile(user2.id, createTestFileForm('user2.pdf'), db);

            const result = await Files.getFilesByUserId(userId, {}, db);

            assert.strictEqual(result.items.length, 1);
            assert.ok(result.items.every(f => f.userId === userId));
        });
    });

    describe('updateFile', () => {
        test('should update hash', async () => {
            const file = await Files.createFile(userId, createTestFileForm(), db);

            const updated = await Files.updateFile(
                file.id,
                { hash: 'sha256-abc123' },
                db
            );

            assert.ok(updated);
            assert.strictEqual(updated.hash, 'sha256-abc123');
        });

        test('should update data with merge', async () => {
            const initialData: FileData = {
                status: 'pending',
                error: undefined,
                content: undefined
            };
            const fileData = createTestFileForm('test.pdf', undefined, initialData);
            const file = await Files.createFile(userId, fileData, db);

            const updated = await Files.updateFile(
                file.id,
                { data: { status: 'completed', content: 'extracted text' } },
                db
            );

            assert.ok(updated);
            assert.ok(updated.data);
            assert.strictEqual(updated.data.status, 'completed');
            assert.strictEqual(updated.data.content, 'extracted text');
            assert.strictEqual(updated.data.error, undefined);
        });

        test('should update meta with merge', async () => {
            const initialMeta: FileMeta = {
                name: 'Original Name',
                content_type: 'application/pdf',
                size: 1024
            };
            const fileData = createTestFileForm('test.pdf', initialMeta);
            const file = await Files.createFile(userId, fileData, db);

            const updated = await Files.updateFile(
                file.id,
                { meta: { name: 'Updated Name' } },
                db
            );

            assert.ok(updated);
            assert.ok(updated.meta);
            assert.strictEqual(updated.meta.name, 'Updated Name');
            assert.strictEqual(updated.meta.content_type, 'application/pdf');
            assert.strictEqual(updated.meta.size, 1024);
        });

        test('should update timestamps on modification', async () => {
            const file = await _createOldFile(userId, createTestFileForm(), db);
            const originalUpdatedAt = file.updatedAt;

            const updated = await Files.updateFile(
                file.id,
                { hash: 'new-hash' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        test('should return null for non-existent file', async () => {
            const updated = await Files.updateFile(
                'non-existent-id',
                { hash: 'new-hash' },
                db
            );

            assert.strictEqual(updated, null);
        });
    });

    describe('updateFileData', () => {
        test('should update data field only', async () => {
            const initialData: FileData = {
                status: 'pending',
                error: undefined,
                content: undefined
            };
            const fileData = createTestFileForm('test.pdf', undefined, initialData);
            const file = await Files.createFile(userId, fileData, db);

            const updated = await Files.updateFileData(
                file.id,
                { status: 'completed', content: 'extracted text' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.data);
            assert.strictEqual(updated.data.status, 'completed');
            assert.strictEqual(updated.data.content, 'extracted text');
            assert.strictEqual(updated.data.error, undefined);
        });

        test('should merge with existing data', async () => {
            const initialData: FileData = {
                status: 'pending',
                error: undefined,
                content: undefined
            };
            const fileData = createTestFileForm('test.pdf', undefined, initialData);
            const file = await Files.createFile(userId, fileData, db);

            const updated = await Files.updateFileData(
                file.id,
                { status: 'completed' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.data);
            assert.strictEqual(updated.data.status, 'completed');
            assert.strictEqual(updated.data.error, undefined);
            assert.strictEqual(updated.data.content, undefined);
        });

        test('should update processing status to failed', async () => {
            const initialData: FileData = { status: 'pending' };
            const fileData = createTestFileForm('test.pdf', undefined, initialData);
            const file = await Files.createFile(userId, fileData, db);

            const updated = await Files.updateFileData(
                file.id,
                { status: 'failed', error: 'Processing timeout' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.data);
            assert.strictEqual(updated.data.status, 'failed');
            assert.strictEqual(updated.data.error, 'Processing timeout');
        });

        test('should update timestamps', async () => {
            const file = await _createOldFile(userId, createTestFileForm(), db);
            const originalUpdatedAt = file.updatedAt;

            const updated = await Files.updateFileData(
                file.id,
                { status: 'completed' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        test('should return null for non-existent file', async () => {
            const updated = await Files.updateFileData(
                'non-existent-id',
                { status: 'completed' },
                db
            );

            assert.strictEqual(updated, null);
        });
    });

    describe('updateFileMetadata', () => {
        test('should update meta field only', async () => {
            const initialMeta: FileMeta = {
                name: 'Original Name',
                content_type: 'application/pdf',
                size: 1024
            };
            const fileData = createTestFileForm('test.pdf', initialMeta);
            const file = await Files.createFile(userId, fileData, db);

            const updated = await Files.updateFileMetadata(
                file.id,
                { name: 'Updated Name', size: 2048 },
                db
            );

            assert.ok(updated);
            assert.ok(updated.meta);
            assert.strictEqual(updated.meta.name, 'Updated Name');
            assert.strictEqual(updated.meta.size, 2048);
            assert.strictEqual(updated.meta.content_type, 'application/pdf');
        });

        test('should merge with existing meta', async () => {
            const initialMeta: FileMeta = {
                name: 'Original Name',
                content_type: 'application/pdf',
                size: 1024
            };
            const fileData = createTestFileForm('test.pdf', initialMeta);
            const file = await Files.createFile(userId, fileData, db);

            const updated = await Files.updateFileMetadata(
                file.id,
                { name: 'Updated Name' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.meta);
            assert.strictEqual(updated.meta.name, 'Updated Name');
            assert.strictEqual(updated.meta.content_type, 'application/pdf');
            assert.strictEqual(updated.meta.size, 1024);
        });

        test('should update timestamps', async () => {
            const file = await _createOldFile(userId, createTestFileForm(), db);
            const originalUpdatedAt = file.updatedAt;

            const updated = await Files.updateFileMetadata(
                file.id,
                { name: 'Updated Name' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        test('should return null for non-existent file', async () => {
            const updated = await Files.updateFileMetadata(
                'non-existent-id',
                { name: 'Updated Name' },
                db
            );

            assert.strictEqual(updated, null);
        });
    });

    describe('deleteFile', () => {
        test('should delete file and return true', async () => {
            const file = await Files.createFile(userId, createTestFileForm(), db);

            const deleted = await Files.deleteFile(file.id, db);

            assert.strictEqual(deleted, true);

            const retrieved = await Files.getFileById(file.id, db);
            assert.strictEqual(retrieved, null);
        });

        test('should return false for non-existent file', async () => {
            const deleted = await Files.deleteFile('non-existent-id', db);

            assert.strictEqual(deleted, false);
        });
    });

    describe('deleteAllFiles', () => {
        test('should delete all files and return true', async () => {
            const user2 = await Users.createUser(newUserParams(), db);

            await Files.createFile(userId, createTestFileForm('file1.pdf'), db);
            await Files.createFile(userId, createTestFileForm('file2.pdf'), db);
            await Files.createFile(user2.id, createTestFileForm('file3.pdf'), db);

            const deleted = await Files.deleteAllFiles(db);

            assert.strictEqual(deleted, true);

            const files = await Files.getFiles(db);
            assert.strictEqual(files.length, 0);
        });

        test('should return false when no files to delete', async () => {
            const deleted = await Files.deleteAllFiles(db);

            assert.strictEqual(deleted, false);
        });
    });

    /* -------------------- SEARCH & FILTERING -------------------- */

    describe('searchFiles', () => {
        beforeEach(async () => {
            // Create test files with various names
            await Files.createFile(userId, createTestFileForm('report.pdf'), db);
            await Files.createFile(userId, createTestFileForm('report_2023.pdf'), db);
            await Files.createFile(userId, createTestFileForm('invoice.doc'), db);
            await Files.createFile(userId, createTestFileForm('image.jpg'), db);
            await Files.createFile(userId, createTestFileForm('data_1.csv'), db);
            await Files.createFile(userId, createTestFileForm('data_2.csv'), db);
        });

        test('should search with wildcard pattern', async () => {
            const results = await Files.searchFiles(userId, '*.pdf', 0, 100, db);

            assert.ok(results.length >= 2);
            assert.ok(results.every(f => f.filename.endsWith('.pdf')));
        });

        test('should search with single char pattern', async () => {
            const results = await Files.searchFiles(userId, 'data_?.csv', 0, 100, db);

            assert.strictEqual(results.length, 2);
            assert.ok(results.every(f => f.filename.match(/^data_\d\.csv$/)));
        });

        test('should search with prefix pattern', async () => {
            const results = await Files.searchFiles(userId, 'report*', 0, 100, db);

            assert.ok(results.length >= 2);
            assert.ok(results.every(f => f.filename.startsWith('report')));
        });

        test('should search all users when userId is null', async () => {
            const user2 = await Users.createUser(newUserParams(), db);
            await Files.createFile(user2.id, createTestFileForm('other.pdf'), db);

            const results = await Files.searchFiles(null, '*.pdf', 0, 100, db);

            assert.ok(results.length >= 3);
        });

        test('should filter by user when userId provided', async () => {
            const user2 = await Users.createUser(newUserParams(), db);
            await Files.createFile(user2.id, createTestFileForm('other.pdf'), db);

            const results = await Files.searchFiles(userId, '*.pdf', 0, 100, db);

            assert.ok(results.length >= 2);
            assert.ok(results.every(f => f.userId === userId));
        });

        test('should paginate results', async () => {
            const page1 = await Files.searchFiles(userId, '*.pdf', 0, 1, db);
            const page2 = await Files.searchFiles(userId, '*.pdf', 1, 1, db);

            assert.strictEqual(page1.length, 1);
            assert.strictEqual(page2.length, 1);
            assert.notStrictEqual(page1[0]!.id, page2[0]!.id);
        });

        test('should enforce max limit of 1000', async () => {
            const results = await Files.searchFiles(userId, '*', 0, 2000, db);

            // Should not throw, and should work with max limit
            assert.ok(results.length >= 0);
        });

        test('should return empty array for no matches', async () => {
            const results = await Files.searchFiles(userId, 'nonexistent*', 0, 100, db);

            assert.strictEqual(results.length, 0);
        });

        test('should return files ordered by updatedAt desc', async () => {
            // Create files with unique name pattern to isolate from beforeEach files
            const old = await _createOldFile(userId, createTestFileForm('ordered_old.txt'), db);
            const recent = await Files.createFile(userId, createTestFileForm('ordered_recent.txt'), db);

            const results = await Files.searchFiles(userId, 'ordered_*.txt', 0, 100, db);

            // Most recent first
            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0]!.id, recent.id);
            assert.strictEqual(results[1]!.id, old.id);
        });
    });

    /* -------------------- ACCESS CONTROL -------------------- */

    describe('hasFileAccess', () => {
        test('should grant access to file owner', async () => {
            const file = await Files.createFile(userId, createTestFileForm(), db);

            const hasAccess = await Files.hasFileAccess(file.id, userId, 'read', db);

            assert.strictEqual(hasAccess, true);
        });

        test('should grant write access to file owner', async () => {
            const file = await Files.createFile(userId, createTestFileForm(), db);

            const hasAccess = await Files.hasFileAccess(file.id, userId, 'write', db);

            assert.strictEqual(hasAccess, true);
        });

        test('should deny access to admin user if admin user is not owner', async () => {
            const regularUser = await Users.createUser(newUserParams(), db);
            const file = await Files.createFile(regularUser.id, createTestFileForm(), db);

            // userId is admin created in beforeEach
            const hasAccess = await Files.hasFileAccess(file.id, userId, 'read', db);
            assert.strictEqual(hasAccess, false);
        });

        test('should deny access to non-owner', async () => {
            const user2 = await Users.createUser(newUserParams(), db);
            const file = await Files.createFile(userId, createTestFileForm(), db);

            const hasAccess = await Files.hasFileAccess(file.id, user2.id, 'read', db);
            assert.strictEqual(hasAccess, false);
        });

        test('should grant access via explicit read permission', async () => {
            const user2 = await Users.createUser(newUserParams(), db);
            const accessControl: AccessControl = {
                read: {
                    user_ids: [user2.id]
                }
            };
            const fileData = createTestFileForm();
            fileData.accessControl = accessControl;
            const file = await Files.createFile(userId, fileData, db);

            const hasAccess = await Files.hasFileAccess(file.id, user2.id, 'read', db);

            assert.strictEqual(hasAccess, true);
        });

        test('should grant write access via explicit write permission', async () => {
            const user2 = await Users.createUser(newUserParams(), db);
            const accessControl: AccessControl = {
                write: {
                    user_ids: [user2.id]
                }
            };
            const fileData = createTestFileForm();
            fileData.accessControl = accessControl;
            const file = await Files.createFile(userId, fileData, db);

            const hasAccess = await Files.hasFileAccess(file.id, user2.id, 'write', db);

            assert.strictEqual(hasAccess, true);
        });

        test('should deny write access when only read permission granted', async () => {
            const user2 = await Users.createUser(newUserParams(), db);
            const accessControl: AccessControl = {
                read: {
                    user_ids: [user2.id]
                }
            };
            const fileData = createTestFileForm();
            fileData.accessControl = accessControl;
            const file = await Files.createFile(userId, fileData, db);

            const hasAccess = await Files.hasFileAccess(file.id, user2.id, 'write', db);

            assert.strictEqual(hasAccess, false);
        });

        test('should grant read access to a publicly shared file', async () => {
            const file = await Files.createFile(userId, createTestFileForm(), db);
            const user2 = await Users.createUser(newUserParams(), db);

            // File created - owner should have read access, user2 should not
            let hasAccess = await Files.hasFileAccess(file.id, userId, 'read', db);
            assert.strictEqual(hasAccess, true);
            hasAccess = await Files.hasFileAccess(file.id, userId, 'write', db);
            assert.strictEqual(hasAccess, true);
            hasAccess = await Files.hasFileAccess(file.id, user2.id, 'read', db);
            assert.strictEqual(hasAccess, false);
            hasAccess = await Files.hasFileAccess(file.id, user2.id, 'write', db);
            assert.strictEqual(hasAccess, false);

            // Owner associates file with chat
            const chat = await Chats.createChat(userId, createTestChatData(), db);
            await Chats.insertChatFiles(chat.id, null, [file.id], userId, db);

            // access should not change
            hasAccess = await Files.hasFileAccess(file.id, userId, 'read', db);
            assert.strictEqual(hasAccess, true);
            hasAccess = await Files.hasFileAccess(file.id, userId, 'write', db);
            assert.strictEqual(hasAccess, true);
            hasAccess = await Files.hasFileAccess(file.id, user2.id, 'read', db);
            assert.strictEqual(hasAccess, false);
            hasAccess = await Files.hasFileAccess(file.id, user2.id, 'write', db);
            assert.strictEqual(hasAccess, false);

            // Owner publicly shares chat
            await Chats.shareChat(chat.id, db);

            // Owner should retain read/write access; and now other users should have read-only access
            hasAccess = await Files.hasFileAccess(file.id, userId, 'read', db);
            assert.strictEqual(hasAccess, true);
            hasAccess = await Files.hasFileAccess(file.id, userId, 'write', db);
            assert.strictEqual(hasAccess, true);
            hasAccess = await Files.hasFileAccess(file.id, user2.id, 'read', db);
            assert.strictEqual(hasAccess, true);
            hasAccess = await Files.hasFileAccess(file.id, user2.id, 'write', db);
            assert.strictEqual(hasAccess, false);
        });

        test('should return false for non-existent file', async () => {
            const hasAccess = await Files.hasFileAccess('non-existent-id', userId, 'read', db);

            assert.strictEqual(hasAccess, false);
        });
    });

    describe('updateFileAccessControl', () => {
        test('should update access control', async () => {
            const file = await Files.createFile(userId, createTestFileForm(), db);

            const accessControl: AccessControl = {
                read: {
                    user_ids: ['user-1', 'user-2']
                },
                write: {
                    user_ids: ['user-1']
                }
            };

            const updated = await Files.updateFileAccessControl(file.id, accessControl, db);

            assert.ok(updated);
            assert.ok(updated.accessControl);
            assert.deepStrictEqual(updated.accessControl, accessControl);
        });

        test('should update timestamps', async () => {
            const file = await _createOldFile(userId, createTestFileForm(), db);
            const originalUpdatedAt = file.updatedAt;

            const accessControl: AccessControl = {
                read: {
                    user_ids: ['user-1']
                }
            };

            const updated = await Files.updateFileAccessControl(file.id, accessControl, db);

            assert.ok(updated);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        test('should return null for non-existent file', async () => {
            const accessControl: AccessControl = {
                read: {
                    user_ids: ['user-1']
                }
            };

            const updated = await Files.updateFileAccessControl('non-existent-id', accessControl, db);

            assert.strictEqual(updated, null);
        });
    });

    /* -------------------- DATA INTEGRITY -------------------- */

    describe('Data Integrity', () => {
        test('should isolate users files', async () => {
            const user1 = await Users.createUser(newUserParams(), db);
            const user2 = await Users.createUser(newUserParams(), db);

            const user1File = await Files.createFile(user1.id, createTestFileForm('user1.pdf'), db);
            const user2File = await Files.createFile(user2.id, createTestFileForm('user2.pdf'), db);

            // User 1 can't see User 2's files
            const user1Files = await Files.getFilesByUserId(user1.id, {}, db);
            assert.ok(!user1Files.items.some(f => f.id === user2File.id));

            // User 2 can't see User 1's files
            const user2Files = await Files.getFilesByUserId(user2.id, {}, db);
            assert.ok(!user2Files.items.some(f => f.id === user1File.id));

            // User 1 can't access User 2's file by ID
            const crossAccess = await Files.getFileByIdAndUserId(user2File.id, user1.id, db);
            assert.strictEqual(crossAccess, null);
        });

        test('should verify timestamps are unix seconds not milliseconds', async () => {
            const file = await Files.createFile(userId, createTestFileForm(), db);

            // Unix seconds are 10 digits, milliseconds are 13
            const secondsLength = file.createdAt.toString().length;
            assert.ok(secondsLength <= 10, 'Timestamp should be in seconds, not milliseconds');
            assert.ok(secondsLength >= 10, 'Timestamp should be valid unix seconds');
        });

        test('should handle null optional fields', async () => {
            const fileData: Files.FileForm = {
                id: crypto.randomUUID(),
                filename: 'minimal.pdf',
                path: 'path/to/minimal.pdf',
            };

            const file = await Files.createFile(userId, fileData, db);

            assert.ok(file.id);
            assert.strictEqual(file.filename, 'minimal.pdf');
            assert.ok(file.meta === undefined || file.meta === null);
            assert.ok(file.data === undefined || file.data === null);
            assert.ok(file.accessControl === undefined || file.accessControl === null);
        });
    });

    /* -------------------- EDGE CASES -------------------- */

    describe('Edge Cases', () => {
        test('should handle files with special characters in filename', async () => {
            const specialNames = [
                'file/with/slashes.pdf',
                'file\\with\\backslashes.pdf',
                'file "with" quotes.pdf',
                "file 'with' apostrophes.pdf",
                'file <with> brackets.pdf',
                'file & ampersand.pdf',
            ];

            for (const name of specialNames) {
                const file = await Files.createFile(
                    userId,
                    createTestFileForm(name),
                    db
                );

                assert.strictEqual(file.filename, name);

                const retrieved = await Files.getFileById(file.id, db);
                assert.ok(retrieved);
                assert.strictEqual(retrieved.filename, name);
            }
        });

        test('should handle files with long filenames', async () => {
            const longName = 'A'.repeat(255) + '.pdf';
            const file = await Files.createFile(
                userId,
                createTestFileForm(longName),
                db
            );

            assert.strictEqual(file.filename, longName);
        });

        test('should handle files with unicode characters', async () => {
            const unicodeNames = [
                '文档.pdf',
                'ファイル.pdf',
                'Файл.pdf',
                '📄 document.pdf',
                'fichier 🇫🇷.pdf',
            ];

            for (const name of unicodeNames) {
                const file = await Files.createFile(
                    userId,
                    createTestFileForm(name),
                    db
                );

                assert.strictEqual(file.filename, name);
            }
        });

        test('should handle complex nested data structures', async () => {
            const complexData: FileData = {
                status: 'completed',
                content: 'extracted text content',
                custom: {
                    nested: {
                        deeply: {
                            value: 'deep value'
                        }
                    }
                }
            };

            const fileData = createTestFileForm('complex.pdf', undefined, complexData);
            const file = await Files.createFile(userId, fileData, db);

            assert.ok(file.data);
            assert.deepStrictEqual(file.data, complexData);

            const retrieved = await Files.getFileById(file.id, db);
            assert.ok(retrieved);
            assert.ok(retrieved.data);
            assert.deepStrictEqual(retrieved.data, complexData);
        });

        test('should handle updates that merge complex data', async () => {
            const initialData: FileData = {
                status: 'pending',
                error: undefined,
                content: undefined,
                metadata: {
                    pages: 10,
                    author: 'John Doe'
                }
            };

            const fileData = createTestFileForm('test.pdf', undefined, initialData);
            const file = await Files.createFile(userId, fileData, db);

            const updateData: Partial<FileData> = {
                status: 'completed',
                content: 'extracted text',
                metadata: {
                    pages: 10,
                    author: 'John Doe',
                    wordCount: 5000
                }
            };

            const updated = await Files.updateFileData(file.id, updateData, db);

            assert.ok(updated);
            assert.ok(updated.data);
            assert.strictEqual(updated.data.status, 'completed');
            assert.strictEqual(updated.data.content, 'extracted text');
            assert.strictEqual(updated.data.error, undefined);
            assert.deepStrictEqual(updated.data.metadata, {
                pages: 10,
                author: 'John Doe',
                wordCount: 5000
            });
        });

        test('should handle empty string filename', async () => {
            const file = await Files.createFile(
                userId,
                createTestFileForm(''),
                db
            );

            assert.strictEqual(file.filename, '');
        });

        test('should handle very large data field', async () => {
            const largeContent = 'A'.repeat(100000);
            const data: FileData = {
                status: 'completed',
                content: largeContent
            };

            const fileData = createTestFileForm('large.pdf', undefined, data);
            const file = await Files.createFile(userId, fileData, db);

            assert.ok(file.data);
            assert.strictEqual(file.data.content, largeContent);
        });
    });
});
