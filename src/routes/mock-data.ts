/**
 * Centralized mock data for all API routes.
 *
 * This file contains all mock database state used across routes during development.
 */

import * as Types from './types.js';

/* -------------------- CONSTANTS -------------------- */

let numUUIDs = 0;

// Create a static UUID that increments each time we create a new one
function getUUID(): string {
    const id = numUUIDs++;
    const paddedNum = id.toString().padStart(4, '0');
    return '550e8400-e29b-41d4-a716-44665544' + paddedNum;
}

// User IDs (reused across routes)
export const MOCK_ADMIN_USER_ID = getUUID();
export const MOCK_REGULAR_USER_ID = getUUID();
export const MOCK_PENDING_USER_ID = getUUID();

// Auth token
export const MOCK_JWT_TOKEN = 'mock-jwt-token-def456';

const now = Math.floor(Date.now() / 1000);

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

/* -------------------- FOLDER DATA -------------------- */

export const MOCK_FOLDER_ID_1 = getUUID();
export const MOCK_FOLDER_ID_2 = getUUID();
export const MOCK_FOLDER_ID_3 = getUUID();

export const mockFolders: Types.FolderModel[] = [
    {
        id: MOCK_FOLDER_ID_1,
        parent_id: null,
        user_id: MOCK_ADMIN_USER_ID,
        name: 'Work Projects',
        items: null,
        meta: { icon: 'briefcase' },
        data: null,
        is_expanded: true,
        created_at: now - 86400 * 30,
        updated_at: now - 86400 * 5,
    },
    {
        id: MOCK_FOLDER_ID_2,
        parent_id: null,
        user_id: MOCK_REGULAR_USER_ID,
        name: 'Personal',
        items: null,
        meta: { icon: 'home' },
        data: null,
        is_expanded: false,
        created_at: now - 86400 * 20,
        updated_at: now - 86400 * 3,
    },
    {
        id: MOCK_FOLDER_ID_3,
        parent_id: MOCK_FOLDER_ID_1,
        user_id: MOCK_ADMIN_USER_ID,
        name: 'Client Work',
        items: null,
        meta: null,
        data: null,
        is_expanded: false,
        created_at: now - 86400 * 15,
        updated_at: now - 86400 * 2,
    },
];

/* -------------------- CHAT DATA -------------------- */

// Mix of permanent (UUID) and temporary (local:) chat IDs
export const MOCK_CHAT_ID_1 = getUUID();  // Permanent
export const MOCK_CHAT_ID_2 = getUUID();  // Permanent
export const MOCK_CHAT_ID_3 = 'local:ccXIrOFpfsc4MaOZAACD';  // Temporary
export const MOCK_CHAT_ID_4 = getUUID();  // Permanent
export const MOCK_CHAT_ID_5 = 'local:9e1f8891abc123def456';  // Temporary
export const MOCK_SHARE_ID = getUUID();  // UUIDv4 for shared chat
export const MOCK_MESSAGE_ID_1 = getUUID();  // UUIDv4 for message

export const mockChats: Types.ChatResponse[] = [
    {
        id: MOCK_CHAT_ID_1,
        user_id: MOCK_ADMIN_USER_ID,
        title: 'Getting Started with AI',
        chat: {
            messages: [
                { role: 'user', content: 'Hello! How can I get started with AI?' },
                { role: 'assistant', content: 'Great question! Let me help you get started...' },
            ],
            model: 'gpt-4',
        },
        updated_at: now - 3600,
        created_at: now - 86400 * 5,
        share_id: null,
        archived: false,
        pinned: false,
        meta: {},
        folder_id: null,
    },
    {
        id: MOCK_CHAT_ID_2,
        user_id: MOCK_ADMIN_USER_ID,
        title: 'TypeScript Best Practices',
        chat: {
            messages: [
                { role: 'user', content: 'What are TypeScript best practices?' },
                { role: 'assistant', content: 'Here are some key TypeScript best practices...' },
                { role: 'user', content: 'Tell me more about type guards' },
                { role: 'assistant', content: 'Type guards are a way to narrow types...' },
            ],
            model: 'gpt-4',
        },
        updated_at: now - 7200,
        created_at: now - 86400 * 10,
        share_id: MOCK_SHARE_ID,
        archived: false,
        pinned: true,
        meta: { tags: ['typescript', 'programming'] },
        folder_id: MOCK_FOLDER_ID_1,
    },
    {
        id: MOCK_CHAT_ID_3,
        user_id: MOCK_REGULAR_USER_ID,
        title: 'Cooking Recipes',
        chat: {
            messages: [
                { role: 'user', content: 'Give me a recipe for chocolate chip cookies' },
                { role: 'assistant', content: 'Here\'s a great chocolate chip cookie recipe...' },
            ],
            model: 'llama-3-70b',
        },
        updated_at: now - 14400,
        created_at: now - 86400 * 3,
        share_id: null,
        archived: false,
        pinned: false,
        meta: {},
        folder_id: null,
    },
    {
        id: MOCK_CHAT_ID_4,
        user_id: MOCK_ADMIN_USER_ID,
        title: 'Old Archived Conversation',
        chat: {
            messages: [
                { role: 'user', content: 'This is an old chat' },
                { role: 'assistant', content: 'Yes, this chat has been archived.' },
            ],
            model: 'gpt-4',
        },
        updated_at: now - 86400 * 30,
        created_at: now - 86400 * 60,
        share_id: null,
        archived: true,
        pinned: false,
        meta: {},
        folder_id: null,
    },
    {
        id: MOCK_CHAT_ID_5,
        user_id: MOCK_REGULAR_USER_ID,
        title: 'Work Projects Planning',
        chat: {
            messages: [
                { role: 'user', content: 'Help me plan my Q1 projects' },
                { role: 'assistant', content: 'Let\'s break down your Q1 planning...' },
            ],
            model: 'gpt-4',
        },
        updated_at: now - 1800,
        created_at: now - 86400 * 2,
        share_id: null,
        archived: false,
        pinned: true,
        meta: {},
        folder_id: MOCK_FOLDER_ID_2,
    },
];

