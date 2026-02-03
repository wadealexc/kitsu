/**
 * Shared type definitions and Zod schemas for API routes.
 *
 * All routes import from this file to avoid duplication.
 */

import { z } from 'zod';
import { type Request } from 'express';
import parse, { type StringValue } from 'ms';
import { DEFAULT_USER_IMAGE, DEFAULT_USER_ROLE } from '../db/schema.js';

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
    z.string().regex(/^local:[a-zA-Z0-9_-]+$/),  // Temporary chat: local:<socket_id>
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
export type NamedFileParams = { file_id: FileId; file_name: string };

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

// Admin details response
export const AdminDetailsResponseSchema = z.object({
    name: z.string(),
    email: z.email(),
});
export type AdminDetailsResponse = z.infer<typeof AdminDetailsResponseSchema>;

/* -------------------- AUTH SCHEMAS -------------------- */

// User role enum
export const UserRoleSchema = z.enum(['admin', 'user', 'pending']);
export type UserRole = z.infer<typeof UserRoleSchema>;

// Signin
export const SigninFormSchema = z.object({
    email: z.email(),
    password: z.string(),
});
export type SigninForm = z.infer<typeof SigninFormSchema>;

// Signup
export const SignupFormSchema = z.object({
    name: z.string(),
    email: z.email(),
    password: z.string(),
    profile_image_url: z.string().default(DEFAULT_USER_IMAGE),
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
    name: z.string(),
    role: UserRoleSchema,
    email: z.email(),
    profile_image_url: z.string(),
    token: z.string(),
    token_type: z.string(),
    expires_at: z.number().nullable().optional(),
    permissions: z.record(z.string(), z.any()).nullable().optional(),
});
export type SessionUserResponse = z.infer<typeof SessionUserResponseSchema>;

export const SessionUserInfoResponseSchema = SessionUserResponseSchema.extend({
    bio: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(), // ISO date string
    status_emoji: z.string().nullable().optional(),
    status_message: z.string().nullable().optional(),
    status_expires_at: z.number().nullable().optional(),
});
export type SessionUserInfoResponse = z.infer<typeof SessionUserInfoResponseSchema>;

// Profile update
export const UpdateProfileFormSchema = z.object({
    profile_image_url: z.string(),
    name: z.string(),
    bio: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    date_of_birth: z.string().nullable().optional(), // ISO date string
});
export type UpdateProfileForm = z.infer<typeof UpdateProfileFormSchema>;

export const UserProfileImageResponseSchema = z.object({
    id: UserIdSchema,
    name: z.string(),
    role: UserRoleSchema,
    email: z.email(),
    profile_image_url: z.string(),
});
export type UserProfileImageResponse = z.infer<typeof UserProfileImageResponseSchema>;

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

// Admin add user
export const AddUserFormSchema = z.object({
    name: z.string(),
    email: z.email(),
    password: z.string(),
    profile_image_url: z.string().default(DEFAULT_USER_IMAGE),
    role: UserRoleSchema.default(DEFAULT_USER_ROLE),
});
export type AddUserForm = z.infer<typeof AddUserFormSchema>;

