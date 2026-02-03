import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { assertInMemoryDatabase, newUserParams, TEST_PASSWORD } from '../helpers.js';
import { db } from '../../src/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.js';
import * as Users from '../../src/db/operations/users.js';
import * as Auths from '../../src/db/operations/auths.js';
import * as Files from '../../src/db/operations/files.js';
import * as JWT from '../../src/routes/jwt.js';
import { type UserRole } from '../../src/routes/types.js';
import filesRouter from '../../src/routes/files.js';
import { StorageProvider } from '../../src/storage/provider.js';

/* -------------------- TEST SETUP -------------------- */

// Ensure tests use in-memory database
assertInMemoryDatabase();

// Apply migrations to the in-memory database
await migrate(db, { migrationsFolder: './drizzle' });

// Track files in uploads directory for cleanup
let filesBeforeTests: Set<string> = new Set();

// Helper function to clear database tables
async function clearDatabase() {
    await db.delete(schema.files);
    await db.delete(schema.auths);
    await db.delete(schema.users);
}

// Helper function to get list of files in uploads directory
async function getUploadedFiles(): Promise<Set<string>> {
    const uploadsDir = './data/uploads';
    try {
        const fs = await import('node:fs/promises');
        const files = await fs.readdir(uploadsDir);
        return new Set(files);
    } catch (error) {
        // Directory doesn't exist or can't be read
        return new Set();
    }
}

// Helper function to clean up new files from storage
async function cleanupFiles() {
    const filesAfterTests = await getUploadedFiles();

    // Find files that were created during tests
    const newFiles = [...filesAfterTests].filter(file => !filesBeforeTests.has(file));

    // Delete each new file
    for (const filename of newFiles) {
        try {
            const filePath = `./data/uploads/${filename}`;
            await StorageProvider.deleteFile(filePath);
        } catch (error) {
            // Ignore errors during cleanup
        }
    }
}

// Create Express app with files routes
const app: Express = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v1/files', filesRouter);

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Create a test user and return JWT token
 */
async function createUserWithToken(role: UserRole = 'user'): Promise<{ userId: string; token: string }> {
    const userParams = newUserParams(role);
    const user = await Users.createUser(userParams, db);
    await Auths.createAuth(userParams.id, userParams.username, TEST_PASSWORD, db);
    const token = JWT.createToken(userParams.id);

    assert.strictEqual(user.role, role);
    return { userId: userParams.id, token };
}

/**
 * Create a test file with mock storage
 */
async function createTestFile(userId: string, filename: string = 'test.txt', content: string = 'test content'): Promise<schema.File> {
    const fileId = crypto.randomUUID();
    const buffer = Buffer.from(content);

    // Mock storage upload
    const uploadPath = `uploads/${fileId}`;

    const file = await Files.createFile(userId, {
        id: fileId,
        filename: filename,
        path: uploadPath,
        hash: 'test hash',
        data: { status: 'completed', content: content },
        meta: {
            name: filename,
            content_type: 'text/plain',
            size: buffer.length,
        },
    }, db);

    return file;
}

/**
 * Create multiple test files
 */
async function createMultipleFiles(userId: string, count: number): Promise<schema.File[]> {
    const files: schema.File[] = [];
    for (let i = 0; i < count; i++) {
        const file = await createTestFile(userId, `file-${i + 1}.txt`, `content ${i + 1}`);
        files.push(file);
    }
    return files;
}

/* -------------------- TESTS -------------------- */