/* -------------------- FILE DATA -------------------- */

// File IDs (reused across routes) - generated once at module load
export const MOCK_FILE_ID_1 = getUUID();
export const MOCK_FILE_ID_2 = getUUID();
export const MOCK_FILE_ID_3 = getUUID();
export const MOCK_FILE_ID_4 = getUUID();

export const mockFiles: Types.FileModel[] = [
    {
        id: MOCK_FILE_ID_1,
        user_id: MOCK_ADMIN_USER_ID,
        hash: 'abc123def456',
        filename: 'project-diagram.png',
        path: '/uploads/project-diagram.png',
        data: {
            status: 'completed',
            content: 'Extracted text from diagram: Project Architecture - Frontend, Backend, Database',
        },
        meta: {
            name: 'project-diagram.png',
            content_type: 'image/png',
            size: 245680,
        },
        access_control: null,
        created_at: now - 86400 * 5,
        updated_at: now - 86400 * 5,
    },
    {
        id: MOCK_FILE_ID_2,
        user_id: MOCK_ADMIN_USER_ID,
        hash: 'xyz789ghi012',
        filename: 'meeting-notes.pdf',
        path: '/uploads/meeting-notes.pdf',
        data: {
            status: 'completed',
            content: 'Meeting Notes - January 2026\n\nAttendees: Alice, Bob, Carol\n\nAgenda:\n1. Project status update\n2. Q1 planning\n3. Technical architecture review',
        },
        meta: {
            name: 'meeting-notes.pdf',
            content_type: 'application/pdf',
            size: 532100,
        },
        access_control: null,
        created_at: now - 86400 * 10,
        updated_at: now - 86400 * 10,
    },
    {
        id: MOCK_FILE_ID_3,
        user_id: MOCK_REGULAR_USER_ID,
        hash: 'mno345pqr678',
        filename: 'readme.txt',
        path: '/uploads/readme.txt',
        data: {
            status: 'completed',
            content: 'README\n\nThis is a simple text file with project instructions.\n\nPlease follow the guidelines in this document.',
        },
        meta: {
            name: 'readme.txt',
            content_type: 'text/plain',
            size: 1024,
        },
        access_control: null,
        created_at: now - 86400 * 2,
        updated_at: now - 86400 * 2,
    },
    {
        id: MOCK_FILE_ID_4,
        user_id: MOCK_ADMIN_USER_ID,
        hash: 'stu901vwx234',
        filename: 'large-document.docx',
        path: '/uploads/large-document.docx',
        data: {
            status: 'pending',
        },
        meta: {
            name: 'large-document.docx',
            content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 2048000,
        },
        access_control: null,
        created_at: now - 300,
        updated_at: now - 300,
    },
];

/* -------------------- VERSION DATA -------------------- */

export const mockVersionInfo: Types.VersionInfo = {
    version: '0.3.9',
    deployment_id: 'dev-local',
};

export const mockVersionUpdateInfo: Types.VersionUpdateInfo = {
    current: '0.3.9',
    latest: '0.3.9',  // No update available
};

/* -------------------- PWA DATA -------------------- */

export const mockPWAManifest: Types.PWAManifest = {
    name: 'Open WebUI',
    short_name: 'Open WebUI',
    description: 'Open WebUI is an open, extensible, user-friendly interface for AI that adapts to your workflow.',
    start_url: '/',
    display: 'standalone',
    background_color: '#343541',
    icons: [
        {
            src: '/static/logo.png',
            type: 'image/png',
            sizes: '500x500',
            purpose: 'any',
        },
        {
            src: '/static/logo.png',
            type: 'image/png',
            sizes: '500x500',
            purpose: 'maskable',
        },
    ],
    share_target: {
        action: '/',
        method: 'GET',
        params: {
            text: 'shared',
        },
    },
};
