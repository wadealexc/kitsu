/**
 * Centralized mock data for all API routes.
 *
 * This file contains all mock database state used across routes during development.
 */

import * as Types from './types.js';

/* -------------------- CONSTANTS -------------------- */

// User IDs (reused across routes)
export const MOCK_ADMIN_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
export const MOCK_REGULAR_USER_ID = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
export const MOCK_PENDING_USER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

// Auth token
export const MOCK_JWT_TOKEN = 'mock-jwt-token-def456';

/* -------------------- AUTH DATA -------------------- */

export const mockToken = MOCK_JWT_TOKEN;
export const mockUserId = MOCK_ADMIN_USER_ID;

export const mockAdminConfig: Types.AdminConfig = {
    SHOW_ADMIN_DETAILS: true,
    ADMIN_EMAIL: null,
    WEBUI_URL: 'http://192.168.87.30:3000',
    ENABLE_SIGNUP: true,
    ENABLE_API_KEYS: false,
    ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
    API_KEYS_ALLOWED_ENDPOINTS: '',
    DEFAULT_USER_ROLE: 'user',
    DEFAULT_GROUP_ID: '',
    JWT_EXPIRES_IN: '7d',
    ENABLE_COMMUNITY_SHARING: false,
    ENABLE_MESSAGE_RATING: true,
    ENABLE_FOLDERS: true,
    FOLDER_MAX_FILE_COUNT: null,
    ENABLE_CHANNELS: false,
    ENABLE_MEMORIES: false,
    ENABLE_NOTES: false,
    ENABLE_USER_WEBHOOKS: false,
    ENABLE_USER_STATUS: true,
    PENDING_USER_OVERLAY_TITLE: null,
    PENDING_USER_OVERLAY_CONTENT: null,
    RESPONSE_WATERMARK: null,
};

/* -------------------- USER DATA -------------------- */

export const mockUsers: Types.UserModel[] = [
    {
        id: MOCK_ADMIN_USER_ID,
        email: 'admin@example.com',
        username: 'admin',
        role: 'admin',
        name: 'Admin User',
        profile_image_url: '/avatars/admin.png',
        last_active_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        created_at: Math.floor(Date.now() / 1000) - 86400 * 30,
    },
    {
        id: MOCK_REGULAR_USER_ID,
        email: 'user@example.com',
        username: 'testuser',
        role: 'user',
        name: 'Test User',
        profile_image_url: '/avatars/user.png',
        status_emoji: '🎉',
        status_message: 'Excited to be here!',
        last_active_at: Math.floor(Date.now() / 1000) - 300,
        updated_at: Math.floor(Date.now() / 1000) - 86400,
        created_at: Math.floor(Date.now() / 1000) - 86400 * 14,
    },
    {
        id: MOCK_PENDING_USER_ID,
        email: 'pending@example.com',
        role: 'pending',
        name: 'Pending User',
        profile_image_url: '/user.png',
        last_active_at: Math.floor(Date.now() / 1000) - 3600,
        updated_at: Math.floor(Date.now() / 1000) - 3600,
        created_at: Math.floor(Date.now() / 1000) - 7200,
    },
];

export const mockUserSettings: Types.UserSettings = {
    ui: {
        theme: 'dark',
        language: 'en',
    },
};

export const mockUserInfo: Record<string, any> = {
    favoriteColor: 'blue',
    notifications: true,
};

export const mockDefaultPermissions: Types.UserPermissions = {
    workspace: {
        models: false,
        knowledge: false,
        prompts: false,
        tools: false,
        models_import: false,
        models_export: false,
        prompts_import: false,
        prompts_export: false,
        tools_import: false,
        tools_export: false,
    },
    sharing: {
        models: false,
        public_models: false,
        knowledge: false,
        public_knowledge: false,
        prompts: false,
        public_prompts: false,
        tools: false,
        public_tools: true,
        notes: false,
        public_notes: true,
    },
    chat: {
        controls: true,
        valves: true,
        system_prompt: true,
        params: true,
        file_upload: true,
        delete: true,
        delete_message: true,
        continue_response: true,
        regenerate_response: true,
        rate_response: true,
        edit: true,
        share: true,
        export: true,
        stt: true,
        tts: true,
        call: true,
        multiple_models: true,
        temporary: true,
        temporary_enforced: false,
    },
    features: {
        api_keys: false,
        notes: true,
        channels: true,
        folders: true,
        direct_tool_servers: false,
        web_search: true,
        image_generation: true,
        code_interpreter: true,
        memories: true,
    },
    settings: {
        interface: true,
    },
};

/* -------------------- CONFIG DATA -------------------- */

export const mockSystemConfig: Record<string, any> = {
    version: 1,
    ui: {
        theme: 'dark',
        language: 'en',
    },
    features: {
        enableSignup: true,
        enableApiKeys: false,
    },
};

export const mockBanners: Types.BannerModel[] = [
    {
        id: 'banner-1',
        type: 'info',
        title: 'Welcome',
        content: 'Welcome to the mock API!',
        dismissible: true,
        timestamp: Math.floor(Date.now() / 1000),
    },
];

/* -------------------- MODEL DATA -------------------- */

export const mockModels: Types.ModelModel[] = [
    {
        id: 'gpt-4',
        user_id: MOCK_ADMIN_USER_ID,
        base_model_id: null,  // Base model
        name: 'GPT-4',
        params: {
            temperature: 0.7,
            max_tokens: 4096,
        },
        meta: {
            profile_image_url: '/models/gpt4.png',
            description: 'Most capable GPT-4 model',
            capabilities: { vision: false, function_calling: true },
            tags: ['openai', 'chat', 'production'],
        },
        access_control: null,  // Public read access
        is_active: true,
        updated_at: Math.floor(Date.now() / 1000),
        created_at: Math.floor(Date.now() / 1000) - 86400 * 60,
    },
    {
        id: 'llama-3-70b',
        user_id: MOCK_ADMIN_USER_ID,
        base_model_id: null,  // Base model
        name: 'Llama 3 70B',
        params: {
            temperature: 0.8,
            ctx_size: 8192,
        },
        meta: {
            profile_image_url: '/models/llama.png',
            description: 'Open-source Llama 3 model',
            capabilities: { vision: false, function_calling: false },
            tags: ['llama', 'open-source'],
        },
        access_control: null,
        is_active: true,
        updated_at: Math.floor(Date.now() / 1000) - 86400,
        created_at: Math.floor(Date.now() / 1000) - 86400 * 30,
    },
    {
        id: 'custom-gpt4-assistant',
        user_id: MOCK_REGULAR_USER_ID,
        base_model_id: 'gpt-4',  // Custom model referencing gpt-4
        name: 'My Custom GPT-4 Assistant',
        params: {
            temperature: 0.5,
            max_tokens: 2000,
            system_prompt: 'You are a helpful coding assistant.',
        },
        meta: {
            profile_image_url: '/avatars/custom.png',
            description: 'Custom GPT-4 configuration for coding',
            tags: ['custom', 'coding'],
        },
        access_control: {
            read: {
                user_ids: [MOCK_REGULAR_USER_ID],
            },
            write: {
                user_ids: [MOCK_REGULAR_USER_ID],
            },
        },
        is_active: true,
        updated_at: Math.floor(Date.now() / 1000) - 3600,
        created_at: Math.floor(Date.now() / 1000) - 86400 * 7,
    },
];
