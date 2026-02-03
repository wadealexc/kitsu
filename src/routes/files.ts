/**
 * File routes - file management for multimodal chat and attachments.
 *
 * Handles file uploads, downloads, content extraction, and lifecycle management.
 * Files are user-scoped with granular access control.
 */

import { Router, type Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import * as Types from './types.js';
import { requireAuth, requireAdmin, validateFileId } from './middleware.js';
import { db } from '../db/client.js';
import * as Files from '../db/operations/files.js';
import * as Users from '../db/operations/users.js';
import type { File } from '../db/schema.js';
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

/* -------------------- MULTER MIDDLEWARE -------------------- */

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILE_COUNT,
    },
});

/* -------------------- FILE LIST & SEARCH -------------------- */

/**
 * GET /api/v1/files/
 * Access Control: User can only access their own files (admin sees all)
 *
 * Get all files accessible to the current user.
 *
 * @query {Types.FileListQuery} - optional query parameters
 * @returns {Types.FileModelResponse[]} - array of file responses
 */
router.get('/', requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.FileListQuery>,
    res: Response<Types.FileModelResponse[] | Types.ErrorResponse>
) => {
    const query = Types.FileListQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { content } = query.data;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    try {
        // Admin users see all files, regular users only see their own
        const files = isAdmin
            ? await Files.getFiles(db)
            : (await Files.getFilesByUserId(userId, {}, db)).items;

        // Map to FileModelResponse (exclude path and access_control fields)
        const response: Types.FileModelResponse[] = files.map(file => ({
            id: file.id,
            user_id: file.userId,
            hash: file.hash,
            filename: file.filename,
            data: content === false ? null : (file.data),
            meta: file.meta || {},
            created_at: file.createdAt,
            updated_at: file.updatedAt,
        }));

        return res.json(response);
    } catch (error) {
        console.error('Get files error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/files/search
 * Access Control: User can only search their own files (admin sees all)
 *
 * Search files using filename patterns (wildcards).
 *
 * @query {Types.FileSearchQuery} - search parameters
 * @returns {Types.FileModelResponse[]} - array of matching files
 */
router.get('/search', requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.FileSearchQuery>,
    res: Response<Types.FileModelResponse[] | Types.ErrorResponse>
) => {
    const query = Types.FileSearchQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { filename, content, skip, limit } = query.data;
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    try {
        // Admin users search all files, regular users only their own
        const files = await Files.searchFiles(
            isAdmin ? null : userId,
            filename,
            skip,
            limit,
            db
        );

        if (files.length === 0) throw NotFoundError('No files found matching pattern');

        // Map to FileModelResponse
        const response: Types.FileModelResponse[] = files.map(file => ({
            id: file.id,
            user_id: file.userId,
            hash: file.hash,
            filename: file.filename,
            data: content === false ? null : (file.data),
            meta: file.meta || {},
            created_at: file.createdAt,
            updated_at: file.updatedAt,
        }));

        return res.json(response);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Search files error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- FILE UPLOAD -------------------- */

/**
 * POST /api/v1/files/
 * Access Control: Any verified user can upload files
 *
 * Upload a new file with optional automatic processing.
 *
 * @query {Types.UploadFileQuery} - processing options
 * @body {Types.UploadFileForm} - multipart form-data
 * @returns {Types.FileModelResponse} - uploaded file metadata
 */
router.post('/', requireAuth, upload.single('file'), async (
    multerReq,
    res: Response<Types.FileModelResponse | Types.ErrorResponse>
) => {
    const req = multerReq as unknown as Types.TypedRequest<{}, Types.UploadFileForm, Types.UploadFileQuery>;
    const query = Types.UploadFileQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { process, process_in_background: processInBackground } = query.data;

    // Validate file exists and has valid extension
    if (!req.file) return res.status(400).json({ 
        detail: 'File required' 
    });

    // Validate file extension
    if (!validateFileExtension(req.file.originalname)) return res.status(400).json({ 
        detail: 'File type not allowed' 
    });

    // Parse metadata
    let metadata: Record<string, any> = {};
    if (req.body.metadata) {
        try {
            metadata = typeof req.body.metadata === 'string'
                ? JSON.parse(req.body.metadata)
                : req.body.metadata;
        } catch (error) {
            // Ignore parsing errors, use empty metadata
        }
    }

    const userId = req.user!.id;
    const fileBuffer = req.file.buffer;
    const originalFilename = req.file.originalname;
    const mimeType = req.file.mimetype;

    try {
        const file = await db.transaction(async (tx) => {
            // Generate file ID
            const fileId = crypto.randomUUID();

            // Calculate hash
            const hash = crypto.createHash('sha256')
                .update(fileBuffer)
                .digest('hex');

            // Upload to storage
            const uploadPath = await StorageProvider.uploadFile(
                fileId,
                fileBuffer,
                metadata
            );

            // Create file record
            const newFile = await Files.createFile(userId, {
                id: fileId,
                filename: originalFilename,
                path: uploadPath,
                hash: hash,
                data: { status: 'completed' },
                meta: {
                    name: originalFilename,
                    content_type: mimeType,
                    size: fileBuffer.length,
                    data: metadata,
                },
            }, tx);

            // TODO: Trigger processing pipeline
            // if (process) {
            //     if (processInBackground) {
            //         processFileInBackground(fileId);
            //     } else {
            //         await processFile(fileId);
            //     }
            // }

            return newFile;
        });

        // Map to FileModelResponse
        const response: Types.FileModelResponse = {
            id: file.id,
            user_id: file.userId,
            hash: file.hash,
            filename: file.filename,
            data: file.data,
            meta: file.meta || {},
            created_at: file.createdAt,
            updated_at: file.updatedAt,
        };

        return res.json(response);
    } catch (error) {
        console.error('File upload error:', error);
        return res.status(500).json({ detail: 'File upload failed' });
    }
});

/* -------------------- FILE DELETION -------------------- */

/**
 * DELETE /api/v1/files/all
 * Access Control: Admin only
 *
 * Delete all files from the system.
 *
 * @returns {Types.FileDeleteResponse} - success message
 */
router.delete('/all', requireAdmin, async (
    req: Types.TypedRequest,
    res: Response<Types.FileDeleteResponse | Types.ErrorResponse>
) => {
    try {
        await db.transaction(async (tx) => {
            // Get all file paths before deletion
            const allFiles = await Files.getFiles(tx);

            // Delete all file records
            await Files.deleteAllFiles(tx);

            // Delete physical files asynchronously
            allFiles.forEach(file => {
                if (file.path) {
                    StorageProvider.deleteFile(file.path).catch(err => {
                        console.error(`Failed to delete file ${file.id}:`, err);
                    });
                }
            });

            // TODO: Delete all vector database collections
            // for (const file of allFiles) {
            //     VectorDB.deleteCollection(`file-${file.id}`).catch(err => {
            //         console.error(`Failed to delete collection for ${file.id}:`, err);
            //     });
            // }
        });

        return res.json({ message: 'All files deleted successfully' });
    } catch (error) {
        console.error('Delete all files error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- FILE RETRIEVAL BY ID -------------------- */

/**
 * GET /api/v1/files/:file_id
 * Access Control: User owns file, is admin, or has access via knowledge base/channel/shared chat
 *
 * Get file metadata by ID.
 *
 * @param {Types.FileIdParams} - path parameters with file ID
 * @returns {Types.FileModel} - full file metadata including internal path
 */
router.get('/:file_id', validateFileId, requireAuth, async (
    req: Types.TypedRequest<Types.FileIdParams>,
    res: Response<Types.FileModel | Types.ErrorResponse>
) => {
    const { file_id: fileId } = req.params;
    const userId = req.user!.id;

    try {
        // Get file
        const file = await Files.getFileById(fileId, db);
        if (!file) throw NotFoundError('File not found');

        // Check access control
        const hasAccess = await Files.hasFileAccess(fileId, userId, 'read', db);
        if (!hasAccess) throw UnauthorizedError('User does not have access to file');

        // Return full file model (includes path and access_control)
        return res.json({
            id: file.id,
            user_id: file.userId,
            hash: file.hash,
            filename: file.filename,
            path: file.path,
            data: file.data,
            meta: file.meta,
            access_control: file.accessControl,
            created_at: file.createdAt,
            updated_at: file.updatedAt,
        });
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get file by id error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * DELETE /api/v1/files/:file_id
 * Access Control: Owner, admin, or write access to associated resources
 *
 * Delete a specific file.
 *
 * @param {Types.FileIdParams} - path parameters with file ID
 * @returns {Types.FileDeleteResponse} - success message
 */
router.delete('/:file_id', validateFileId, requireAuth, async (
    req: Types.TypedRequest<Types.FileIdParams>,
    res: Response<Types.FileDeleteResponse | Types.ErrorResponse>
) => {
    const { file_id: fileId } = req.params;
    const userId = req.user!.id;

    try {
        await db.transaction(async (tx) => {
            // Get file
            const file = await Files.getFileById(fileId, tx);
            if (!file) throw NotFoundError('File not found');

            // Check write access
            const hasWriteAccess = await Files.hasFileAccess(fileId, userId, 'write', tx);
            if (!hasWriteAccess) throw UnauthorizedError('User does not have access to file');

            // Delete file record
            await Files.deleteFile(fileId, tx);

            // Delete physical file asynchronously
            if (file.path) {
                StorageProvider.deleteFile(file.path).catch(err => {
                    console.error(`Failed to delete file ${fileId}:`, err);
                });
            }

            // TODO: Delete vector database collection
            // VectorDB.deleteCollection(`file-${fileId}`).catch(err => {
            //     console.error(`Failed to delete collection for ${fileId}:`, err);
            // });
        });

        return res.json({ message: `File ${fileId} deleted successfully` });
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Delete file error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- FILE CONTENT RETRIEVAL -------------------- */

/**
 * GET /api/v1/files/:file_id/content
 * Access Control: Read access required (owner, admin, or access to associated resources)
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
        // Get file
        const file = await Files.getFileById(fileId, db);
        if (!file) throw NotFoundError('File not found');

        // Check read access
        const hasReadAccess = await Files.hasFileAccess(fileId, userId, 'read', db);
        if (!hasReadAccess) throw UnauthorizedError('User does not have access to file');

        // Check physical file exists
        if (!file.path) throw NotFoundError('File not found');

        // Download file from storage
        const fileBuffer = await StorageProvider.downloadFile(file.path);

        // Set content type
        const contentType = file.meta?.content_type
            || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        // Set content disposition
        const isPDF = contentType === 'application/pdf';
        const disposition = (isPDF && !attachment) ? 'inline' : 'attachment';
        const encodedFilename = encodeURIComponent(file.filename);
        res.setHeader(
            'Content-Disposition',
            `${disposition}; filename="${file.filename}"; filename*=UTF-8''${encodedFilename}`
        );

        // Stream file
        return res.status(200).send(fileBuffer);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get file content error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/files/:file_id/content/:file_name
 * Access Control: Read access required
 *
 * Download file content with specific filename.
 *
 * @param {Types.NamedFileParams} - path parameters with file ID and filename
 * @returns File content or extracted text with specified filename
 */
router.get('/:file_id/content/:file_name', validateFileId, requireAuth, async (
    req: Types.TypedRequest<Types.NamedFileParams>,
    res: Response
) => {
    const { file_id: fileId, file_name: fileName } = req.params;
    const userId = req.user!.id;

    try {
        // Get file
        const file = await Files.getFileById(fileId, db);
        if (!file) throw NotFoundError('File not found');

        // Check read access
        const hasReadAccess = await Files.hasFileAccess(fileId, userId, 'read', db);
        if (!hasReadAccess) throw UnauthorizedError('User does not have access to file');

        // Try to get physical file
        if (file.path) {
            try {
                const fileBuffer = await StorageProvider.downloadFile(file.path);

                // Use custom filename from path parameter
                const contentType = file.meta?.content_type
                    || 'application/octet-stream';
                res.setHeader('Content-Type', contentType);

                const encodedFilename = encodeURIComponent(fileName);
                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFilename}`
                );

                return res.status(200).send(fileBuffer);
            } catch (error) {
                // Physical file not found, try extracted content
            }
        }

        // Fallback: Stream extracted text content
        const fileData = file.data;
        const content = fileData?.content;
        if (!content) throw NotFoundError('File not found');

        // Stream text content
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        const encodedFilename = encodeURIComponent(fileName);
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${fileName}"; filename*=UTF-8''${encodedFilename}`
        );

        return res.status(200).send(content);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get file content with filename error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/files/:file_id/content/html
 * Access Control: Admin-owned files only
 *
 * Get file content as raw HTML.
 *
 * @param {Types.FileIdParams} - path parameters with file ID
 * @returns Raw file content
 */
// TODO - not needed for now
// router.get('/:file_id/content/html', validateFileId, requireAuth, async (
//     req: Types.TypedRequest<Types.FileIdParams>,
//     res: Response
// ) => {
//     const { file_id: fileId } = req.params;
//     const userId = req.user!.id;

//     try {
//         // Get file
//         const file = await Files.getFileById(fileId, db);
//         if (!file) throw NotFoundError('File not found');

//         // Check if file is admin-owned
//         const owner = await Users.getUserById(file.userId, db);
//         if (!owner || owner.role !== 'admin') throw UnauthorizedError('User does not have access to file');

//         // Check read access
//         const hasReadAccess = await Files.hasFileAccess(fileId, userId, 'read', db);
//         if (!hasReadAccess) throw UnauthorizedError('User does not have access to file');

//         // Check physical file exists
//         if (!file.path) throw NotFoundError('File not found');

//         // Download and return raw file content
//         const fileBuffer = await StorageProvider.downloadFile(file.path);

//         // Return raw content (no Content-Type or Content-Disposition headers)
//         return res.status(200).send(fileBuffer);
//     } catch (error) {
//         if (error instanceof HttpError) {
//             return res.status(error.statusCode).json({ detail: error.message });
//         }

//         // Handle validation errors from operations
//         if (error instanceof Error) {
//             return res.status(400).json({ detail: error.message });
//         }

//         console.error('Get HTML content error:', error);
//         return res.status(500).json({ detail: 'Internal server error' });
//     }
// });

/* -------------------- FILE DATA & CONTENT MANAGEMENT -------------------- */

/**
 * GET /api/v1/files/:file_id/data/content
 * Access Control: Read access required
 *
 * Get extracted text content from processed file.
 *
 * @param {Types.FileIdParams} - path parameters with file ID
 * @returns {Types.FileDataContentResponse} - extracted content
 */
router.get('/:file_id/data/content', validateFileId, requireAuth, async (
    req: Types.TypedRequest<Types.FileIdParams>,
    res: Response<Types.FileDataContentResponse | Types.ErrorResponse>
) => {
    const { file_id: fileId } = req.params;
    const userId = req.user!.id;

    try {
        // Get file
        const file = await Files.getFileById(fileId, db);
        if (!file) throw NotFoundError('File not found');

        // Check read access
        const hasReadAccess = await Files.hasFileAccess(fileId, userId, 'read', db);
        if (!hasReadAccess) throw UnauthorizedError('User does not have access to file');

        // Return extracted content
        const fileData = file.data;
        const content = fileData?.content || '';

        return res.json({ content });
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get file data content error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/files/:file_id/data/content/update
 * Access Control: Write access required (owner, admin, or write access to associated resources)
 *
 * Update file's extracted content and reprocess.
 *
 * @param {Types.FileIdParams} - path parameters with file ID
 * @body {Types.ContentForm} - new content
 * @returns {Types.FileModelResponse} - updated file
 */
router.post('/:file_id/data/content/update', validateFileId, requireAuth, async (
    req: Types.TypedRequest<Types.FileIdParams, Types.ContentForm>,
    res: Response<Types.FileModelResponse | Types.ErrorResponse>
) => {
    const body = Types.ContentFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { file_id: fileId } = req.params;
    const userId = req.user!.id;
    const { content } = body.data;

    try {
        const updatedFile = await db.transaction(async (tx) => {
            // Get file
            const file = await Files.getFileById(fileId, tx);
            if (!file) throw NotFoundError('File not found');

            // Check write access
            const hasWriteAccess = await Files.hasFileAccess(fileId, userId, 'write', tx);
            if (!hasWriteAccess) throw UnauthorizedError('User does not have access to file');

            // Update file data
            const updated = await Files.updateFileData(fileId, {
                content: content,
                status: 'pending',  // Mark for reprocessing
            }, tx);

            // TODO: Trigger reprocessing
            // processFileInBackground(fileId);

            // TODO: Update vector database
            // VectorDB.updateCollection(`file-${fileId}`, content);

            return updated;
        });

        if (!updatedFile) throw NotFoundError('File not found');

        // Map to FileModelResponse
        const response: Types.FileModelResponse = {
            id: updatedFile.id,
            user_id: updatedFile.userId,
            hash: updatedFile.hash,
            filename: updatedFile.filename,
            data: updatedFile.data,
            meta: updatedFile.meta || {},
            created_at: updatedFile.createdAt,
            updated_at: updatedFile.updatedAt,
        };

        return res.json(response);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Update file content error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- FILE PROCESSING STATUS -------------------- */

/**
 * GET /api/v1/files/:file_id/process/status
 * Access Control: Read access required
 *
 * Get file processing status with optional streaming.
 *
 * @param {Types.FileIdParams} - path parameters with file ID
 * @query {Types.FileProcessStatusQuery} - stream parameter
 * @returns {Types.FileProcessStatusResponse} - processing status (non-streaming)
 * @returns text/event-stream - SSE stream (streaming mode)
 */
router.get('/:file_id/process/status', validateFileId, requireAuth, async (
    req: Types.TypedRequest<Types.FileIdParams, any, Types.FileProcessStatusQuery>,
    res: Response<Types.FileProcessStatusResponse | Types.ErrorResponse>
) => {
    const query = Types.FileProcessStatusQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { file_id: fileId } = req.params;
    const userId = req.user!.id;
    const { stream } = query.data;

    try {
        // Get file
        const file = await Files.getFileById(fileId, db);
        if (!file) throw NotFoundError('File not found');

        // Check read access
        const hasReadAccess = await Files.hasFileAccess(fileId, userId, 'read', db);
        if (!hasReadAccess) throw UnauthorizedError('User does not have access to file');

        const fileData = file.data;
        const status = fileData?.status || 'pending';

        if (!stream) {
            // Non-streaming mode: return status immediately
            return res.json({ status });
        }

        // Streaming mode: SSE stream
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const maxDuration = 2 * 60 * 60 * 1000; // 2 hours
        const pollInterval = 1000; // 1 second
        const startTime = Date.now();

        const poll = async () => {
            // Check timeout
            if (Date.now() - startTime > maxDuration) {
                res.write(`data: ${JSON.stringify({ status: 'timeout' })}\n\n`);
                res.end();
                return;
            }

            // Get current status
            const currentFile = await Files.getFileById(fileId, db);
            if (!currentFile) {
                res.write(`data: ${JSON.stringify({ status: 'not_found' })}\n\n`);
                res.end();
                return;
            }

            const currentData = currentFile.data;
            const currentStatus = currentData?.status || 'pending';

            // Send status update
            const event: any = { status: currentStatus };
            if (currentStatus === 'failed' && currentData?.error) {
                event.error = currentData.error;
            }
            res.write(`data: ${JSON.stringify(event)}\n\n`);

            // Check if processing complete
            if (currentStatus === 'completed' || currentStatus === 'failed') {
                res.end();
                return;
            }

            // Continue polling
            setTimeout(poll, pollInterval);
        };

        // Start polling
        poll();
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get file process status error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

export default router;
