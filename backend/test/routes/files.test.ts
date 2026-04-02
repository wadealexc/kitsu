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

/* -------------------- TEST FIXTURES -------------------- */

/**
 * Build a minimal valid PDF buffer containing the given text.
 * Computes exact xref byte offsets so the PDF is structurally valid.
 */
function buildMinimalPdf(text: string = 'Test content'): Buffer {
    const streamContent = `BT /F1 12 Tf 100 700 Td (${text}) Tj ET`;
    const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
    const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
    const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
    const obj4 = `4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj\n`;
    const obj5 = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
    const header = '%PDF-1.4\n';

    const offset1 = header.length;
    const offset2 = offset1 + obj1.length;
    const offset3 = offset2 + obj2.length;
    const offset4 = offset3 + obj3.length;
    const offset5 = offset4 + obj4.length;
    const xrefOffset = offset5 + obj5.length;

    const fmt = (n: number) => String(n).padStart(10, '0');
    const xref =
        'xref\n' +
        '0 6\n' +
        `0000000000 65535 f \n` +
        `${fmt(offset1)} 00000 n \n` +
        `${fmt(offset2)} 00000 n \n` +
        `${fmt(offset3)} 00000 n \n` +
        `${fmt(offset4)} 00000 n \n` +
        `${fmt(offset5)} 00000 n \n`;
    const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + obj5 + xref + trailer);
}

/**
 * Build a minimal valid DOCX buffer containing the given text.
 * A DOCX is a ZIP archive; this constructs one using stored (uncompressed) entries.
 */
function buildMinimalDocx(text: string = 'Test content'): Buffer {
    const contentTypesXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>';

    const relsXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>';

    const docXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:body>' +
        `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` +
        '</w:body>' +
        '</w:document>';

    const docRelsXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

    return buildZip([
        { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml) },
        { name: '_rels/.rels', data: Buffer.from(relsXml) },
        { name: 'word/document.xml', data: Buffer.from(docXml) },
        { name: 'word/_rels/document.xml.rels', data: Buffer.from(docRelsXml) },
    ]);
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
    const parts: Buffer[] = [];
    const centralDir: Buffer[] = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBytes = Buffer.from(entry.name, 'utf8');
        const localHeader = Buffer.alloc(30 + nameBytes.length);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(0, 8);   // stored (no compression)
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        const crc = crc32(entry.data);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(entry.data.length, 18);
        localHeader.writeUInt32LE(entry.data.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28);
        nameBytes.copy(localHeader, 30);

        const centralEntry = Buffer.alloc(46 + nameBytes.length);
        centralEntry.writeUInt32LE(0x02014b50, 0);
        centralEntry.writeUInt16LE(20, 4);
        centralEntry.writeUInt16LE(20, 6);
        centralEntry.writeUInt16LE(0, 8);
        centralEntry.writeUInt16LE(0, 10);
        centralEntry.writeUInt16LE(0, 12);
        centralEntry.writeUInt16LE(0, 14);
        centralEntry.writeUInt32LE(crc, 16);
        centralEntry.writeUInt32LE(entry.data.length, 20);
        centralEntry.writeUInt32LE(entry.data.length, 24);
        centralEntry.writeUInt16LE(nameBytes.length, 28);
        centralEntry.writeUInt16LE(0, 30);
        centralEntry.writeUInt16LE(0, 32);
        centralEntry.writeUInt16LE(0, 34);
        centralEntry.writeUInt16LE(0, 36);
        centralEntry.writeUInt32LE(0, 38);
        centralEntry.writeUInt32LE(offset, 42);
        nameBytes.copy(centralEntry, 46);

        parts.push(localHeader, entry.data);
        centralDir.push(centralEntry);
        offset += localHeader.length + entry.data.length;
    }

    const centralDirBuf = Buffer.concat(centralDir);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDirBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...parts, centralDirBuf, eocd]);
}

function crc32(buf: Buffer): number {
    const table = new Uint32Array(256);
    
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c;
    }

    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]!) & 0xff]!;
    return (crc ^ 0xffffffff) >>> 0;
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
            assert.strictEqual(response.body.userId, userId);
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

        test('should extract content for PDF files', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', buildMinimalPdf('PDF upload test'), { filename: 'doc.pdf', contentType: 'application/pdf' })
                .expect(200);

            assert.ok(response.body.data.content);
            assert.ok(response.body.data.content.includes('PDF upload test'));
        });

        test('should succeed without content for unextractable binary files', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from('\x89PNG\r\n'), { filename: 'image.png', contentType: 'image/png' })
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
            assert.strictEqual(response.body.userId, userId);
            assert.strictEqual(response.body.filename, 'test.txt');
            assert.ok(response.body.data);
            assert.ok(response.body.meta);
            assert.ok(typeof response.body.createdAt === 'number');
            assert.ok(typeof response.body.updatedAt === 'number');
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

    describe('POST /api/v1/files/extract', () => {
        test('should extract text from .txt file', async () => {
            const { token } = await createUserWithToken('user');
            const textContent = 'Hello from a text file!';

            const response = await request(app)
                .post('/api/v1/files/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from(textContent), { filename: 'notes.txt', contentType: 'text/plain' })
                .expect(200);

            assert.strictEqual(response.body.content, textContent);
        });

        test('should extract text from .json file', async () => {
            const { token } = await createUserWithToken('user');
            const jsonContent = '{"key":"value","num":42}';

            const response = await request(app)
                .post('/api/v1/files/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from(jsonContent), { filename: 'data.json', contentType: 'application/json' })
                .expect(200);

            assert.strictEqual(response.body.content, jsonContent);
        });

        test('should extract text from PDF file', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', buildMinimalPdf('Extract endpoint test'), { filename: 'doc.pdf', contentType: 'application/pdf' })
                .expect(200);

            assert.ok(response.body.content);
            assert.ok(response.body.content.includes('Extract endpoint test'));
        });

        test('should extract text from DOCX file', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', buildMinimalDocx('DOCX extract test'), { filename: 'doc.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
                .expect(200);

            assert.ok(response.body.content);
            assert.ok(response.body.content.includes('DOCX extract test'));
        });

        test('should return 400 for unsupported file type', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from('\x89PNG\r\n'), { filename: 'image.png', contentType: 'image/png' })
                .expect(400);

            assert.ok(response.body.detail);
        });

        test('should return 400 for disallowed file type', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/extract')
                .set('Authorization', `Bearer ${token}`)
                .attach('file', Buffer.from('test'), 'malware.exe')
                .expect(400);

            assert.strictEqual(response.body.detail, 'File type not allowed');
        });

        test('should return 400 without file', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/files/extract')
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.strictEqual(response.body.detail, 'File required');
        });

        test('should return 401 without auth', async () => {
            await request(app)
                .post('/api/v1/files/extract')
                .attach('file', Buffer.from('test'), 'test.txt')
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
                data: {},
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
                data: {},
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
