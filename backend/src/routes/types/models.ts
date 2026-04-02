import { z } from 'zod';

import type { Model } from '../../db/operations/models.js';
import { UserIdSchema, UserRoleSchema } from './common.js';

// Access control structure (read/write permissions)
export const AccessControlSchema = z.object({
    read: z.object({
        user_ids: z.array(UserIdSchema),
    }).optional(),
    write: z.object({
        user_ids: z.array(UserIdSchema),
    }).optional(),
});
export type AccessControl = z.infer<typeof AccessControlSchema>;

// Model parameters
export const ModelParamsSchema = z.object({
    // Sampling
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
    min_p: z.number().optional(),
    max_tokens: z.number().optional(),
    seed: z.number().optional(),
    frequency_penalty: z.number().optional(),
    presence_penalty: z.number().optional(),
    repeat_penalty: z.number().optional(),
    repeat_last_n: z.number().optional(),
    mirostat: z.number().optional(),
    mirostat_eta: z.number().optional(),
    mirostat_tau: z.number().optional(),
    tfs_z: z.number().optional(),
    // Control
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    system: z.string().optional(),           // TODO - not OAI
    stream_response: z.boolean().optional(), // TODO - remove
    reasoning_effort: z.string().optional(), // TODO - remove
    logit_bias: z.union([z.array(z.any()), z.record(z.string(), z.any())]).optional(),
    chat_template_kwargs: z.record(z.string(), z.any()).optional(),
});
export type ModelParams = z.infer<typeof ModelParamsSchema>;

// Model metadata
export const ModelMetaSchema = z.object({
    description: z.string().nullable().optional(),
}).passthrough();
export type ModelMeta = z.infer<typeof ModelMetaSchema>;

// User response (for model owner info)
export const UserResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

// Model response (DB model + optional runtime fields)
export type ModelResponse = Model & {
    contextLength?: number;
    status?: 'idle' | 'queued' | 'active';
};

// Model access response (includes user info and write access flag)
export type ModelAccessResponse = ModelResponse & {
    user: UserResponse | null;
    writeAccess: boolean;
};

// Model access list response (paginated)
export const ModelAccessListResponseSchema = z.object({
    items: z.array(z.any()),
    total: z.number(),
});
export type ModelAccessListResponse = {
    items: ModelAccessResponse[];
    total: number;
};

// Model form (for create/update)
export const ModelFormSchema = z.object({
    id: z.string().max(256),
    baseModelId: z.string().max(256),
    name: z.string().max(256),
    meta: ModelMetaSchema,
    params: ModelParamsSchema,
    isPublic: z.boolean().default(true),
    isActive: z.boolean().default(true),
});
export type ModelForm = z.infer<typeof ModelFormSchema>;

// Model ID form (for delete/single-ID operations)
export const ModelIdFormSchema = z.object({
    id: z.string(),
});
export type ModelIdForm = z.infer<typeof ModelIdFormSchema>;

// Query parameters for GET /api/v1/models
export const ModelsQuerySchema = z.object({
    refresh: z.stringbool().optional().default(false),
});
export type ModelsQuery = z.infer<typeof ModelsQuerySchema>;

// Query parameters for GET /api/v1/models/list
export const ModelListQuerySchema = z.object({
    query: z.string().optional(),
    viewOption: z.enum(['created', 'shared']).optional(),
    orderBy: z.enum(['name', 'createdAt', 'updatedAt']).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
}).passthrough();
export type ModelListQuery = z.infer<typeof ModelListQuerySchema>;

// Query parameters for GET /api/v1/models/model and POST /api/v1/models/model/toggle
export const ModelIdQuerySchema = z.object({
    id: z.string(),
});
export type ModelIdQuery = z.infer<typeof ModelIdQuerySchema>;