export const SigninResponseSchema = z.object({
    id: UserIdSchema,
    name: z.string(),
    role: UserRoleSchema,
    email: z.email(),
    profile_image_url: z.string(),
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
    SHOW_ADMIN_DETAILS: z.boolean(),
    ADMIN_EMAIL: z.string().nullable().optional(),
    WEBUI_URL: z.string(),
    ENABLE_SIGNUP: z.boolean(),
    ENABLE_API_KEYS: z.boolean(),
    ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: z.boolean(),
    API_KEYS_ALLOWED_ENDPOINTS: z.string(),
    DEFAULT_USER_ROLE: z.enum(['pending', 'user', 'admin']),
    DEFAULT_GROUP_ID: z.string(),
    JWT_EXPIRES_IN: MsStringValueSchema,
    ENABLE_COMMUNITY_SHARING: z.boolean(),
    ENABLE_MESSAGE_RATING: z.boolean(),
    ENABLE_FOLDERS: z.boolean(),
    FOLDER_MAX_FILE_COUNT: z.number().int().nullable().optional(),
    ENABLE_CHANNELS: z.boolean(),
    ENABLE_MEMORIES: z.boolean(),
    ENABLE_NOTES: z.boolean(),
    ENABLE_USER_WEBHOOKS: z.boolean(),
    ENABLE_USER_STATUS: z.boolean(),
    PENDING_USER_OVERLAY_TITLE: z.string().nullable().optional(),
    PENDING_USER_OVERLAY_CONTENT: z.string().nullable().optional(),
    RESPONSE_WATERMARK: z.string().nullable().optional(),
});
export type AdminConfig = z.infer<typeof AdminConfigSchema>;

/* -------------------- CONFIG SCHEMAS -------------------- */

// Import config form (for POST /api/v1/configs/import)
export const ImportConfigFormSchema = z.object({
    config: z.record(z.string(), z.any()),  // Generic object with string keys and any values
});
export type ImportConfigForm = z.infer<typeof ImportConfigFormSchema>;

// Banner model
export const BannerModelSchema = z.object({
    id: z.string(),
    type: z.string(),
    title: z.string().optional(),
    content: z.string(),
    dismissible: z.boolean(),
    timestamp: z.number(),
});
export type BannerModel = z.infer<typeof BannerModelSchema>;

// Set banners form (for POST /api/v1/configs/banners)
export const SetBannersFormSchema = z.object({
    banners: z.array(BannerModelSchema),
});
export type SetBannersForm = z.infer<typeof SetBannersFormSchema>;

/* -------------------- USER SCHEMAS -------------------- */

// User settings (UI preferences)
// TODO: See /docs/extra.md for full UserSettings specification with source locations
export const UserSettingsSchema = z.object({
    ui: z.record(z.string(), z.any()).optional().default({}),
}).passthrough();  // Allow additional properties
export type UserSettings = z.infer<typeof UserSettingsSchema>;

// Permission schemas
export const WorkspacePermissionsSchema = z.object({
    models: z.boolean().default(false),
    knowledge: z.boolean().default(false),
    prompts: z.boolean().default(false),
    tools: z.boolean().default(false),
    models_import: z.boolean().default(false),
    models_export: z.boolean().default(false),
    prompts_import: z.boolean().default(false),
    prompts_export: z.boolean().default(false),
    tools_import: z.boolean().default(false),
    tools_export: z.boolean().default(false),
});
export type WorkspacePermissions = z.infer<typeof WorkspacePermissionsSchema>;

export const SharingPermissionsSchema = z.object({
    models: z.boolean().default(false),
    public_models: z.boolean().default(false),
    knowledge: z.boolean().default(false),
    public_knowledge: z.boolean().default(false),
    prompts: z.boolean().default(false),
    public_prompts: z.boolean().default(false),
    tools: z.boolean().default(false),
    public_tools: z.boolean().default(true),
    notes: z.boolean().default(false),
    public_notes: z.boolean().default(true),
});
export type SharingPermissions = z.infer<typeof SharingPermissionsSchema>;

export const ChatPermissionsSchema = z.object({
    controls: z.boolean().default(true),
    valves: z.boolean().default(true),
    system_prompt: z.boolean().default(true),
    params: z.boolean().default(true),
    file_upload: z.boolean().default(true),
    delete: z.boolean().default(true),
    delete_message: z.boolean().default(true),
    continue_response: z.boolean().default(true),
    regenerate_response: z.boolean().default(true),
    rate_response: z.boolean().default(true),
    edit: z.boolean().default(true),
    share: z.boolean().default(true),
    export: z.boolean().default(true),
    stt: z.boolean().default(true),
    tts: z.boolean().default(true),
    call: z.boolean().default(true),
    multiple_models: z.boolean().default(true),
    temporary: z.boolean().default(true),
    temporary_enforced: z.boolean().default(false),
});
export type ChatPermissions = z.infer<typeof ChatPermissionsSchema>;

