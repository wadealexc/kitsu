/**
 * Shared type definitions and Zod schemas for API routes.
 *
 * All routes import from this file to avoid duplication.
 */

import { z } from 'zod';
import { type Request } from 'express';
import parse, { type StringValue } from 'ms';
import { DEFAULT_USER_ROLE } from '../db/schema.js';

/* -------------------- HELPER TYPES -------------------- */

const DEFAULT_CHAT_TITLE = "New Chat";

// Generic type for Express requests with typed params, body, and/or query
// Usage:
//   TypedRequest<{ user_id: string }>                    - only path params
//   TypedRequest<{}, SomeBodyType>                       - only body
//   TypedRequest<{ user_id: string }, SomeBody>          - params and body
//   TypedRequest<{}, any, SomeQueryType>                 - only query params
//   TypedRequest<{ user_id: string }, any, SomeQuery>    - params and query
export type TypedRequest<P = {}, B = any, Q = any> = Request<P, any, B, Q>;

// Chat ID schema (UUID v4 format OR "local:<socket_id>" for temporary chats)
export const ChatIdSchema = z.union([
    z.uuidv4(),  // Permanent chat: UUID v4
    z.string().regex(/^local:[a-zA-Z0-9_-]+$/),  // Temporary chat starts with `local:`
]);
export type ChatId = z.infer<typeof ChatIdSchema>;

// User ID schema (UUID v4 format)
export const UserIdSchema = z.uuidv4();
export type UserId = z.infer<typeof UserIdSchema>;

// Share ID schema (UUID v4 format)
export const ShareIdSchema = z.uuidv4();
export type ShareId = z.infer<typeof ShareIdSchema>;

// Folder ID schema (UUID v4 format)
export const FolderIdSchema = z.uuidv4();
export type FolderId = z.infer<typeof FolderIdSchema>;

// Message ID schema (UUID v4 format)
export const MessageIdSchema = z.uuidv4();
export type MessageId = z.infer<typeof MessageIdSchema>;

// File ID schema (UUID v4 format)
export const FileIdSchema = z.uuidv4();
export type FileId = z.infer<typeof FileIdSchema>;

// Path parameter types
export type ChatIdParams = { id: ChatId };
export type UserIdParams = { user_id: UserId };
export type FolderIdParams = { folder_id: FolderId };
export type FileIdParams = { file_id: FileId };
export type ShareIdParams = { share_id: ShareId };
export type MessageIdParams = { id: ChatId; message_id: MessageId };

/* -------------------- COMMON SCHEMAS -------------------- */

// Error response (standard format for validation/auth errors)
export const ErrorResponseSchema = z.object({
    detail: z.string(),
    errors: z.array(z.any()).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Status response (simple success response)
export const StatusResponseSchema = z.object({
    status: z.boolean(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

/* -------------------- AUTH SCHEMAS -------------------- */

// User role enum
export const UserRoleSchema = z.enum(['admin', 'user', 'pending']);
export type UserRole = z.infer<typeof UserRoleSchema>;

// Signin
export const SigninFormSchema = z.object({
    username: z.string(),
    password: z.string(),
});
export type SigninForm = z.infer<typeof SigninFormSchema>;

// Signup
export const SignupFormSchema = z.object({
    username: z.string(),
    password: z.string(),
});
export type SignupForm = z.infer<typeof SignupFormSchema>;

// Signout
export const SignoutResponseSchema = z.object({
    status: z.boolean(),
    redirect_url: z.string().nullable().optional(),
});
export type SignoutResponse = z.infer<typeof SignoutResponseSchema>;

// Session responses
export const SessionUserResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
    token: z.string(),
    token_type: z.string(),
    expires_at: z.number().nullable().optional(),
});
export type SessionUserResponse = z.infer<typeof SessionUserResponseSchema>;

// Profile update
export const UpdateProfileFormSchema = z.object({
    username: z.string(),
});
export type UpdateProfileForm = z.infer<typeof UpdateProfileFormSchema>;

export const UpdateProfileResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
});
export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponseSchema>;

// Password update
export const UpdatePasswordFormSchema = z.object({
    password: z.string(),
    new_password: z.string(),
});
export type UpdatePasswordForm = z.infer<typeof UpdatePasswordFormSchema>;

// Timezone update
export const UpdateTimezoneFormSchema = z.object({
    timezone: z.string(),
});
export type UpdateTimezoneForm = z.infer<typeof UpdateTimezoneFormSchema>;

export const SigninResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
    token: z.string(),
    token_type: z.string(),
});
export type SigninResponse = z.infer<typeof SigninResponseSchema>;

