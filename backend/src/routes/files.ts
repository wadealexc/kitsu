import { Router, type Response } from 'express';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import multer from 'multer';

import * as Types from './types.js';
import { requireAuth, validateFileId } from './middleware.js';
import { db } from '../db/client.js';
import * as Files from '../db/operations/files.js';
import { HttpError, NotFoundError, UnauthorizedError } from './errors.js';
import { StorageProvider } from '../storage/provider.js';

const router = Router();

/* -------------------- FILE VALIDATION CONFIG -------------------- */

// Maximum file size (100MB default)
const MB_IN_BYTES = 1024 * 1024;
const MAX_FILE_SIZE = process.env.MAX_FILE_SIZE ? parseInt(process.env.MAX_FILE_SIZE) : 100 * MB_IN_BYTES;

const MAX_FILE_COUNT = 1;

// Allowed file extensions
const ALLOWED_EXTENSIONS = [
    // Documents
    '.pdf', '.doc', '.docx', '.txt', '.md', '.rtf', '.odt',
    '.xls', '.xlsx', '.ppt', '.pptx', '.csv',

    // Code / text
    '.json', '.xml', '.yaml', '.yml', '.html', '.htm', '.css', '.js', '.ts',

    // Images
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',

    // Audio
    '.mp3', '.wav', '.ogg', '.m4a', '.flac',

    // Video
    '.mp4', '.webm', '.mov', '.avi',
];

/**
 * Validate file extension against allowlist.
 */
function validateFileExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_EXTENSIONS.includes(ext);
}

/**
 * Extract text content from a file buffer.
 * Returns the extracted string for supported types, undefined for unsupported types.
 */
async function extractTextContent(buffer: Buffer, mimeType: string): Promise<string | undefined> {
    const textMimeTypes = [
        'text/plain', 'text/markdown', 'text/csv', 'text/html',
        'text/css', 'text/javascript', 'text/xml',
        'application/json', 'application/xml',
    ];

    if (textMimeTypes.some((t) => mimeType.startsWith(t)) || mimeType.startsWith('text/')) {
        return buffer.toString('utf-8');
    }

    if (mimeType === 'application/pdf') {
        try {
            const parser = new PDFParse({ data: buffer });
            const result = await parser.getText();
            return result.text;
        } catch {
            return undefined;
        }
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        try {
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        } catch {
            return undefined;
        }
    }

    return undefined;
}

/* -------------------- MULTER MIDDLEWARE -------------------- */

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILE_COUNT,
    },
});

/* -------------------- FILE UPLOAD -------------------- */

/**
 * POST /api/v1/files/
 * Access Control: Any verified user can upload files
 *
 * Upload a new file. For text-extractable file types, content is extracted
 * and stored in data.content so it can be included in chat completion requests.
 *
 * @body multipart form-data with 'file' field
 * @returns {Types.FileModelResponse} - uploaded file metadata
 */
router.post('/', requireAuth, upload.single('file'), async (
    multerReq,
    res: Response<Types.FileModelResponse | Types.ErrorResponse>
) => {
    const req = multerReq as unknown as Types.TypedRequest<{}, {}, {}>;

    // Validate file exists and has valid extension
    if (!req.file) return res.status(400).json({ detail: 'File required' });

    if (!validateFileExtension(req.file.originalname)) return res.status(400).json({
        detail: 'File type not allowed'
    });

    const userId = req.user!.id;
    const fileBuffer = req.file.buffer;
    const originalFilename = req.file.originalname;
    const mimeType = req.file.mimetype;

    try {
        const file = await db.transaction(async (tx) => {
            // Upload to storage
            const uploadPath = await StorageProvider.uploadFile(fileBuffer);

            // Extract text content for text-based file types
            const textContent = await extractTextContent(fileBuffer, mimeType);

            // Create file record
            const newFile = await Files.createFile({
                userId: userId,
                filename: originalFilename,
                path: uploadPath,
                data: textContent !== undefined ? { content: textContent } : {},
                meta: {
                    name: originalFilename,
                    contentType: mimeType,
                    size: fileBuffer.length,
                },
            }, tx);

            return newFile;
        });

        const response: Types.FileModelResponse = {
            id: file.id,
            user_id: file.userId,
            filename: file.filename,
            data: file.data,
            meta: file.meta,
            created_at: file.createdAt,
            updated_at: file.updatedAt,
        };

        return res.json(response);
    } catch (error) {
        console.error('File upload error:', error);
        return res.status(500).json({ detail: 'File upload failed' });
    }
});