export const FeaturesPermissionsSchema = z.object({
    api_keys: z.boolean().default(false),
    notes: z.boolean().default(true),
    channels: z.boolean().default(true),
    folders: z.boolean().default(true),
    direct_tool_servers: z.boolean().default(false),
    web_search: z.boolean().default(true),
    image_generation: z.boolean().default(true),
    code_interpreter: z.boolean().default(true),
    memories: z.boolean().default(true),
});
export type FeaturesPermissions = z.infer<typeof FeaturesPermissionsSchema>;

export const SettingsPermissionsSchema = z.object({
    interface: z.boolean().default(true),
});
export type SettingsPermissions = z.infer<typeof SettingsPermissionsSchema>;

export const UserPermissionsSchema = z.object({
    workspace: WorkspacePermissionsSchema,
    sharing: SharingPermissionsSchema,
    chat: ChatPermissionsSchema,
    features: FeaturesPermissionsSchema,
    settings: SettingsPermissionsSchema,
});
export type UserPermissions = z.infer<typeof UserPermissionsSchema>;

// User model (complete user object)
export const UserModelSchema = z.object({
    id: UserIdSchema,
    email: z.email(),
    username: z.string().optional(),
    role: UserRoleSchema.default(DEFAULT_USER_ROLE),
    name: z.string(),
    profile_image_url: z.string(),
    profile_banner_image_url: z.string().optional(),
    bio: z.string().optional(),
    gender: z.string().optional(),
    date_of_birth: z.string().optional(),
    timezone: z.string().optional(),
    presence_state: z.string().optional(),
    status_emoji: z.string().optional(),
    status_message: z.string().optional(),
    status_expires_at: z.number().optional(),
    info: z.record(z.string(), z.any()).optional(),
    settings: UserSettingsSchema.optional(),
    oauth: z.record(z.string(), z.any()).optional(),
    last_active_at: z.number(),
    updated_at: z.number(),
    created_at: z.number(),
});
export type UserModel = z.infer<typeof UserModelSchema>;

// User info response (basic subset)
export const UserInfoResponseSchema = z.object({
    id: UserIdSchema,
    name: z.string(),
    email: z.email(),
    role: UserRoleSchema,
    status_emoji: z.string().optional(),
    status_message: z.string().optional(),
    status_expires_at: z.number().optional(),
});
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;

// User info list response (for search/list endpoints)
export const UserInfoListResponseSchema = z.object({
    users: z.array(UserInfoResponseSchema),
    total: z.number(),
});
export type UserInfoListResponse = z.infer<typeof UserInfoListResponseSchema>;

// User with group IDs
export const UserGroupIdsModelSchema = UserModelSchema.extend({
    group_ids: z.array(z.string()).default([]),
});
export type UserGroupIdsModel = z.infer<typeof UserGroupIdsModelSchema>;

// User group IDs list response
export const UserGroupIdsListResponseSchema = z.object({
    users: z.array(UserGroupIdsModelSchema),
    total: z.number(),
});
export type UserGroupIdsListResponse = z.infer<typeof UserGroupIdsListResponseSchema>;

// User active response
export const UserActiveResponseSchema = z.object({
    name: z.string(),
    profile_image_url: z.string().optional(),
    groups: z.array(z.record(z.string(), z.any())).optional().default([]),
    is_active: z.boolean(),
    status_emoji: z.string().optional(),
    status_message: z.string().optional(),
    status_expires_at: z.number().optional(),
}).passthrough();  // Allow additional properties
export type UserActiveResponse = z.infer<typeof UserActiveResponseSchema>;