// Admin config
const MsStringValueSchema = z.custom<StringValue>((v) => {
    if (v === '-1') return true;

    try {
        const n = parse(v as StringValue);
        return typeof n === "number" && Number.isFinite(n);
    } catch {
        return false;
    }
}, {
    message: 'Must be a valid ms time string (e.g. "1d", "2h", "30m", "2 days", "1 mo")',
});

export const AdminConfigSchema = z.object({
    APP_URL: z.string(),
    ENABLE_SIGNUP: z.boolean(),
    DEFAULT_USER_ROLE: z.enum(['pending', 'user', 'admin']),
    JWT_EXPIRES_IN: MsStringValueSchema,
});
export type AdminConfig = z.infer<typeof AdminConfigSchema>;

/* -------------------- CONFIG SCHEMAS -------------------- */

// Import config form (for POST /api/v1/configs/import)
export const ImportConfigFormSchema = z.object({
    config: z.record(z.string(), z.any()),  // Generic object with string keys and any values
});
export type ImportConfigForm = z.infer<typeof ImportConfigFormSchema>;

/* -------------------- USER SCHEMAS -------------------- */

// User settings (UI preferences)
// TODO: See /docs/extra.md for full UserSettings specification with source locations
export const UserSettingsSchema = z.object({
    ui: z.record(z.string(), z.any()).optional().default({}),
}).passthrough();  // Allow additional properties
export type UserSettings = z.infer<typeof UserSettingsSchema>;

// User model (complete user object)
export const UserModelSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema.default(DEFAULT_USER_ROLE),
    timezone: z.string().optional(),
    info: z.record(z.string(), z.any()).optional(),
    settings: UserSettingsSchema.optional(),
    last_active_at: z.number(),
    updated_at: z.number(),
    created_at: z.number(),
});
export type UserModel = z.infer<typeof UserModelSchema>;

// User info response (basic subset)
export const UserInfoResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
});
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;

// User info list response (for search/list endpoints)
export const UserInfoListResponseSchema = z.object({
    users: z.array(UserInfoResponseSchema),
    total: z.number(),
});
export type UserInfoListResponse = z.infer<typeof UserInfoListResponseSchema>;

// User group IDs list response
export const UserModelListResponseSchema = z.object({
    users: z.array(UserModelSchema),
    total: z.number(),
});
export type UserModelListResponse = z.infer<typeof UserModelListResponseSchema>;

// User active response
export const UserActiveResponseSchema = z.object({
    username: z.string(),
    is_active: z.boolean(),
});
export type UserActiveResponse = z.infer<typeof UserActiveResponseSchema>;

// User update form (admin operation)
export const UserUpdateFormSchema = z.object({
    role: UserRoleSchema,
    username: z.string(),
    password: z.string().optional(),
});
export type UserUpdateForm = z.infer<typeof UserUpdateFormSchema>;

// User list/search query parameters
export const UserListQuerySchema = z.object({
    query: z.string().optional(),
    order_by: z.enum(['role', 'username', 'last_active_at', 'created_at']).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

/* -------------------- MODEL SCHEMAS -------------------- */

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
}).passthrough();  // Allow additional properties
export type ModelMeta = z.infer<typeof ModelMetaSchema>;

