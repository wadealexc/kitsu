import { describe, test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { assertInMemoryDatabase, createUserWithToken } from '../helpers.js';
import { db } from '../../src/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.js';
import * as Files from '../../src/db/operations/files.js';
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
 * Create a test file with mock storage
 */
async function createTestFile(userId: string, filename: string = 'test.txt', content: string = 'test content'): Promise<Files.File> {
    const fileId = crypto.randomUUID();
    const buffer = Buffer.from(content);

    // Mock storage upload
    const uploadPath = `uploads/${fileId}`;

    const file = await Files.createFile({
        userId: userId,
        filename: filename,
        path: uploadPath,
        data: { content: content },
        meta: {
            name: filename,
            contentType: 'text/plain',
            size: buffer.length,
        },
    }, db);

    return file;
}

/**
 * Create multiple test files
 */
async function createMultipleFiles(userId: string, count: number): Promise<Files.File[]> {
    const files: Files.File[] = [];
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
            assert.ok(response.body.meta);
            assert.strictEqual(response.body.meta.name, 'test.txt');
            assert.strictEqual(response.body.meta.size, fileContent.length);
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

        test('should extract and return content for text files', async () => {
            const { token } = await createUserWithToken('user');
            const textContent = 'Hello, this is the file content!';

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from(textContent), { filename: 'notes.txt', contentType: 'text/plain' })
                .expect(200);

            assert.strictEqual(response.body.data.content, textContent);
        });

        test('should not extract content for binary files', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from('%PDF-1.4 binary'), { filename: 'doc.pdf', contentType: 'application/pdf' })
                .expect(200);

            assert.strictEqual(response.body.data.content, undefined);
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
            assert.ok(response.body.data);
            assert.ok(response.body.meta);
            assert.ok(typeof response.body.created_at === 'number');
            assert.ok(typeof response.body.updated_at === 'number');
        });

        test('should return 401 when user is admin but not authorized', async () => {
            const { userId } = await createUserWithToken('user');
            const { token: adminToken } = await createUserWithToken('admin');
            const file = await createTestFile(userId, 'test.txt');

            const response = await request(app)
                .get(`/api/v1/files/${file.id}`)
                .set('Authorization', `Bearer ${adminToken}`)
                .expect(401);

            assert.ok(response.body.detail);
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
            const file = await Files.createFile({
                userId: userId,
                filename: 'document.pdf',
                path: 'uploads/test.pdf',
                data: { },
                meta: {
                    name: 'document.pdf',
                    contentType: 'application/pdf',
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
            const file = await Files.createFile({
                userId: userId,
                filename: 'document.pdf',
                path: 'uploads/test.pdf',
                data: { },
                meta: {
                    name: 'document.pdf',
                    contentType: 'application/pdf',
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

});