// User update form (admin operation)
export const UserUpdateFormSchema = z.object({
    role: UserRoleSchema,
    name: z.string(),
    email: z.email(),
    profile_image_url: z.string(),
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
        group_ids: z.array(z.string()).optional(),
        user_ids: z.array(UserIdSchema).optional(),
    }).optional(),
    write: z.object({
        group_ids: z.array(z.string()).optional(),
        user_ids: z.array(UserIdSchema).optional(),
    }).optional(),
}).passthrough().nullable();
export type AccessControl = z.infer<typeof AccessControlSchema>;

// Model parameters
export const ModelParamsSchema = z.object({
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().optional(),
    max_tokens: z.number().optional(),
    seed: z.number().optional(),
}).passthrough();  // Allow additional model-specific params
export type ModelParams = z.infer<typeof ModelParamsSchema>;

// Model metadata
export const ModelMetaSchema = z.object({
    profile_image_url: z.string().nullable().optional().default('/static/favicon.png'),
    description: z.string().nullable().optional(),
    capabilities: z.record(z.string(), z.any()).nullable().optional(),
    tags: z.array(z.string()).optional(),
}).passthrough();  // Allow additional properties
export type ModelMeta = z.infer<typeof ModelMetaSchema>;

// User response (for model owner info)
export const UserResponseSchema = z.object({
    id: UserIdSchema,
    name: z.string(),
    email: z.email(),
    role: UserRoleSchema,
    profile_image_url: z.string(),
});
export type UserResponse = z.infer<typeof UserResponseSchema>;

// Model response (standard database representation)
export const ModelResponseSchema = z.object({
    id: z.string().max(256),
    user_id: UserIdSchema,
    base_model_id: z.string().nullable(),
    name: z.string(),
    params: ModelParamsSchema,
    meta: ModelMetaSchema,
    access_control: AccessControlSchema,
    is_active: z.boolean(),
    updated_at: z.number(),
    created_at: z.number(),
});
export type ModelResponse = z.infer<typeof ModelResponseSchema>;

// Model model (alias for ModelResponse - database representation)
export const ModelModelSchema = ModelResponseSchema;
export type ModelModel = z.infer<typeof ModelModelSchema>;

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
    base_model_id: z.string().nullable().optional(),
    name: z.string(),
    meta: ModelMetaSchema,
    params: ModelParamsSchema,
    access_control: AccessControlSchema.optional(),
    is_active: z.boolean().optional().default(true),
});
export type ModelForm = z.infer<typeof ModelFormSchema>;

// Model ID form (for delete/single-ID operations)
export const ModelIdFormSchema = z.object({
    id: z.string(),
});
export type ModelIdForm = z.infer<typeof ModelIdFormSchema>;

// Models import form
export const ModelsImportFormSchema = z.object({
    models: z.array(z.record(z.string(), z.any())),
});
export type ModelsImportForm = z.infer<typeof ModelsImportFormSchema>;

// Sync models form
export const SyncModelsFormSchema = z.object({
    models: z.array(ModelModelSchema).default([]),
});
export type SyncModelsForm = z.infer<typeof SyncModelsFormSchema>;

// Query parameters for GET /api/v1/models
export const ModelsQuerySchema = z.object({
    refresh: z.stringbool().optional().default(false),
});
export type ModelsQuery = z.infer<typeof ModelsQuerySchema>;

// Query parameters for GET /api/v1/models/list
export const ModelListQuerySchema = z.object({
    query: z.string().optional(),
    view_option: z.string().optional(),
    tag: z.string().optional(),
    order_by: z.string().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
});
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
    type: z.string().optional(),
    name: z.string().optional(),
    url: z.string().optional(),
}).passthrough();
export type ChatMessageFile = z.infer<typeof ChatMessageFileSchema>;

// Chat message citation/source
export const ChatMessageSourceSchema = z.object({
    source: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
}).passthrough();
export type ChatMessageSource = z.infer<typeof ChatMessageSourceSchema>;