// User response (for model owner info)
export const UserResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

// Model response (standard database representation)
export const ModelResponseSchema = z.object({
    id: z.string().max(256),
    user_id: UserIdSchema,
    base_model_id: z.string(),
    name: z.string(),
    params: ModelParamsSchema,
    meta: ModelMetaSchema,
    isPublic: z.boolean(),
    is_active: z.boolean(),
    updated_at: z.number(),
    created_at: z.number(),
    context_length: z.number().optional(),
});
export type ModelResponse = z.infer<typeof ModelResponseSchema>;

// Model status response (extends ModelResponse with wake status — only used by GET /api/v1/models)
export const ModelStatusResponseSchema = ModelResponseSchema.extend({
    status: z.enum(['idle', 'queued', 'active']),
});
export type ModelStatusResponse = z.infer<typeof ModelStatusResponseSchema>;

// Model access response (includes user info and write access flag)
export const ModelAccessResponseSchema = ModelResponseSchema.extend({
    user: UserResponseSchema.nullable(),
    write_access: z.boolean(),
});
export type ModelAccessResponse = z.infer<typeof ModelAccessResponseSchema>;

// Model access list response (paginated)
export const ModelAccessListResponseSchema = z.object({
    items: z.array(ModelAccessResponseSchema),
    total: z.number(),
});
export type ModelAccessListResponse = z.infer<typeof ModelAccessListResponseSchema>;

// Model form (for create/update)
export const ModelFormSchema = z.object({
    id: z.string().max(256),
    base_model_id: z.string().max(256),
    name: z.string().max(256),
    meta: ModelMetaSchema,
    params: ModelParamsSchema,
    isPublic: z.boolean().default(true),
    is_active: z.boolean().default(true),
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
    view_option: z.enum(['created', 'shared']).optional(),
    order_by: z.enum(['name', 'created_at', 'updated_at']).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
}).passthrough();
export type ModelListQuery = z.infer<typeof ModelListQuerySchema>;

// Query parameters for GET /api/v1/models/model and POST /api/v1/models/model/toggle
export const ModelIdQuerySchema = z.object({
    id: z.string(),
});
export type ModelIdQuery = z.infer<typeof ModelIdQuerySchema>;

/* -------------------- CHAT SCHEMAS -------------------- */

// Chat title/ID response (minimal chat info for list views)
export const ChatTitleIdResponseSchema = z.object({
    id: ChatIdSchema,
    title: z.string(),
    updated_at: z.number(),
    created_at: z.number(),
});
export type ChatTitleIdResponse = z.infer<typeof ChatTitleIdResponseSchema>;

// Folder chat list item response (minimal chat info for folder list views, excludes created_at)
export const FolderChatListItemResponseSchema = z.object({
    id: ChatIdSchema,
    title: z.string(),
    updated_at: z.number(),
});
export type FolderChatListItemResponse = z.infer<typeof FolderChatListItemResponseSchema>;

/* -------------------- CHAT DATA STRUCTURES -------------------- */

// Chat message file attachment
export const ChatMessageFileSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    url: z.string(),
    contentType: z.string(),
    size: z.number(),
    content: z.string().optional(),
}).passthrough();
export type ChatMessageFile = z.infer<typeof ChatMessageFileSchema>;

// Chat message citation/source
export const ChatMessageSourceSchema = z.object({
    source: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
}).passthrough();
export type ChatMessageSource = z.infer<typeof ChatMessageSourceSchema>;

// Chat message usage stats
export const ChatMessageUsageSchema = z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    completion_tokens_per_second: z.number().optional(),
    prompt_tokens_per_second: z.number().optional(),
}).passthrough();
export type ChatMessageUsage = z.infer<typeof ChatMessageUsageSchema>;

/* -------------------- MESSAGE BLOCKS -------------------- */

