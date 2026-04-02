import { z } from 'zod';

import type { File } from '../../db/operations/files.js';
import { FileIdSchema, UserIdSchema } from './common.js';

// File metadata structure
export const FileMetaSchema = z.object({
    name: z.string(),
    contentType: z.string(),
    size: z.number(),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

// File data structure
export const FileDataSchema = z.object({
    content: z.string().optional(),
});
export type FileData = z.infer<typeof FileDataSchema>;

// File model response (DB File minus path and accessControl)
export type FileModelResponse = Omit<File, 'path' | 'accessControl'>;

// Query parameters for GET /api/v1/files/{id}/content
export const FileContentQuerySchema = z.object({
    attachment: z.stringbool().default(false),
});
export type FileContentQuery = z.infer<typeof FileContentQuerySchema>;

// File content extraction response
export const FileExtractResponseSchema = z.object({
    content: z.string(),
});
export type FileExtractResponse = z.infer<typeof FileExtractResponseSchema>;