// Chat message status history entry
export const ChatMessageStatusSchema = z.object({
    timestamp: z.number(),
    status: z.string(),
}).passthrough();
export type ChatMessageStatus = z.infer<typeof ChatMessageStatusSchema>;

// Chat message usage stats
export const ChatMessageUsageSchema = z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
}).passthrough();
export type ChatMessageUsage = z.infer<typeof ChatMessageUsageSchema>;

// Individual chat message in history
export const ChatMessageSchema = z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    parentId: z.string().nullable(),
    childrenIds: z.array(z.string()).optional().default([]),
    timestamp: z.number(),
    model: z.string().nullable().optional(),
    files: z.array(ChatMessageFileSchema).optional(),
    favorite: z.boolean().optional(),
    citation: ChatMessageSourceSchema.optional(),
    sources: z.array(ChatMessageSourceSchema).optional(),
    statusHistory: z.array(ChatMessageStatusSchema).optional(),
    usage: ChatMessageUsageSchema.optional(),
    done: z.boolean().optional(),
}).passthrough();  // Allow additional fields for extensibility
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat history structure (tree-structured messages)
export const ChatHistorySchema = z.object({
    messages: z.record(z.string(), ChatMessageSchema),  // message_id -> message
    currentId: z.string().nullable().optional(),
}).passthrough();
export type ChatHistory = z.infer<typeof ChatHistorySchema>;

// Flattened message (in messages array)
export const FlattenedMessageSchema = z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.number().optional(),
    model: z.string().optional(),
}).passthrough();
export type FlattenedMessage = z.infer<typeof FlattenedMessageSchema>;

// Complete chat object (the nested "chat" field)
export interface ChatObject {
    id?: string;
    title: string;
    models: string[];
    system?: string | null;
    params?: ModelParams;
    history?: ChatHistory;
    messages: FlattenedMessage[];
    timestamp?: number;
    [key: string]: any;
}

export const ChatObjectSchema: z.ZodType<ChatObject> = z.object({
    id: z.string().optional(),
    title: z.string().default(DEFAULT_CHAT_TITLE),
    models: z.array(z.string()).optional().default([]),
    system: z.string().nullable().optional(),
    params: ModelParamsSchema.optional(),
    history: ChatHistorySchema.optional(),
    messages: z.array(FlattenedMessageSchema).optional().default([]),
    timestamp: z.number().optional(),
}).passthrough();

// Chat form (for creating/updating chats)
export const ChatFormSchema = z.object({
    chat: ChatObjectSchema,
    folder_id: FolderIdSchema.nullable().optional(),
});
export type ChatForm = z.infer<typeof ChatFormSchema>;