export const ReasoningBlockSchema = z.object({
    type: z.literal('reasoning'),
    content: z.string(),
    done: z.boolean(),
    duration: z.number().optional(),
});
export type ReasoningBlock = z.infer<typeof ReasoningBlockSchema>;

export const ToolCallBlockSchema = z.object({
    type: z.literal('tool_call'),
    id: z.string(),
    name: z.string(),
    arguments: z.string(),
    result: z.string().optional(),
    done: z.boolean(),
});
export type ToolCallBlock = z.infer<typeof ToolCallBlockSchema>;

export const ContentBlockSchema = z.object({
    type: z.literal('content'),
    content: z.string(),
    done: z.boolean(),
});
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const MessageBlockSchema = z.discriminatedUnion('type', [
    ReasoningBlockSchema,
    ToolCallBlockSchema,
    ContentBlockSchema,
]);
export type MessageBlock = z.infer<typeof MessageBlockSchema>;

// Individual chat message in history
export const ChatMessageSchema = z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    childrenIds: z.array(z.string()),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    files: z.array(ChatMessageFileSchema).default([]),
    timestamp: z.number(),

    // "Optional" fields:
    // these fields aren't optional, but short of splitting this type into a
    // union of UserMessage and AsstMessage, we're gonna do this for now
    // - role: assistant
    model: z.string().optional(),
    modelName: z.string().optional(),
    usage: ChatMessageUsageSchema.optional(),
    done: z.boolean().default(false),
    blocks: z.array(MessageBlockSchema).optional(),
    error: z.union([z.boolean(), z.object({ content: z.string() })]).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat history structure (tree-structured messages)
export const ChatHistorySchema = z.object({
    messages: z.record(z.string(), ChatMessageSchema),  // message_id -> message
    currentId: z.string().nullable().optional(),
}).passthrough();
export type ChatHistory = z.infer<typeof ChatHistorySchema>;

// Complete chat object (the nested "chat" field)
export interface ChatObject {
    // TODO: Seems unused by frontend
    id?: string;
    title: string;
    // not optional for the DB, but optional for 'updates'
    // TODO: we need to separate API schema from DB schema
    model: string;
    params?: ModelParams;
    webSearchEnabled?: boolean;
    systemPrompt?: string;
    history: ChatHistory;
    timestamp: number;
}

export const ChatObjectSchema: z.ZodType<ChatObject> = z.object({
    id: z.string().optional(),
    title: z.string(),
    model: z.string(),
    params: ModelParamsSchema.default({}),
    history: ChatHistorySchema,
    timestamp: z.number(),
    webSearchEnabled: z.boolean().optional(),
    systemPrompt: z.string().optional(),
}).passthrough();

// TODO - somehow there's a way to apply .partial to ChatObjectSchema, but
// it's pissing off the typechecker. For now this works.
export const ChatObjectUpdateSchema = z.object({
    id: z.string(),
    title: z.string(),
    model: z.string(),
    params: ModelParamsSchema,
    history: ChatHistorySchema,
    timestamp: z.number(),
    webSearchEnabled: z.boolean(),
    systemPrompt: z.string(),
}).partial();

// export const ChatUpdateSchema: z.ZodType<Partial<ChatObject>> = ChatObjectSchema.partial()

// Chat form (for updating chats)
export const ChatFormSchema = z.object({
    chat: ChatObjectUpdateSchema,
    folder_id: FolderIdSchema.nullable().optional(),
});
export type ChatForm = z.infer<typeof ChatFormSchema>;

// New Chat Form (for creating chats)
export const NewChatFormSchema = z.object({
    chat: ChatObjectSchema,
    folder_id: FolderIdSchema.nullable(),
});
export type NewChatForm = z.infer<typeof NewChatFormSchema>;

