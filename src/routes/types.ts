/**
 * Shared type definitions and Zod schemas for API routes.
 *
 * All routes import from this file to avoid duplication.
 */

import { z } from 'zod';
import { type Request } from 'express';

/* -------------------- HELPER TYPES -------------------- */

// User ID schema (UUID v4 format)
export const UserIdSchema = z.uuidv4();
export type UserId = z.infer<typeof UserIdSchema>;

// Generic type for Express requests with typed params, body, and/or query
// Usage:
//   TypedRequest<{ user_id: string }>                    - only path params
//   TypedRequest<{}, SomeBodyType>                       - only body
//   TypedRequest<{ user_id: string }, SomeBody>          - params and body
//   TypedRequest<{}, any, SomeQueryType>                 - only query params
//   TypedRequest<{ user_id: string }, any, SomeQuery>    - params and query
export type TypedRequest<P = {}, B = any, Q = any> = Request<P, any, B, Q>;

// Common path parameter types
export type ChatIdParams = { chat_id: string };
export type FolderIdParams = { folder_id: string };
export type FileIdParams = { file_id: string };

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

// User ID path parameter schema
export const UserIdParamsSchema = z.object({
    user_id: UserIdSchema,
});
export type UserIdParams = z.infer<typeof UserIdParamsSchema>;

/* -------------------- AUTH SCHEMAS -------------------- */

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
    profile_image_url: z.string().default('/user.png'),
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
    role: z.string(),
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
    role: z.string(),
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
    profile_image_url: z.string().default('/user.png'),
    role: z.enum(['pending', 'user', 'admin']).default('pending'),
});
export type AddUserForm = z.infer<typeof AddUserFormSchema>;

export const SigninResponseSchema = z.object({
    id: UserIdSchema,
    name: z.string(),
    role: z.string(),
    email: z.email(),
    profile_image_url: z.string(),
    token: z.string(),
    token_type: z.string(),
});
export type SigninResponse = z.infer<typeof SigninResponseSchema>;

// Admin config
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
    JWT_EXPIRES_IN: z.string().regex(/^(-1|0|(-?\d+(\.\d+)?)(ms|s|m|h|d|w))$/),
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
    role: z.string().default('pending'),
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
    role: z.string(),
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
    role: z.string(),
    name: z.string(),
    email: z.email(),
    profile_image_url: z.string(),
    password: z.string().optional(),
});
export type UserUpdateForm = z.infer<typeof UserUpdateFormSchema>;

// User list/search query parameters
export const UserListQuerySchema = z.object({
    query: z.string().optional(),
    order_by: z.string().optional(),
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
}).nullable();
export type AccessControl = z.infer<typeof AccessControlSchema>;

// Model parameters (flexible JSON object)
export const ModelParamsSchema = z.record(z.string(), z.any());
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
    role: z.string(),
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
    refresh: z.coerce.boolean().optional().default(false),
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