describe('File Routes', () => {
    before(async () => {
        // Capture initial state of uploads directory
        filesBeforeTests = await getUploadedFiles();
    });

    beforeEach(async () => {
        await clearDatabase();
    });

    after(async () => {
        await cleanupFiles();
    });

    describe('GET /api/v1/files/', () => {
        test('should list all files for regular user', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleFiles(userId, 3);

            const response = await request(app)
                .get('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(Array.isArray(response.body));
            assert.strictEqual(response.body.length, 3);

            const file = response.body[0];
            assert.ok(file.id);
            assert.ok(file.user_id);
            assert.ok(file.filename);
            assert.ok(file.hash);
            assert.ok(file.data);
            assert.ok(file.meta);
            assert.ok(typeof file.created_at === 'number');
            assert.ok(typeof file.updated_at === 'number');

            // Should not include path and access_control
            assert.strictEqual(file.path, undefined);
            assert.strictEqual(file.access_control, undefined);
        });

        test('should exclude content when content=false', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestFile(userId, 'test.txt', 'some content');

            const response = await request(app)
                .get('/api/v1/files/')
                .query({ content: false })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body[0].data, null);
        });

        test('should include content by default', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestFile(userId, 'test.txt', 'some content');

            const response = await request(app)
                .get('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(response.body[0].data);
            assert.strictEqual(response.body[0].data.content, 'some content');
        });

        test('should only return user own files for regular user', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');

            await createTestFile(user1Id, 'user1-file.txt');
            await createTestFile(user2Id, 'user2-file.txt');

            const response = await request(app)
                .get('/api/v1/files/')
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            assert.strictEqual(response.body.length, 1);
            assert.strictEqual(response.body[0].filename, 'user1-file.txt');
        });

        test('should return all files for admin user', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');
            const { token: adminToken } = await createUserWithToken('admin');

            await createTestFile(user1Id, 'user1-file.txt');
            await createTestFile(user2Id, 'user2-file.txt');

            const response = await request(app)
                .get('/api/v1/files/')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);

            assert.strictEqual(response.body.length, 2);
        });

        test('should return empty array when user has no files', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .get('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.deepStrictEqual(response.body, []);
        });

        test('should fail without authentication token', async () => {
            await request(app)
                .get('/api/v1/files/')
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            await request(app)
                .get('/api/v1/files/')
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });

        test('should validate query parameters', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .get('/api/v1/files/')
                .query({ content: 'not_a_boolean' })
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });
    });

    describe('GET /api/v1/files/search', () => {
        test('should search files by filename pattern', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestFile(userId, 'test-1.txt');
            await createTestFile(userId, 'test-2.txt');
            await createTestFile(userId, 'other.pdf');

            const response = await request(app)
                .get('/api/v1/files/search')
                .query({ filename: 'test-*.txt' })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 2);
            response.body.forEach((file: any) => {
                assert.ok(file.filename.startsWith('test-'));
                assert.ok(file.filename.endsWith('.txt'));
            });
        });

        test('should support wildcard * pattern', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestFile(userId, 'document.pdf');
            await createTestFile(userId, 'image.png');
            await createTestFile(userId, 'data.csv');

            const response = await request(app)
                .get('/api/v1/files/search')
                .query({ filename: '*.*' })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 3);
        });

        test('should support ? single character pattern', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestFile(userId, 'test1.txt');
            await createTestFile(userId, 'test2.txt');
            await createTestFile(userId, 'test10.txt');

            const response = await request(app)
                .get('/api/v1/files/search')
                .query({ filename: 'test?.txt' })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 2);
        });

        test('should exclude content when content=false', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestFile(userId, 'test.txt', 'content here');

            const response = await request(app)
                .get('/api/v1/files/search')
                .query({ filename: '*.txt', content: false })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body[0].data, null);
        });

        test('should support skip and limit parameters', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleFiles(userId, 5);

            const response = await request(app)
                .get('/api/v1/files/search')
                .query({ filename: '*', skip: 2, limit: 2 })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 2);
        });

        test('should only search user own files for regular user', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');

            await createTestFile(user1Id, 'shared-name.txt');
            await createTestFile(user2Id, 'shared-name.txt');

            const response = await request(app)
                .get('/api/v1/files/search')
                .query({ filename: 'shared-name.txt' })
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            assert.strictEqual(response.body.length, 1);
            assert.strictEqual(response.body[0].user_id, user1Id);
        });

        test('should search all files for admin user', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');
            const { token: adminToken } = await createUserWithToken('admin');

            await createTestFile(user1Id, 'shared-name.txt');
            await createTestFile(user2Id, 'shared-name.txt');

            const response = await request(app)
                .get('/api/v1/files/search')
                .query({ filename: 'shared-name.txt' })
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);

            assert.strictEqual(response.body.length, 2);
        });

        test('should return 404 when no files match pattern', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestFile(userId, 'test.txt');

            const response = await request(app)
                .get('/api/v1/files/search')
                .query({ filename: 'nonexistent.pdf' })
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            await request(app)
                .get('/api/v1/files/search')
                .query({ filename: '*.txt' })
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            await request(app)
                .get('/api/v1/files/search')
                .query({ filename: '*.txt' })
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });

        test('should validate query parameters', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .get('/api/v1/files/search')
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });
    });

    describe('POST /api/v1/files/', () => {
        test('should upload file successfully', async () => {
            const { userId, token } = await createUserWithToken('user');
            const fileContent = Buffer.from('test file content');

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', fileContent, 'test.txt')
                .expect(200);

            assert.ok(response.body.id);
            assert.strictEqual(response.body.user_id, userId);
            assert.strictEqual(response.body.filename, 'test.txt');
            assert.ok(response.body.hash);
            assert.ok(response.body.meta);
            assert.strictEqual(response.body.meta.name, 'test.txt');
            assert.strictEqual(response.body.meta.size, fileContent.length);
        });

        test('should upload file with metadata', async () => {
            const { token } = await createUserWithToken('user');
            const fileContent = Buffer.from('test content');
            const metadata = { description: 'Test file', custom: 'value' };

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .field('metadata', JSON.stringify(metadata))
                .attach('file', fileContent, 'test.txt')
                .expect(200);

            assert.ok(response.body.meta.data);
            assert.strictEqual(response.body.meta.data.description, 'Test file');
            assert.strictEqual(response.body.meta.data.custom, 'value');
        });

        test('should accept various file types', async () => {
            const { token } = await createUserWithToken('user');
            const fileTypes = [
                { ext: '.pdf', mime: 'application/pdf' },
                { ext: '.jpg', mime: 'image/jpeg' },
                { ext: '.png', mime: 'image/png' },
                { ext: '.doc', mime: 'application/msword' },
                { ext: '.mp3', mime: 'audio/mpeg' },
            ];

            for (const { ext, mime } of fileTypes) {
                const response = await request(app)
                    .post('/api/v1/files/')
                    .set('Authorization', `Bearer ${token}`)
                    .attach('file', Buffer.from('test'), `test${ext}`)
                    .expect(200);

                assert.ok(response.body.id);
                assert.ok(response.body.filename.endsWith(ext));
            }
        });

        test('should set default processing status', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from('test'), 'test.txt')
                .expect(200);

            assert.strictEqual(response.body.data.status, 'pending');
        });

        test('should fail without file', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.strictEqual(response.body.detail, 'File required');
        });

        test('should fail with disallowed file type', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from('test'), 'malware.exe')
                .expect(400);

            assert.strictEqual(response.body.detail, 'File type not allowed');
        });

        test('should fail without authentication token', async () => {
            await request(app)
                .post('/api/v1/files/')
                .attach('file', Buffer.from('test'), 'test.txt')
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            await request(app)
                .post('/api/v1/files/')
                .set('Authorization', 'Bearer invalid_token')
                .attach('file', Buffer.from('test'), 'test.txt')
                .expect(401);
        });

        test('should validate query parameters', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/')
                .query({ process: 'invalid_boolean' })
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from('test'), 'test.txt')
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });
    });

    describe('DELETE /api/v1/files/all', () => {
        test('should delete all files with admin token', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');
            const { token: adminToken } = await createUserWithToken('admin');

            await createTestFile(user1Id, 'file1.txt');
            await createTestFile(user2Id, 'file2.txt');

            const response = await request(app)
                .delete('/api/v1/files/all')
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);

            assert.strictEqual(response.body.message, 'All files deleted successfully');

            // Verify all files deleted
            const allFiles = await Files.getFiles(db);
            assert.strictEqual(allFiles.length, 0);
        });

        test('should fail with 403 when non-admin user tries to delete all', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .delete('/api/v1/files/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(403);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            await request(app)
                .delete('/api/v1/files/all')
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            await request(app)
                .delete('/api/v1/files/all')
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('GET /api/v1/files/:file_id', () => {
        test('should return file metadata when user owns file', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.id, file.id);
            assert.strictEqual(response.body.user_id, userId);
            assert.strictEqual(response.body.filename, 'test.txt');
            assert.ok(response.body.path);
            assert.ok(response.body.hash);
            assert.ok(response.body.data);
            assert.ok(response.body.meta);
            assert.ok(typeof response.body.created_at === 'number');
            assert.ok(typeof response.body.updated_at === 'number');
        });

        test('should return file metadata when user is admin', async () => {
            const { userId } = await createUserWithToken('user');
            const { token: adminToken } = await createUserWithToken('admin');
            const file = await createTestFile(userId, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);

            assert.strictEqual(response.body.id, file.id);
        });

        test('should return 404 when file not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .get(`/api/v1/files/${nonExistentId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 401 when user does not have access to file', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const file = await createTestFile(user1Id, 'user1-file.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(401);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .get(`/api/v1/files/${file.id}`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .get(`/api/v1/files/${file.id}`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('DELETE /api/v1/files/:file_id', () => {
        test('should delete file when user owns it', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            const response = await request(app)
                .delete(`/api/v1/files/${file.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(response.body.message);

            // Verify file deleted
            const deletedFile = await Files.getFileById(file.id, db);
            assert.strictEqual(deletedFile, null);
        });

        test('should delete file when user is admin', async () => {
            const { userId } = await createUserWithToken('user');
            const { token: adminToken } = await createUserWithToken('admin');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .delete(`/api/v1/files/${file.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(200);

            const deletedFile = await Files.getFileById(file.id, db);
            assert.strictEqual(deletedFile, null);
        });

        test('should return 404 when file not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .delete(`/api/v1/files/${nonExistentId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 401 when user does not have access to file', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const file = await createTestFile(user1Id, 'user1-file.txt');

            const response = await request(app)
                .delete(`/api/v1/files/${file.id}`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(401);

            assert.ok(response.body.detail);

            // Verify file not deleted
            const existingFile = await Files.getFileById(file.id, db);
            assert.ok(existingFile);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .delete(`/api/v1/files/${file.id}`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .delete(`/api/v1/files/${file.id}`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('GET /api/v1/files/:file_id/content', () => {
        test('should download file content with correct headers', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt', 'file content here');

            // Mock storage download
            const mockBuffer = Buffer.from('file content here');
            StorageProvider.downloadFile = async () => mockBuffer;

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.headers['content-type'], 'text/plain');
            assert.ok(response.headers['content-disposition']);
            assert.ok(response.headers['content-disposition'].includes('test.txt'));
            assert.strictEqual(response.text, 'file content here');
        });

        test('should set inline disposition for PDFs without attachment flag', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await Files.createFile(userId, {
                id: crypto.randomUUID(),
                filename: 'document.pdf',
                path: 'uploads/test.pdf',
                hash: 'hash123',
                data: { status: 'completed' },
                meta: {
                    name: 'document.pdf',
                    content_type: 'application/pdf',
                    size: 1024,
                },
            }, db);

            StorageProvider.downloadFile = async () => Buffer.from('pdf content');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(response.headers['content-disposition']?.startsWith('inline'));
        });

        test('should set attachment disposition when attachment=true', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await Files.createFile(userId, {
                id: crypto.randomUUID(),
                filename: 'document.pdf',
                path: 'uploads/test.pdf',
                hash: 'hash123',
                data: { status: 'completed' },
                meta: {
                    name: 'document.pdf',
                    content_type: 'application/pdf',
                    size: 1024,
                },
            }, db);

            StorageProvider.downloadFile = async () => Buffer.from('pdf content');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content`)
                .query({ attachment: true })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(response.headers['content-disposition']?.startsWith('attachment'));
        });

        test('should return 404 when file not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .get(`/api/v1/files/${nonExistentId}/content`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 401 when user does not have access', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const file = await createTestFile(user1Id, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(401);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .get(`/api/v1/files/${file.id}/content`)
                .expect(401);
        });

        test('should validate query parameters', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content`)
                .query({ attachment: 'invalid_boolean' })
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });
    });

    describe('GET /api/v1/files/:file_id/content/:file_name', () => {
        test('should download file with custom filename', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'original.txt', 'content');

            StorageProvider.downloadFile = async () => Buffer.from('content');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content/custom-name.txt`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(response.headers['content-disposition']?.includes('custom-name.txt'));
            assert.strictEqual(response.text, 'content');
        });

        test('should fallback to extracted content if physical file missing', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt', 'extracted content');

            // Mock storage to throw error (file not found)
            StorageProvider.downloadFile = async () => {
                throw new Error('File not found');
            };

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content/download.txt`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.headers['content-type'], 'text/plain; charset=utf-8');
            assert.strictEqual(response.text, 'extracted content');
        });

        test('should return 404 when file has no physical file or extracted content', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await Files.createFile(userId, {
                id: crypto.randomUUID(),
                filename: 'test.txt',
                path: null,
                hash: 'hash123',
                data: { status: 'pending' },
                meta: { name: 'test.txt', content_type: 'text/plain', size: 0 },
            }, db);

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content/download.txt`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 401 when user does not have access', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const file = await createTestFile(user1Id, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/content/download.txt`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(401);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .get(`/api/v1/files/${file.id}/content/download.txt`)
                .expect(401);
        });
    });

    // describe('GET /api/v1/files/:file_id/content/html', () => {
    //     test('should return raw file content for admin-owned files', async () => {
    //         const { userId: adminId, token: adminToken } = await createUserWithToken('admin');
    //         const file = await createTestFile(adminId, 'test.html', '<html><body>content</body></html>');

    //         StorageProvider.downloadFile = async () => Buffer.from('<html><body>content</body></html>');

    //         const response = await request(app)
    //             .get(`/api/v1/files/${file.id}/content/html`)
    //             .set('Authorization', `Bearer ${adminToken}`)
    //             .expect(200);

    //         assert.strictEqual(response.text, '<html><body>content</body></html>');
    //     });

    //     test('should fail when file is not owned by admin', async () => {
    //         const { userId } = await createUserWithToken('user');
    //         const { token: adminToken } = await createUserWithToken('admin');
    //         const file = await createTestFile(userId, 'test.html');

    //         const response = await request(app)
    //             .get(`/api/v1/files/${file.id}/content/html`)
    //             .set('Authorization', `Bearer ${adminToken}`)
    //             .expect(401);

    //         assert.ok(response.body.detail);
    //     });

    //     test('should fail when user is not admin', async () => {
    //         const { userId: adminId } = await createUserWithToken('admin');
    //         const { token: userToken } = await createUserWithToken('user');
    //         const file = await createTestFile(adminId, 'test.html');

    //         const response = await request(app)
    //             .get(`/api/v1/files/${file.id}/content/html`)
    //             .set('Authorization', `Bearer ${userToken}`)
    //             .expect(401);

    //         assert.ok(response.body.detail);
    //     });

    //     test('should return 404 when file not found', async () => {
    //         const { token } = await createUserWithToken('admin');
    //         const nonExistentId = crypto.randomUUID();

    //         const response = await request(app)
    //             .get(`/api/v1/files/${nonExistentId}/content/html`)
    //             .set('Authorization', `Bearer ${token}`)
    //             .expect(404);

    //         assert.ok(response.body.detail);
    //     });

    //     test('should fail without authentication token', async () => {
    //         const { userId } = await createUserWithToken('admin');
    //         const file = await createTestFile(userId, 'test.html');

    //         await request(app)
    //             .get(`/api/v1/files/${file.id}/content/html`)
    //             .expect(401);
    //     });
    // });

    describe('GET /api/v1/files/:file_id/data/content', () => {
        test('should return extracted content', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt', 'extracted text content');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/data/content`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.content, 'extracted text content');
        });

        test('should return empty string when no content extracted', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await Files.createFile(userId, {
                id: crypto.randomUUID(),
                filename: 'test.txt',
                path: 'uploads/test.txt',
                hash: 'hash123',
                data: { status: 'pending' },
                meta: { name: 'test.txt', content_type: 'text/plain', size: 0 },
            }, db);

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/data/content`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.content, '');
        });

        test('should return 404 when file not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .get(`/api/v1/files/${nonExistentId}/data/content`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 401 when user does not have access', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const file = await createTestFile(user1Id, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/data/content`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(401);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .get(`/api/v1/files/${file.id}/data/content`)
                .expect(401);
        });
    });

    describe('POST /api/v1/files/:file_id/data/content/update', () => {
        test('should update file content when user owns file', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt', 'old content');

            const response = await request(app)
                .post(`/api/v1/files/${file.id}/data/content/update`)
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'new content' })
                .expect(200);

            assert.strictEqual(response.body.data.content, 'new content');
            assert.strictEqual(response.body.data.status, 'pending');

            // Verify in database
            const updatedFile = await Files.getFileById(file.id, db);
            assert.strictEqual(updatedFile?.data?.content, 'new content');
        });

        test('should update content when user is admin', async () => {
            const { userId } = await createUserWithToken('user');
            const { token: adminToken } = await createUserWithToken('admin');
            const file = await createTestFile(userId, 'test.txt', 'old content');

            const response = await request(app)
                .post(`/api/v1/files/${file.id}/data/content/update`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ content: 'new content' })
                .expect(200);

            assert.strictEqual(response.body.data.content, 'new content');
        });

        test('should set status to pending after update', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await Files.createFile(userId, {
                id: crypto.randomUUID(),
                filename: 'test.txt',
                path: 'uploads/test.txt',
                hash: 'hash123',
                data: { status: 'completed', content: 'old content' },
                meta: { name: 'test.txt', content_type: 'text/plain', size: 11 },
            }, db);

            const response = await request(app)
                .post(`/api/v1/files/${file.id}/data/content/update`)
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'updated content' })
                .expect(200);

            assert.strictEqual(response.body.data.status, 'pending');
        });

        test('should return 404 when file not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .post(`/api/v1/files/${nonExistentId}/data/content/update`)
                .set('Authorization', `Bearer ${token}`)
                .send({ content: 'new content' })
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 401 when user does not have write access', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const file = await createTestFile(user1Id, 'test.txt');

            const response = await request(app)
                .post(`/api/v1/files/${file.id}/data/content/update`)
                .set('Authorization', `Bearer ${token2}`)
                .send({ content: 'new content' })
                .expect(401);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .post(`/api/v1/files/${file.id}/data/content/update`)
                .send({ content: 'new content' })
                .expect(401);
        });

        test('should validate request body', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            const response = await request(app)
                .post(`/api/v1/files/${file.id}/data/content/update`)
                .set('Authorization', `Bearer ${token}`)
                .send({ invalid: 'field' })
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });
    });

    describe('GET /api/v1/files/:file_id/process/status', () => {
        test('should return processing status in non-streaming mode', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await Files.createFile(userId, {
                id: crypto.randomUUID(),
                filename: 'test.txt',
                path: 'uploads/test.txt',
                hash: 'hash123',
                data: { status: 'completed' },
                meta: { name: 'test.txt', content_type: 'text/plain', size: 0 },
            }, db);

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/process/status`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.status, 'completed');
        });

        test('should return pending status for newly uploaded files', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await Files.createFile(userId, {
                id: crypto.randomUUID(),
                filename: 'test.txt',
                path: 'uploads/test.txt',
                hash: 'hash123',
                data: { status: 'pending' },
                meta: { name: 'test.txt', content_type: 'text/plain', size: 0 },
            }, db);

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/process/status`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.status, 'pending');
        });

        test('should return failed status with error info', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await Files.createFile(userId, {
                id: crypto.randomUUID(),
                filename: 'test.txt',
                path: 'uploads/test.txt',
                hash: 'hash123',
                data: { status: 'failed', error: 'Processing error' },
                meta: { name: 'test.txt', content_type: 'text/plain', size: 0 },
            }, db);

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/process/status`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.status, 'failed');
        });

        test('should return 404 when file not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .get(`/api/v1/files/${nonExistentId}/process/status`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 401 when user does not have access', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const file = await createTestFile(user1Id, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/process/status`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(401);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            await request(app)
                .get(`/api/v1/files/${file.id}/process/status`)
                .expect(401);
        });

        test('should validate query parameters', async () => {
            const { userId, token } = await createUserWithToken('user');
            const file = await createTestFile(userId, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}/process/status`)
                .query({ stream: 'invalid_boolean' })
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });
    });
});