// Chat response (complete chat object with all fields)
export const ChatResponseSchema = z.object({
    id: ChatIdSchema,
    user_id: UserIdSchema,
    title: z.string(),
    chat: ChatObjectSchema,
    updated_at: z.number(),
    created_at: z.number(),
    share_id: z.string().nullable().optional(),
    meta: z.record(z.string(), z.any()).optional().default({}),
    folder_id: FolderIdSchema.nullable().optional(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// Chat import form (for bulk importing chats with preserved timestamps)
export const ChatImportFormSchema = z.object({
    chat: ChatObjectSchema,
    folder_id: FolderIdSchema.nullable().optional(),
    meta: z.record(z.string(), z.any()).optional().default({}),
    created_at: z.number().optional(),
    updated_at: z.number().optional(),
});
export type ChatImportForm = z.infer<typeof ChatImportFormSchema>;

// Clone form (for cloning chats)
export const CloneFormSchema = z.object({
    title: z.string().optional(),
});
export type CloneForm = z.infer<typeof CloneFormSchema>;

// Chat folder ID form (for moving chats to folders)
export const ChatFolderIdFormSchema = z.object({
    folder_id: FolderIdSchema.nullable().optional(),
});
export type ChatFolderIdForm = z.infer<typeof ChatFolderIdFormSchema>;

// Message form (for updating message content)
export const MessageFormSchema = z.object({
    content: z.string(),
});
export type MessageForm = z.infer<typeof MessageFormSchema>;

// Event form (for sending message events)
export const EventFormSchema = z.object({
    type: z.string(),
    data: z.record(z.string(), z.any()),
});
export type EventForm = z.infer<typeof EventFormSchema>;

// Query parameters for GET /api/v1/chats/ and /api/v1/chats/list
export const ChatListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    include_folders: z.stringbool().optional().default(false),
});
export type ChatListQuery = z.infer<typeof ChatListQuerySchema>;

// Query parameters for GET /api/v1/chats/list/user/:user_id
export const UserChatListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    query: z.string().optional(),
    order_by: z.string().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
});
export type UserChatListQuery = z.infer<typeof UserChatListQuerySchema>;

// Query parameters for GET /api/v1/chats/folder/:folder_id/list
export const FolderChatListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
});
export type FolderChatListQuery = z.infer<typeof FolderChatListQuerySchema>;

// Query parameters for GET /api/v1/chats/stats/usage
export const ChatUsageStatsQuerySchema = z.object({
    items_per_page: z.coerce.number().int().min(1).default(50),
    page: z.coerce.number().int().min(1).default(1),
});
export type ChatUsageStatsQuery = z.infer<typeof ChatUsageStatsQuerySchema>;

/* -------------------- OAI MESSAGE SCHEMAS -------------------- */

export const OAITextContentPartSchema = z.object({
    type: z.literal('text'),
    text: z.string(),
});
export type OAITextContentPart = z.infer<typeof OAITextContentPartSchema>;

export const OAIImageContentPartSchema = z.object({
    type: z.literal('image_url'),
    image_url: z.object({
        url: z.string(),
        detail: z.string().optional(),
    }),
});
export type OAIImageContentPart = z.infer<typeof OAIImageContentPartSchema>;

export const OAIContentPartSchema = z.discriminatedUnion('type', [
    OAITextContentPartSchema,
    OAIImageContentPartSchema,
]);
export type OAIContentPart = z.infer<typeof OAIContentPartSchema>;

export const OAISystemMessageSchema = z.object({
    role: z.union([z.literal('system'), z.literal('developer')]),
    content: z.string(),
});
export type OAISystemMessage = z.infer<typeof OAISystemMessageSchema>;

export const OAIUserMessageSchema = z.object({
    role: z.literal('user'),
    content: z.union([z.string(), z.array(OAIContentPartSchema)]),
});
export type OAIUserMessage = z.infer<typeof OAIUserMessageSchema>;

export const OAIAssistantToolCallSchema = z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
        name: z.string(),
        arguments: z.string(),
    }),
});
export type OAIAssistantToolCall = z.infer<typeof OAIAssistantToolCallSchema>;