/* -------------------- FILE CONTENT EXTRACTION -------------------- */

/**
 * POST /api/v1/files/extract
 * Access Control: Any verified user
 *
 * Extract text content from an uploaded file without storing it.
 *
 * @body multipart form-data with 'file' field
 * @returns {Types.FileExtractResponse} - extracted text content
 */
router.post('/extract', requireAuth, upload.single('file'), async (
    multerReq,
    res: Response<Types.FileExtractResponse | Types.ErrorResponse>
) => {
    const req = multerReq as unknown as Types.TypedRequest<{}, {}, {}>;

    if (!req.file) return res.status(400).json({ detail: 'File required' });

    if (!validateFileExtension(req.file.originalname)) return res.status(400).json({
        detail: 'File type not allowed'
    });

    const content = await extractTextContent(req.file.buffer, req.file.mimetype);

    if (content === undefined) {
        return res.status(400).json({ detail: 'Content extraction not supported for this file type' });
    }

    return res.json({ content });
});

/* -------------------- FILE RETRIEVAL BY ID -------------------- */

/**
 * GET /api/v1/files/:file_id
 * Access Control: User owns or has read access to file
 *
 * Get file metadata by ID.
 *
 * @param {Types.FileIdParams} - path parameters with file ID
 * @returns {Types.FileModelResponse} - file metadata
 */
router.get('/:file_id', validateFileId, requireAuth, async (
    req: Types.TypedRequest<Types.FileIdParams>,
    res: Response<Types.FileModelResponse | Types.ErrorResponse>
) => {
    const { file_id: fileId } = req.params;
    const userId = req.user!.id;

    try {
        const file = await Files.getFileById(fileId, db);
        if (!file) throw NotFoundError('File not found');

        const hasAccess = await Files.hasFileAccess(fileId, userId, 'read', db);
        if (!hasAccess) throw UnauthorizedError('User does not have access to file');

        return res.json({
            id: file.id,
            user_id: file.userId,
            filename: file.filename,
            data: file.data,
            meta: file.meta,
            created_at: file.createdAt,
            updated_at: file.updatedAt,
        });
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get file by id error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- FILE CONTENT RETRIEVAL -------------------- */

/**
 * GET /api/v1/files/:file_id/content
 * Access Control: Read access required
 *
 * Download file content directly.
 *
 * @param {Types.FileIdParams} - path parameters with file ID
 * @query {Types.FileContentQuery} - attachment query parameter
 * @returns File content with appropriate headers
 */
router.get('/:file_id/content', validateFileId, requireAuth, async (
    req: Types.TypedRequest<Types.FileIdParams, any, Types.FileContentQuery>,
    res: Response
) => {
    const query = Types.FileContentQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { file_id: fileId } = req.params;
    const userId = req.user!.id;
    const { attachment } = query.data;

    try {
        const file = await Files.getFileById(fileId, db);
        if (!file) throw NotFoundError('File not found');

        const hasReadAccess = await Files.hasFileAccess(fileId, userId, 'read', db);
        if (!hasReadAccess) throw UnauthorizedError('User does not have access to file');

        if (!file.path) throw NotFoundError('File not found');

        const fileBuffer = await StorageProvider.downloadFile(file.path);

        const contentType = file.meta?.contentType || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        const isPDF = contentType === 'application/pdf';
        const disposition = (isPDF && !attachment) ? 'inline' : 'attachment';
        const encodedFilename = encodeURIComponent(file.filename);
        res.setHeader(
            'Content-Disposition',
            `${disposition}; filename="${file.filename}"; filename*=UTF-8''${encodedFilename}`
        );

        return res.status(200).send(fileBuffer);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get file content error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

export default router;
