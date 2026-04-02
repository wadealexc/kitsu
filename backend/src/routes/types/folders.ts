import { z } from 'zod';

import type { Folder } from '../../db/operations/folders.js';
import { FolderIdSchema, UserIdSchema } from './common.js';

/** File or collection reference in folder data */
export interface FolderFileItem {
    type: 'file' | 'collection';
    id: string;
    name: string;
    collectionName?: string;
    url?: string;
    status?: 'uploading' | 'uploaded';
    size?: number;
    context?: 'full';
    error?: string;
    itemId?: string;
}

export const FolderFileItemSchema: z.ZodType<FolderFileItem> = z.object({
    type: z.enum(['file', 'collection']),
    id: z.string(),
    name: z.string(),
    collectionName: z.string().optional(),
    url: z.string().optional(),
    status: z.enum(['uploading', 'uploaded']).optional(),
    size: z.number().optional(),
    context: z.literal('full').optional(),
    error: z.string().optional(),
    itemId: z.string().optional(),
});

/** Folder data structure containing functionality settings */
export interface FolderData {
    systemPrompt?: string;
    files?: FolderFileItem[];
    modelId?: string;
}

export const FolderDataSchema: z.ZodType<FolderData> = z.object({
    systemPrompt: z.string().optional(),
    files: z.array(FolderFileItemSchema).optional(),
    modelId: z.string().optional(),
});

/** Folder metadata for UI presentation */
export interface FolderMeta {
    icon?: string | null;
}

export const FolderMetaSchema: z.ZodType<FolderMeta> = z.object({
    icon: z.string().nullable().optional(),
}).passthrough();

// Folder name/ID response (lightweight list response — DB Folder minus userId and data)
export type FolderNameIdResponse = Omit<Folder, 'userId' | 'data'>;

// Folder form (for creating folders)
export const FolderFormSchema = z.object({
    name: z.string(),
    data: FolderDataSchema.nullable().optional(),
    meta: FolderMetaSchema.nullable().optional(),
}).passthrough();
export type FolderForm = z.infer<typeof FolderFormSchema>;

// Folder update form
export const FolderUpdateFormSchema = z.object({
    name: z.string().nullable().optional(),
    data: FolderDataSchema.nullable().optional(),
    meta: FolderMetaSchema.nullable().optional(),
}).passthrough();
export type FolderUpdateForm = z.infer<typeof FolderUpdateFormSchema>;

// Folder parent ID form
export const FolderParentIdFormSchema = z.object({
    parentId: FolderIdSchema.nullable().optional(),
});
export type FolderParentIdForm = z.infer<typeof FolderParentIdFormSchema>;

// Folder is_expanded form
export const FolderIsExpandedFormSchema = z.object({
    isExpanded: z.boolean(),
});
export type FolderIsExpandedForm = z.infer<typeof FolderIsExpandedFormSchema>;

// Query parameters for DELETE /api/v1/folders/:id
export const FolderDeleteQuerySchema = z.object({
    deleteContents: z.stringbool().default(true),
});
export type FolderDeleteQuery = z.infer<typeof FolderDeleteQuerySchema>;