export const OAIAssistantMessageSchema = z.object({
    role: z.literal('assistant'),
    content: z.string(),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(OAIAssistantToolCallSchema).optional(),
});
export type OAIAssistantMessage = z.infer<typeof OAIAssistantMessageSchema>;

export const OAIToolMessageSchema = z.object({
    role: z.literal('tool'),
    tool_call_id: z.string(),
    content: z.string(),
});
export type OAIToolMessage = z.infer<typeof OAIToolMessageSchema>;

export const OAIMessageSchema = z.union([
    OAISystemMessageSchema,
    OAIUserMessageSchema,
    OAIAssistantMessageSchema,
    OAIToolMessageSchema,
]);
export type OAIMessage = z.infer<typeof OAIMessageSchema>;

/* -------------------- COMPLETION FORM -------------------- */

// Chat completion form (OpenAI-compatible with OpenWebUI extensions)
export const ChatCompletionFormSchema = z.object({
    model: z.string(),
    messages: z.array(OAIMessageSchema),
    stream: z.boolean(),
    chatId: ChatIdSchema,
    userMessage: ChatMessageSchema,
    chat: ChatObjectSchema,
    folderId: FolderIdSchema.optional(),
    params: ModelParamsSchema,
    webSearchEnabled: z.boolean(),
    generateTitle: z.boolean(),
    systemPrompt: z.string(),
});
export type ChatCompletionForm = z.infer<typeof ChatCompletionFormSchema>;

/* -------------------- FOLDER SCHEMAS -------------------- */

/** File or collection reference in folder data */
export interface FolderFileItem {
    /** Type discriminator - 'file' for uploaded files, 'collection' for knowledge bases */
    type: 'file' | 'collection';
    /** File or collection UUID */
    id: string;
    /** Display name */
    name: string;
    /** Collection identifier (for files that belong to collections) */
    collection_name?: string;
    /** Resource URL */
    url?: string;
    /** Upload status (present during upload operations) */
    status?: 'uploading' | 'uploaded';
    /** File size in bytes */
    size?: number;
    /** Context mode - 'full' indicates full document context */
    context?: 'full';
    /** Error message if upload/validation failed */
    error?: string;
    /** Temporary ID during upload process */
    itemId?: string;
}

export const FolderFileItemSchema: z.ZodType<FolderFileItem> = z.object({
    type: z.enum(['file', 'collection']),
    id: z.string(),
    name: z.string(),
    collection_name: z.string().optional(),
    url: z.string().optional(),
    status: z.enum(['uploading', 'uploaded']).optional(),
    size: z.number().optional(),
    context: z.literal('full').optional(),
    error: z.string().optional(),
    itemId: z.string().optional(),
});

/** Folder data structure containing functionality settings */
export interface FolderData {
    /** System prompt applied to all chats in this folder */
    systemPrompt?: string;
    /** Files and knowledge collections attached to this folder */
    files?: FolderFileItem[];
    /** Selected model ID for this folder */
    model_id?: string;
}

export const FolderDataSchema: z.ZodType<FolderData> = z.object({
    systemPrompt: z.string().optional(),
    files: z.array(FolderFileItemSchema).optional(),
    model_id: z.string().optional(),
});

/** Folder metadata for UI presentation */
export interface FolderMeta {
    /** Emoji short code for folder icon (e.g., ":folder:", ":star:") */
    icon?: string | null;
}

export const FolderMetaSchema: z.ZodType<FolderMeta> = z.object({
    icon: z.string().nullable().optional(),
}).passthrough();

// Folder metadata response (icon, etc.)
export const FolderMetadataResponseSchema = z.object({
    icon: z.string().nullable().optional(),
});
export type FolderMetadataResponse = z.infer<typeof FolderMetadataResponseSchema>;