// Chat response (complete chat object with all fields)
export const ChatResponseSchema = z.object({
    id: ChatIdSchema,
    user_id: UserIdSchema,
    title: z.string(),
    chat: ChatObjectSchema,
    updated_at: z.number(),
    created_at: z.number(),
    share_id: z.string().nullable().optional(),
    archived: z.boolean(),
    pinned: z.boolean().optional().default(false),
    meta: z.record(z.string(), z.any()).optional().default({}),
    folder_id: FolderIdSchema.nullable().optional(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// Chat import form (for bulk importing chats with preserved timestamps)
export const ChatImportFormSchema = z.object({
    chat: ChatObjectSchema,
    folder_id: FolderIdSchema.nullable().optional(),
    meta: z.record(z.string(), z.any()).optional().default({}),
    pinned: z.boolean().optional().default(false),
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

// Chat usage stats response
export const ChatUsageStatsResponseSchema = z.object({
    id: ChatIdSchema,
    models: z.record(z.string(), z.any()).optional().default({}),
    message_count: z.number(),
    history_models: z.record(z.string(), z.any()).optional().default({}),
    history_message_count: z.number(),
    history_user_message_count: z.number(),
    history_assistant_message_count: z.number(),
    average_response_time: z.number(),
    average_user_message_content_length: z.number(),
    average_assistant_message_content_length: z.number(),
    last_message_at: z.number(),
    updated_at: z.number(),
    created_at: z.number(),
}).passthrough();  // Allow additional computed statistics
export type ChatUsageStatsResponse = z.infer<typeof ChatUsageStatsResponseSchema>;

// Chat usage stats list response (paginated)
export const ChatUsageStatsListResponseSchema = z.object({
    items: z.array(ChatUsageStatsResponseSchema),
    total: z.number(),
}).passthrough();  // Allow additional pagination metadata
export type ChatUsageStatsListResponse = z.infer<typeof ChatUsageStatsListResponseSchema>;

// Query parameters for GET /api/v1/chats/ and /api/v1/chats/list
export const ChatListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    include_pinned: z.stringbool().optional().default(false),
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

// Chat completion form (OpenAI-compatible with OpenWebUI extensions)
export const ChatCompletionFormSchema = z.object({
    // Required fields
    model: z.string(),
    messages: z.array(z.any()),  // OpenAI message format - flexible structure

    // OpenAI standard fields
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().int().optional(),
    stop: z.union([z.string(), z.array(z.string())]).optional(),
    presence_penalty: z.number().optional(),
    frequency_penalty: z.number().optional(),
    logit_bias: z.record(z.string(), z.number()).optional(),
    user: z.string().optional(),

    // OpenWebUI extensions
    chat_id: ChatIdSchema.optional(),
    id: MessageIdSchema.optional(),
    parent_id: MessageIdSchema.optional(),
    parent_message: z.record(z.string(), z.any()).optional(),
    session_id: z.string().optional(),
    tool_ids: z.array(z.string()).optional(),
    tool_servers: z.array(z.any()).optional(),
    files: z.array(z.any()).optional(),
    filter_ids: z.array(z.string()).optional(),
    features: z.record(z.string(), z.any()).optional(),
    variables: z.record(z.string(), z.any()).optional(),
    model_item: z.object({
        // direct: z.boolean().optional(),
    }).passthrough().optional(),
    background_tasks: z.any().optional(),
    params: z.object({
        stream_delta_chunk_size: z.number().optional(),
        reasoning_tags: z.any().optional(),
        function_calling: z.enum(['native', 'default']).optional(),
    }).optional(),
}).passthrough();  // Allow additional OpenAI extensions
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
    system_prompt?: string;
    /** Files and knowledge collections attached to this folder */
    files?: FolderFileItem[];
    /** Selected model IDs for this folder */
    model_ids?: string[];
}

export const FolderDataSchema: z.ZodType<FolderData> = z.object({
    system_prompt: z.string().optional(),
    files: z.array(FolderFileItemSchema).optional(),
    model_ids: z.array(z.string()).optional(),
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
    name: z.string().optional(),
    content_type: z.string().optional(),
    size: z.number().optional(),
    data: z.record(z.string(), z.any()).optional(),
});
export type FileMeta = z.infer<typeof FileMetaSchema>;

// File data structure (processing status and content)
export const FileDataSchema = z.object({
    status: z.enum(['pending', 'completed', 'failed']).optional(),
    error: z.string().optional(),
    content: z.string().optional(),
}).passthrough();  // Allow additional properties
export type FileData = z.infer<typeof FileDataSchema>;

// Full file model (includes internal path field)
export const FileModelSchema = z.object({
    id: FileIdSchema,
    user_id: UserIdSchema,
    hash: z.string().nullable(),
    filename: z.string(),
    path: z.string().nullable(),
    data: FileDataSchema.nullable(),
    meta: FileMetaSchema.nullable(),
    access_control: AccessControlSchema,
    created_at: z.number().nullable(),
    updated_at: z.number().nullable(),
});
export type FileModel = z.infer<typeof FileModelSchema>;

// File model response (excludes internal path field)
export const FileModelResponseSchema = z.object({
    id: FileIdSchema,
    user_id: UserIdSchema,
    hash: z.string().nullable(),
    filename: z.string(),
    data: FileDataSchema.nullable(),
    meta: FileMetaSchema,
    created_at: z.number(),
    updated_at: z.number(),
});
export type FileModelResponse = z.infer<typeof FileModelResponseSchema>;

// Upload file form (multipart form-data)
// Note: Actual file upload validation happens at Express middleware level (e.g., multer)
export const UploadFileFormSchema = z.object({
    file: z.any(),
    metadata: z.union([
        z.string(),
        z.record(z.string(), z.any()),
    ]).nullable().optional(),
});
export type UploadFileForm = z.infer<typeof UploadFileFormSchema>;

// Query parameters for POST /api/v1/files/
export const UploadFileQuerySchema = z.object({
    process: z.stringbool().optional().default(true),
    process_in_background: z.stringbool().optional().default(true),
});
export type UploadFileQuery = z.infer<typeof UploadFileQuerySchema>;

// Content form (for updating file content)
export const ContentFormSchema = z.object({
    content: z.string(),
});
export type ContentForm = z.infer<typeof ContentFormSchema>;

// Query parameters for GET /api/v1/files/
export const FileListQuerySchema = z.object({
    content: z.stringbool().optional(),
});
export type FileListQuery = z.infer<typeof FileListQuerySchema>;

// Query parameters for GET /api/v1/files/search
export const FileSearchQuerySchema = z.object({
    filename: z.string(),
    content: z.stringbool().optional().default(true),
    skip: z.coerce.number().int().min(0).optional().default(0),
    limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
});
export type FileSearchQuery = z.infer<typeof FileSearchQuerySchema>;

// Query parameters for GET /api/v1/files/{id}/content
export const FileContentQuerySchema = z.object({
    attachment: z.stringbool().default(false),
});
export type FileContentQuery = z.infer<typeof FileContentQuerySchema>;

// Query parameters for GET /api/v1/files/{id}/process/status
export const FileProcessStatusQuerySchema = z.object({
    stream: z.stringbool().default(false),
});
export type FileProcessStatusQuery = z.infer<typeof FileProcessStatusQuerySchema>;

// Response for /api/v1/files/all DELETE and file delete operations
export const FileDeleteResponseSchema = z.object({
    message: z.string(),
});
export type FileDeleteResponse = z.infer<typeof FileDeleteResponseSchema>;

// Response for /api/v1/files/{id}/data/content GET
export const FileDataContentResponseSchema = z.object({
    content: z.string(),
});
export type FileDataContentResponse = z.infer<typeof FileDataContentResponseSchema>;

// Response for /api/v1/files/{id}/process/status GET (non-streaming)
export const FileProcessStatusResponseSchema = z.object({
    status: z.string(),
});
export type FileProcessStatusResponse = z.infer<typeof FileProcessStatusResponseSchema>;

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

/* -------------------- PWA SCHEMAS -------------------- */

// PWA icon configuration
export const PWAIconSchema = z.object({
    src: z.string(),
    type: z.string(),
    sizes: z.string(),
    purpose: z.string(),
});
export type PWAIcon = z.infer<typeof PWAIconSchema>;

// PWA share target configuration
export const PWAShareTargetSchema = z.object({
    action: z.string(),
    method: z.enum(['GET', 'POST']),
    params: z.object({
        text: z.string().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
    }),
});
export type PWAShareTarget = z.infer<typeof PWAShareTargetSchema>;

// PWA manifest
export const PWAManifestSchema = z.object({
    name: z.string(),
    short_name: z.string(),
    description: z.string(),
    start_url: z.string(),
    display: z.enum(['standalone', 'fullscreen', 'minimal-ui', 'browser']),
    background_color: z.string(),
    icons: z.array(PWAIconSchema),
    share_target: PWAShareTargetSchema.optional(),
});
export type PWAManifest = z.infer<typeof PWAManifestSchema>;
