import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestDatabase, newUserParams, createTestFileForm, type TestDatabase, createTestChatData } from '../../helpers.js';
import { Files, Users, Chats, schema, currentUnixTimestamp, type File } from '../../../src/db/index.js';
import type { FileMeta, FileData } from '../../../src/routes/types/index.js';

/* -------------------- TEST HELPERS -------------------- */

/**
 * Create a file with 'createdAt' and 'updatedAt' set to specific values.
 */
async function _createOldFile(
    fileData: Files.NewFile,
    txOrDb: TestDatabase,
    createdAt?: number,
    updatedAt?: number,
): Promise<File> {
    const now = currentUnixTimestamp();

    const [file] = await txOrDb
        .insert(schema.files)
        .values({
            id: crypto.randomUUID(),
            userId: fileData.userId,
            filename: fileData.filename,
            path: fileData.path,
            data: fileData.data,
            meta: fileData.meta,
            accessControl: {},
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
            const fileData = createTestFileForm(userId, 'document.pdf');
            const file = await Files.createFile(fileData, db);

            assert.ok(file.id);
            assert.strictEqual(file.userId, userId);
            assert.strictEqual(file.filename, 'document.pdf');
            assert.ok(file.path);
            assert.ok(file.createdAt);
            assert.ok(file.updatedAt);
            assert.strictEqual(file.createdAt, file.updatedAt);
        });

        test('should create file with meta', async () => {
            const meta: FileMeta = {
                name: 'My Document',
                contentType: 'application/pdf',
                size: 1024000,
            };
            const fileData = createTestFileForm(userId, 'document.pdf', meta);
            const file = await Files.createFile(fileData, db);

            assert.ok(file.meta);
            assert.strictEqual(file.meta.name, 'My Document');
            assert.strictEqual(file.meta.contentType, 'application/pdf');
            assert.strictEqual(file.meta.size, 1024000);
        });

        test('should create file with data', async () => {
            const data: FileData = {
                content: 'test content'
            };
            const fileData = createTestFileForm(userId, 'document.pdf', undefined, data);
            const file = await Files.createFile(fileData, db);

            assert.ok(file.data);
            assert.strictEqual(file.data.content, 'test content');
        });

        test('should verify timestamps are set correctly', async () => {
            const now = currentUnixTimestamp();
            const file = await Files.createFile(
                createTestFileForm(userId),
                db
            );

            assert.ok(file.createdAt >= now);
            assert.ok(file.updatedAt >= now);
            assert.strictEqual(file.createdAt, file.updatedAt);
        });

        test('should allow multiple files with same filename for different users', async () => {
            const user2 = await Users.createUser(newUserParams(), db);

            const file1 = await Files.createFile(createTestFileForm(userId, 'same.pdf'), db);
            const file2 = await Files.createFile(createTestFileForm(user2.id, 'same.pdf'), db);

            assert.ok(file1.id);
            assert.ok(file2.id);
            assert.notStrictEqual(file1.id, file2.id);
            assert.strictEqual(file1.filename, file2.filename);
        });

        test('should allow multiple files with same filename for same user', async () => {
            const file1 = await Files.createFile(createTestFileForm(userId, 'duplicate.pdf'), db);
            const file2 = await Files.createFile(createTestFileForm(userId, 'duplicate.pdf'), db);

            assert.ok(file1.id);
            assert.ok(file2.id);
            assert.notStrictEqual(file1.id, file2.id);
            assert.strictEqual(file1.filename, file2.filename);
        });
    });

    describe('getFileById', () => {
        test('should retrieve existing file', async () => {
            const created = await Files.createFile(
                createTestFileForm(userId, 'test.pdf'),
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
                contentType: 'application/pdf',
                size: 1024,
            };
            const data: FileData = {
                content: 'extracted text'
            };
            const fileData = createTestFileForm(userId, 'test.pdf', meta, data);
            const created = await Files.createFile(fileData, db);

            const retrieved = await Files.getFileById(created.id, db);

            assert.ok(retrieved);
            assert.ok(retrieved.meta);
            assert.ok(retrieved.data);
            assert.strictEqual(retrieved.meta.name, 'Test File');
            assert.strictEqual(retrieved.data.content, 'extracted text');
        });
    });

    describe('getFilesByIds', () => {
        test('should retrieve multiple files by IDs', async () => {
            const file1 = await Files.createFile(createTestFileForm(userId, 'file1.pdf'), db);
            const file2 = await Files.createFile(createTestFileForm(userId, 'file2.pdf'), db);
            const file3 = await Files.createFile(createTestFileForm(userId, 'file3.pdf'), db);

            const files = await Files.getFilesByIds([file1.id, file2.id, file3.id], db);

            assert.strictEqual(files.length, 3);
            assert.ok(files.some(f => f.id === file1.id));
            assert.ok(files.some(f => f.id === file2.id));
            assert.ok(files.some(f => f.id === file3.id));
        });

        test('should return files ordered by updatedAt desc', async () => {
            const file1 = await _createOldFile(createTestFileForm(userId, 'old.pdf'), db);
            const file2 = await Files.createFile(createTestFileForm(userId, 'new.pdf'), db);

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
            const file1 = await Files.createFile(createTestFileForm(userId, 'file1.pdf'), db);

            const files = await Files.getFilesByIds([file1.id, 'non-existent'], db);

            assert.strictEqual(files.length, 1);
            assert.strictEqual(files[0]!.id, file1.id);
        });
    });
    describe('updateFileData', () => {
        test('should update data field only', async () => {
            const initialData: FileData = {
                content: undefined
            };
            const fileData = createTestFileForm(userId, 'test.pdf', undefined, initialData);
            const file = await Files.createFile(fileData, db);

            const updated = await Files.updateFileData(
                file.id,
                { content: 'extracted text' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.data);
            assert.strictEqual(updated.data.content, 'extracted text');
        });

        test('should update timestamps', async () => {
            const file = await _createOldFile(createTestFileForm(userId), db);
            const originalUpdatedAt = file.updatedAt;

            const updated = await Files.updateFileData(
                file.id,
                { content: 'updated content' },
                db
            );

            assert.ok(updated);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        test('should throw for non-existent file', async () => {
            await assert.rejects(
                async () => await Files.updateFileData('non-existent-id', { content: 'updated content' }, db),
                { message: `file record with id 'non-existent-id' not found` }
            );
        });
    });

    describe('deleteFile', () => {
        test('should delete file', async () => {
            const file = await Files.createFile(createTestFileForm(userId), db);

            await Files.deleteFile(file.id, db);

            const retrieved = await Files.getFileById(file.id, db);
            assert.strictEqual(retrieved, null);
        });

        test('should throw for non-existent file', async () => {
            await assert.rejects(
                async () => await Files.deleteFile('non-existent-id', db),
                { message: `file record with id 'non-existent-id' not found` }
            );
        });
    });
    describe('hasFileAccess', () => {
        test('should grant access to file owner', async () => {
            const file = await Files.createFile(createTestFileForm(userId), db);

            const hasAccess = await Files.hasFileAccess(file.id, userId, 'read', db);

            assert.strictEqual(hasAccess, true);
        });

        test('should grant write access to file owner', async () => {
            const file = await Files.createFile(createTestFileForm(userId), db);

            const hasAccess = await Files.hasFileAccess(file.id, userId, 'write', db);

            assert.strictEqual(hasAccess, true);
        });

        test('should deny access to admin user if admin user is not owner', async () => {
            const regularUser = await Users.createUser(newUserParams(), db);
            const file = await Files.createFile(createTestFileForm(regularUser.id), db);

            // userId is admin created in beforeEach
            const hasAccess = await Files.hasFileAccess(file.id, userId, 'read', db);
            assert.strictEqual(hasAccess, false);
        });

        test('should deny access to non-owner', async () => {
            const user2 = await Users.createUser(newUserParams(), db);
            const file = await Files.createFile(createTestFileForm(userId), db);

            const hasAccess = await Files.hasFileAccess(file.id, user2.id, 'read', db);
            assert.strictEqual(hasAccess, false);
        });
        test('should grant read access to a publicly shared file', async () => {
            const file = await Files.createFile(createTestFileForm(userId), db);
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
                    createTestFileForm(userId, name),
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
                createTestFileForm(userId, longName),
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
                    createTestFileForm(userId, name),
                    db
                );

                assert.strictEqual(file.filename, name);
            }
        });

        test('should handle empty string filename', async () => {
            const file = await Files.createFile(
                createTestFileForm(userId, ''),
                db
            );

            assert.strictEqual(file.filename, '');
        });

        test('should handle very large data field', async () => {
            const largeContent = 'A'.repeat(100000);
            const data: FileData = {
                content: largeContent
            };

            const fileData = createTestFileForm(userId, 'large.pdf', undefined, data);
            const file = await Files.createFile(fileData, db);

            assert.ok(file.data);
            assert.strictEqual(file.data.content, largeContent);
        });
    });
});