// Folder name/ID response (lightweight response for list views)
export const FolderNameIdResponseSchema = z.object({
    id: FolderIdSchema,
    name: z.string(),
    meta: FolderMetadataResponseSchema.nullable().optional(),
    parent_id: FolderIdSchema.nullable().optional(),
    is_expanded: z.boolean().default(false),
    created_at: z.number(),
    updated_at: z.number(),
});
export type FolderNameIdResponse = z.infer<typeof FolderNameIdResponseSchema>;

// Full folder model (complete folder representation)
export const FolderModelSchema = z.object({
    id: FolderIdSchema,
    parent_id: FolderIdSchema.nullable().optional(),
    user_id: UserIdSchema,
    name: z.string(),
    meta: FolderMetaSchema.nullable().optional(),
    data: FolderDataSchema.nullable().optional(),
    is_expanded: z.boolean().default(false),
    created_at: z.number(),
    updated_at: z.number(),
});
export type FolderModel = z.infer<typeof FolderModelSchema>;

// Folder form (for creating folders)
export const FolderFormSchema = z.object({
    name: z.string(),
    data: FolderDataSchema.nullable().optional(),
    meta: FolderMetaSchema.nullable().optional(),
}).passthrough();  // Allow additional properties
export type FolderForm = z.infer<typeof FolderFormSchema>;

// Folder update form (for updating folder properties)
export const FolderUpdateFormSchema = z.object({
    name: z.string().nullable().optional(),
    data: FolderDataSchema.nullable().optional(),
    meta: FolderMetaSchema.nullable().optional(),
}).passthrough();  // Allow additional properties
export type FolderUpdateForm = z.infer<typeof FolderUpdateFormSchema>;

// Folder parent ID form (for moving folders)
export const FolderParentIdFormSchema = z.object({
    parent_id: FolderIdSchema.nullable().optional(),
});
export type FolderParentIdForm = z.infer<typeof FolderParentIdFormSchema>;

// Folder is_expanded form (for updating UI expansion state)
export const FolderIsExpandedFormSchema = z.object({
    is_expanded: z.boolean(),
});
export type FolderIsExpandedForm = z.infer<typeof FolderIsExpandedFormSchema>;

// Query parameters for DELETE /api/v1/folders/:id
export const FolderDeleteQuerySchema = z.object({
    delete_contents: z.stringbool().default(true),
});
export type FolderDeleteQuery = z.infer<typeof FolderDeleteQuerySchema>;

/* -------------------- FILE SCHEMAS -------------------- */

// File metadata structure
export const FileMetaSchema = z.object({
    name: z.string(),
    contentType: z.string(),
    size: z.number(),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

// File data structure (processing status and content)
export const FileDataSchema = z.object({
    content: z.string().optional(),
});
export type FileData = z.infer<typeof FileDataSchema>;

// File model response (excludes internal path, hash, and access_control fields)
export const FileModelResponseSchema = z.object({
    id: FileIdSchema,
    user_id: UserIdSchema,
    filename: z.string(),
    data: FileDataSchema.nullable(),
    meta: FileMetaSchema,
    created_at: z.number(),
    updated_at: z.number(),
});
export type FileModelResponse = z.infer<typeof FileModelResponseSchema>;

// Query parameters for GET /api/v1/files/{id}/content
export const FileContentQuerySchema = z.object({
    attachment: z.stringbool().default(false),
});
export type FileContentQuery = z.infer<typeof FileContentQuerySchema>;


/* -------------------- VERSION SCHEMAS -------------------- */

// Version information response
export const VersionInfoSchema = z.object({
    version: z.string(),
    deployment_id: z.string(),
});
export type VersionInfo = z.infer<typeof VersionInfoSchema>;

// Version update information response
export const VersionUpdateInfoSchema = z.object({
    current: z.string(),
    latest: z.string(),
});
export type VersionUpdateInfo = z.infer<typeof VersionUpdateInfoSchema>;