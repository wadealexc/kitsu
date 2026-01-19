/**
 * Mock endpoint tests
 *
 * Tests each mocked endpoint to validate that:
 * - Schema-compliant inputs are accepted
 * - Outputs match the expected schema
 * - Happy path works for all endpoints
 */

import fetch from 'node-fetch';
import * as Types from './types.js';
import * as MockData from './mock-data.js';

const BASE_URL = 'http://192.168.87.30:8071';

/* -------------------- HELPERS -------------------- */

async function testEndpoint(
    name: string,
    method: string,
    path: string,
    body?: any,
    headers?: Record<string, string>,
    responseSchema?: any,
    expectJson: boolean = true
): Promise<void> {
    console.log(`\n${name}`);

    const response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const status = response.status;

    console.log(`  Status: ${status} ${status === 200 ? '✓' : '✗'}`);

    // Skip JSON parsing for non-JSON responses (like images)
    if (!expectJson) {
        return;
    }

    const data = await response.json();

    // Validate response against schema if provided
    if (responseSchema) {
        const parsed = responseSchema.safeParse(data);
        if (parsed.success) {
            console.log(`  Schema: ✓`);
        } else {
            console.log(`  Schema: ✗`);
            console.log(`  Errors: ${JSON.stringify(parsed.error.issues, null, 2)}`);
        }
    }
}

/* -------------------- AUTH TESTS -------------------- */

async function testAuthEndpoints(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('AUTHENTICATION ENDPOINTS');
    console.log('='.repeat(60));

    /* -------------------- PUBLIC ENDPOINTS -------------------- */

    // POST /api/v1/auths/signin
    const signinInput: Types.SigninForm = {
        email: 'test@example.com',
        password: 'password123',
    };
    await testEndpoint(
        'POST /api/v1/auths/signin',
        'POST',
        '/api/v1/auths/signin',
        signinInput,
        undefined,
        Types.SessionUserResponseSchema
    );

    // POST /api/v1/auths/signup
    const signupInput: Types.SignupForm = {
        name: 'John Doe',
        email: 'john@example.com',
        password: 'securepassword',
        profile_image_url: '/user.png',
    };
    await testEndpoint(
        'POST /api/v1/auths/signup',
        'POST',
        '/api/v1/auths/signup',
        signupInput,
        undefined,
        Types.SessionUserResponseSchema
    );

    // GET /api/v1/auths/signout
    await testEndpoint(
        'GET /api/v1/auths/signout',
        'GET',
        '/api/v1/auths/signout',
        undefined,
        undefined,
        Types.SignoutResponseSchema
    );

    /* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

    // GET /api/v1/auths/
    await testEndpoint(
        'GET /api/v1/auths/',
        'GET',
        '/api/v1/auths/',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.SessionUserInfoResponseSchema
    );

    // POST /api/v1/auths/update/profile
    const updateProfileInput: Types.UpdateProfileForm = {
        profile_image_url: '/avatars/user.png',
        name: 'Jane Doe',
        bio: 'Software developer',
        gender: null,
        date_of_birth: null,
    };
    await testEndpoint(
        'POST /api/v1/auths/update/profile',
        'POST',
        '/api/v1/auths/update/profile',
        updateProfileInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserProfileImageResponseSchema
    );

    // POST /api/v1/auths/update/password
    const updatePasswordInput: Types.UpdatePasswordForm = {
        password: 'oldpassword',
        new_password: 'newpassword123',
    };
    await testEndpoint(
        'POST /api/v1/auths/update/password',
        'POST',
        '/api/v1/auths/update/password',
        updatePasswordInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // POST /api/v1/auths/update/timezone
    const updateTimezoneInput: Types.UpdateTimezoneForm = {
        timezone: 'America/New_York',
    };
    await testEndpoint(
        'POST /api/v1/auths/update/timezone',
        'POST',
        '/api/v1/auths/update/timezone',
        updateTimezoneInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.StatusResponseSchema
    );

    // GET /api/v1/auths/admin/details
    await testEndpoint(
        'GET /api/v1/auths/admin/details',
        'GET',
        '/api/v1/auths/admin/details',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.AdminDetailsResponseSchema
    );

    /* -------------------- ADMIN ENDPOINTS -------------------- */

    // POST /api/v1/auths/add
    const addUserInput: Types.AddUserForm = {
        name: 'New User',
        email: 'newuser@example.com',
        password: 'password123',
        profile_image_url: '/user.png',
        role: 'user',
    };
    await testEndpoint(
        'POST /api/v1/auths/add',
        'POST',
        '/api/v1/auths/add',
        addUserInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.SigninResponseSchema
    );

    // GET /api/v1/auths/admin/config
    await testEndpoint(
        'GET /api/v1/auths/admin/config',
        'GET',
        '/api/v1/auths/admin/config',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.AdminConfigSchema
    );

    // POST /api/v1/auths/admin/config
    await testEndpoint(
        'POST /api/v1/auths/admin/config',
        'POST',
        '/api/v1/auths/admin/config',
        MockData.mockAdminConfig,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.AdminConfigSchema
    );
}

/* -------------------- CONFIG TESTS -------------------- */

async function testConfigEndpoints(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('CONFIGURATION ENDPOINTS');
    console.log('='.repeat(60));

    /* -------------------- ADMIN ENDPOINTS -------------------- */

    // GET /api/v1/configs/export
    await testEndpoint(
        'GET /api/v1/configs/export',
        'GET',
        '/api/v1/configs/export',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // POST /api/v1/configs/import
    const importConfigInput: Types.ImportConfigForm = {
        config: {
            version: 2,
            ui: {
                theme: 'light',
                language: 'en',
            },
            features: {
                enableSignup: false,
                enableApiKeys: true,
            },
        },
    };
    await testEndpoint(
        'POST /api/v1/configs/import',
        'POST',
        '/api/v1/configs/import',
        importConfigInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // POST /api/v1/configs/banners (set banners)
    const setBannersInput: Types.SetBannersForm = {
        banners: [
            {
                id: 'banner-maintenance',
                type: 'warning',
                title: 'Scheduled Maintenance',
                content: 'The system will be down for maintenance on Sunday at 2 AM UTC.',
                dismissible: true,
                timestamp: Math.floor(Date.now() / 1000),
            },
            {
                id: 'banner-announcement',
                type: 'info',
                content: 'Check out our new features!',
                dismissible: false,
                timestamp: Math.floor(Date.now() / 1000) - 86400,
            },
        ],
    };
    await testEndpoint(
        'POST /api/v1/configs/banners',
        'POST',
        '/api/v1/configs/banners',
        setBannersInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.SetBannersFormSchema.shape.banners
    );

    /* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

    // GET /api/v1/configs/banners
    await testEndpoint(
        'GET /api/v1/configs/banners',
        'GET',
        '/api/v1/configs/banners',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.SetBannersFormSchema.shape.banners
    );
}

/* -------------------- USER TESTS -------------------- */

async function testUserEndpoints(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('USER MANAGEMENT ENDPOINTS');
    console.log('='.repeat(60));

    /* -------------------- ADMIN ENDPOINTS -------------------- */

    // GET /api/v1/users/ (list with pagination)
    await testEndpoint(
        'GET /api/v1/users/',
        'GET',
        '/api/v1/users/?page=1',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserGroupIdsListResponseSchema
    );

    // GET /api/v1/users/all
    await testEndpoint(
        'GET /api/v1/users/all',
        'GET',
        '/api/v1/users/all',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserInfoListResponseSchema
    );

    // POST /api/v1/users/{user_id}/update
    const userUpdateInput: Types.UserUpdateForm = {
        role: 'user',
        name: 'Updated User',
        email: 'updated@example.com',
        profile_image_url: '/avatars/updated.png',
    };
    await testEndpoint(
        'POST /api/v1/users/{user_id}/update',
        'POST',
        `/api/v1/users/${MockData.MOCK_REGULAR_USER_ID}/update`,
        userUpdateInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserModelSchema
    );

    // GET /api/v1/users/default/permissions
    await testEndpoint(
        'GET /api/v1/users/default/permissions',
        'GET',
        '/api/v1/users/default/permissions',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserPermissionsSchema
    );

    // POST /api/v1/users/default/permissions
    await testEndpoint(
        'POST /api/v1/users/default/permissions',
        'POST',
        '/api/v1/users/default/permissions',
        MockData.mockDefaultPermissions,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // DELETE /api/v1/users/{user_id} (test with user-3, not primary admin)
    await testEndpoint(
        'DELETE /api/v1/users/{user_id}',
        'DELETE',
        `/api/v1/users/${MockData.MOCK_PENDING_USER_ID}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    /* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

    // GET /api/v1/users/search
    await testEndpoint(
        'GET /api/v1/users/search',
        'GET',
        '/api/v1/users/search?query=test&page=1',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserInfoListResponseSchema
    );

    // GET /api/v1/users/{user_id}
    await testEndpoint(
        'GET /api/v1/users/{user_id}',
        'GET',
        `/api/v1/users/${MockData.MOCK_ADMIN_USER_ID}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserActiveResponseSchema
    );

    // GET /api/v1/users/user/settings
    await testEndpoint(
        'GET /api/v1/users/user/settings',
        'GET',
        '/api/v1/users/user/settings',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserSettingsSchema
    );

    // POST /api/v1/users/user/settings/update
    const userSettingsInput: Types.UserSettings = {
        ui: {
            theme: 'light',
            language: 'es',
        },
    };
    await testEndpoint(
        'POST /api/v1/users/user/settings/update',
        'POST',
        '/api/v1/users/user/settings/update',
        userSettingsInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserSettingsSchema
    );

    // GET /api/v1/users/user/info
    await testEndpoint(
        'GET /api/v1/users/user/info',
        'GET',
        '/api/v1/users/user/info',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // POST /api/v1/users/user/info/update
    const userInfoInput = {
        favoriteColor: 'red',
        notifications: false,
        customField: 'test',
    };
    await testEndpoint(
        'POST /api/v1/users/user/info/update',
        'POST',
        '/api/v1/users/user/info/update',
        userInfoInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/users/permissions
    await testEndpoint(
        'GET /api/v1/users/permissions',
        'GET',
        '/api/v1/users/permissions',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.UserPermissionsSchema
    );

    // GET /api/v1/users/{user_id}/profile/image (returns binary image data, not JSON)
    await testEndpoint(
        'GET /api/v1/users/{user_id}/profile/image',
        'GET',
        `/api/v1/users/${MockData.MOCK_ADMIN_USER_ID}/profile/image`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        undefined,
        false  // Don't expect JSON response
    );
}

/* -------------------- MODEL TESTS -------------------- */

async function testModelEndpoints(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('MODEL MANAGEMENT ENDPOINTS');
    console.log('='.repeat(60));

    /* -------------------- PUBLIC ENDPOINTS -------------------- */

    // GET /api/v1/models (with refresh param)
    await testEndpoint(
        'GET /api/v1/models',
        'GET',
        '/api/v1/models',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/models (with refresh=true)
    await testEndpoint(
        'GET /api/v1/models?refresh=true',
        'GET',
        '/api/v1/models?refresh=true',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/models/list
    await testEndpoint(
        'GET /api/v1/models/list',
        'GET',
        '/api/v1/models/list',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ModelAccessListResponseSchema
    );

    // GET /api/v1/models/list (with pagination and filtering)
    await testEndpoint(
        'GET /api/v1/models/list?page=1&query=custom',
        'GET',
        '/api/v1/models/list?page=1&query=custom',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ModelAccessListResponseSchema
    );

    // GET /api/v1/models/tags
    await testEndpoint(
        'GET /api/v1/models/tags',
        'GET',
        '/api/v1/models/tags',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/models/model
    await testEndpoint(
        'GET /api/v1/models/model?id=gpt-4',
        'GET',
        '/api/v1/models/model?id=gpt-4',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ModelAccessResponseSchema
    );

    /* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

    // POST /api/v1/models/create
    const createModelInput: Types.ModelForm = {
        id: 'test-model',
        name: 'Test Model',
        base_model_id: 'gpt-4',
        params: { temperature: 0.7 },
        is_active: true,
        meta: {
            profile_image_url: '/models/test.png',
            description: 'A test model',
            tags: ['test'],
        },
    };
    await testEndpoint(
        'POST /api/v1/models/create',
        'POST',
        '/api/v1/models/create',
        createModelInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ModelModelSchema
    );

    // POST /api/v1/models/model/toggle
    await testEndpoint(
        'POST /api/v1/models/model/toggle?id=gpt-4',
        'POST',
        '/api/v1/models/model/toggle?id=gpt-4',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ModelResponseSchema
    );

    // POST /api/v1/models/model/update
    const updateModelInput: Types.ModelForm = {
        id: 'gpt-4',
        name: 'Updated GPT-4',
        base_model_id: null,
        params: { temperature: 0.8, max_tokens: 8192 },
        meta: {
            profile_image_url: '/models/test.png',
            description: 'Updated description',
            tags: ['openai', 'updated'],
        },
        is_active: true,
    };
    await testEndpoint(
        'POST /api/v1/models/model/update',
        'POST',
        '/api/v1/models/model/update',
        updateModelInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ModelModelSchema
    );

    // POST /api/v1/models/model/delete
    const deleteModelInput: Types.ModelIdForm = {
        id: 'custom-gpt4-assistant',
    };
    await testEndpoint(
        'POST /api/v1/models/model/delete',
        'POST',
        '/api/v1/models/model/delete',
        deleteModelInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    /* -------------------- ADMIN ENDPOINTS -------------------- */

    // GET /api/v1/models/base
    await testEndpoint(
        'GET /api/v1/models/base',
        'GET',
        '/api/v1/models/base',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // POST /api/v1/models/sync
    const syncModelsInput: Types.SyncModelsForm = {
        models: [
            {
                id: 'synced-model',
                user_id: MockData.MOCK_ADMIN_USER_ID,
                base_model_id: null,
                name: 'Synced Model',
                params: {},
                meta: {
                    profile_image_url: '/models/test.png',
                },
                access_control: null,
                is_active: true,
                updated_at: Math.floor(Date.now() / 1000),
                created_at: Math.floor(Date.now() / 1000),
            },
        ],
    };
    await testEndpoint(
        'POST /api/v1/models/sync',
        'POST',
        '/api/v1/models/sync',
        syncModelsInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // DELETE /api/v1/models/delete/all
    await testEndpoint(
        'DELETE /api/v1/models/delete/all',
        'DELETE',
        '/api/v1/models/delete/all',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );
}

/* -------------------- CHAT TESTS -------------------- */

async function testChatEndpoints(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('CHAT MANAGEMENT ENDPOINTS');
    console.log('='.repeat(60));

    /* -------------------- CHAT LIST & RETRIEVAL -------------------- */

    // GET /api/v1/chats/ (with pagination and filters)
    await testEndpoint(
        'GET /api/v1/chats/',
        'GET',
        '/api/v1/chats/?page=1&include_pinned=false&include_folders=false',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/chats/list (alias)
    await testEndpoint(
        'GET /api/v1/chats/list',
        'GET',
        '/api/v1/chats/list',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/chats/all
    await testEndpoint(
        'GET /api/v1/chats/all',
        'GET',
        '/api/v1/chats/all',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/chats/all/db (admin export)
    await testEndpoint(
        'GET /api/v1/chats/all/db',
        'GET',
        '/api/v1/chats/all/db',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/chats/:id
    await testEndpoint(
        'GET /api/v1/chats/:id',
        'GET',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_1}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    // GET /api/v1/chats/list/user/:user_id (admin)
    await testEndpoint(
        'GET /api/v1/chats/list/user/:user_id',
        'GET',
        `/api/v1/chats/list/user/${MockData.MOCK_REGULAR_USER_ID}?page=1`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    /* -------------------- CHAT CREATION & MODIFICATION -------------------- */

    // POST /api/v1/chats/new
    const newChatInput: Types.ChatForm = {
        chat: {
            messages: [
                { role: 'user', content: 'Hello, how are you?' },
            ],
            model: 'gpt-4',
        },
        folder_id: null,
    };
    await testEndpoint(
        'POST /api/v1/chats/new',
        'POST',
        '/api/v1/chats/new',
        newChatInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    // POST /api/v1/chats/:id (update)
    const updateChatInput: Types.ChatForm = {
        chat: {
            messages: [
                { role: 'user', content: 'Updated message' },
                { role: 'assistant', content: 'Updated response' },
            ],
            model: 'gpt-4',
        },
        folder_id: MockData.MOCK_FOLDER_ID_1,
    };
    await testEndpoint(
        'POST /api/v1/chats/:id',
        'POST',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_1}`,
        updateChatInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    // DELETE /api/v1/chats/:id
    await testEndpoint(
        'DELETE /api/v1/chats/:id',
        'DELETE',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_4}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // DELETE /api/v1/chats/ (delete all for user)
    // Skipping this test as it's destructive

    /* -------------------- SHARING & CLONING -------------------- */

    // POST /api/v1/chats/:id/share
    await testEndpoint(
        'POST /api/v1/chats/:id/share',
        'POST',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_1}/share`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    // GET /api/v1/chats/share/:share_id
    await testEndpoint(
        'GET /api/v1/chats/share/:share_id',
        'GET',
        `/api/v1/chats/share/${MockData.MOCK_SHARE_ID}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    // DELETE /api/v1/chats/:id/share
    await testEndpoint(
        'DELETE /api/v1/chats/:id/share',
        'DELETE',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_2}/share`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // POST /api/v1/chats/:id/clone/shared
    await testEndpoint(
        'POST /api/v1/chats/:id/clone/shared',
        'POST',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_2}/clone/shared`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    // POST /api/v1/chats/:id/clone
    const cloneChatInput: Types.CloneForm = {
        title: 'Cloned Chat Title',
    };
    await testEndpoint(
        'POST /api/v1/chats/:id/clone',
        'POST',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_1}/clone`,
        cloneChatInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    /* -------------------- FOLDER ORGANIZATION -------------------- */

    // POST /api/v1/chats/:id/folder
    const folderInput: Types.ChatFolderIdForm = {
        folder_id: MockData.MOCK_FOLDER_ID_1,
    };
    await testEndpoint(
        'POST /api/v1/chats/:id/folder',
        'POST',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_1}/folder`,
        folderInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    // GET /api/v1/chats/folder/:folder_id
    await testEndpoint(
        'GET /api/v1/chats/folder/:folder_id',
        'GET',
        `/api/v1/chats/folder/${MockData.MOCK_FOLDER_ID_1}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/chats/folder/:folder_id/list
    await testEndpoint(
        'GET /api/v1/chats/folder/:folder_id/list',
        'GET',
        `/api/v1/chats/folder/${MockData.MOCK_FOLDER_ID_1}/list?page=1`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    /* -------------------- MESSAGE OPERATIONS -------------------- */

    // POST /api/v1/chats/:id/messages/:message_id
    const messageUpdateInput: Types.MessageForm = {
        content: 'Updated message content',
    };
    await testEndpoint(
        'POST /api/v1/chats/:id/messages/:message_id',
        'POST',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_1}/messages/${MockData.MOCK_MESSAGE_ID_1}`,
        messageUpdateInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatResponseSchema
    );

    // POST /api/v1/chats/:id/messages/:message_id/event
    const eventInput: Types.EventForm = {
        type: 'typing',
        data: { status: 'active' },
    };
    await testEndpoint(
        'POST /api/v1/chats/:id/messages/:message_id/event',
        'POST',
        `/api/v1/chats/${MockData.MOCK_CHAT_ID_1}/messages/${MockData.MOCK_MESSAGE_ID_1}/event`,
        eventInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    /* -------------------- STATISTICS -------------------- */

    // GET /api/v1/chats/stats/usage
    await testEndpoint(
        'GET /api/v1/chats/stats/usage',
        'GET',
        '/api/v1/chats/stats/usage?page=1&items_per_page=50',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.ChatUsageStatsListResponseSchema
    );
}

/* -------------------- FOLDER TESTS -------------------- */

async function testFolderEndpoints(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('FOLDER MANAGEMENT ENDPOINTS');
    console.log('='.repeat(60));

    /* -------------------- FOLDER LIST & RETRIEVAL -------------------- */

    // GET /api/v1/folders/
    await testEndpoint(
        'GET /api/v1/folders/',
        'GET',
        '/api/v1/folders/',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/folders/:folder_id
    await testEndpoint(
        'GET /api/v1/folders/:folder_id',
        'GET',
        `/api/v1/folders/${MockData.MOCK_FOLDER_ID_1}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FolderModelSchema
    );

    /* -------------------- FOLDER CREATION & MODIFICATION -------------------- */

    // POST /api/v1/folders/
    const newFolderInput: Types.FolderForm = {
        name: 'New Test Folder',
        meta: { icon: 'folder' },
        data: { description: 'Test folder for mock' },
    };
    await testEndpoint(
        'POST /api/v1/folders/',
        'POST',
        '/api/v1/folders/',
        newFolderInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FolderModelSchema
    );

    // POST /api/v1/folders/:folder_id/update
    const updateFolderInput: Types.FolderUpdateForm = {
        name: 'Updated Folder Name',
        meta: { icon: 'star' },
    };
    await testEndpoint(
        'POST /api/v1/folders/:folder_id/update',
        'POST',
        `/api/v1/folders/${MockData.MOCK_FOLDER_ID_1}/update`,
        updateFolderInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FolderModelSchema
    );

    // POST /api/v1/folders/:folder_id/update/parent
    const updateParentInput: Types.FolderParentIdForm = {
        parent_id: null,  // Move to root level
    };
    await testEndpoint(
        'POST /api/v1/folders/:folder_id/update/parent',
        'POST',
        `/api/v1/folders/${MockData.MOCK_FOLDER_ID_3}/update/parent`,
        updateParentInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FolderModelSchema
    );

    // POST /api/v1/folders/:folder_id/update/expanded
    const updateExpandedInput: Types.FolderIsExpandedForm = {
        is_expanded: true,
    };
    await testEndpoint(
        'POST /api/v1/folders/:folder_id/update/expanded',
        'POST',
        `/api/v1/folders/${MockData.MOCK_FOLDER_ID_1}/update/expanded`,
        updateExpandedInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FolderModelSchema
    );

    // DELETE /api/v1/folders/:folder_id (with delete_contents=true)
    await testEndpoint(
        'DELETE /api/v1/folders/:folder_id',
        'DELETE',
        `/api/v1/folders/${MockData.MOCK_FOLDER_ID_3}?delete_contents=true`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );
}

/* -------------------- FILE TESTS -------------------- */

async function testFileEndpoints(): Promise<void> {
    console.log('\n' + '='.repeat(60));
    console.log('FILE ENDPOINTS');
    console.log('='.repeat(60));

    /* -------------------- LIST & SEARCH -------------------- */

    // GET /api/v1/files/ (list all files)
    await testEndpoint(
        'GET /api/v1/files/',
        'GET',
        '/api/v1/files/',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/files/?content=false (exclude content)
    await testEndpoint(
        'GET /api/v1/files/?content=false',
        'GET',
        '/api/v1/files/?content=false',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/files/search (search by filename pattern)
    await testEndpoint(
        'GET /api/v1/files/search?filename=*.pdf',
        'GET',
        '/api/v1/files/search?filename=*.pdf',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/files/search?filename=*.png&content=false
    await testEndpoint(
        'GET /api/v1/files/search?filename=*.png&content=false',
        'GET',
        '/api/v1/files/search?filename=*.png&content=false',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    /* -------------------- UPLOAD -------------------- */

    // POST /api/v1/files/ (upload file)
    const uploadInput: Types.UploadFileForm = {
        file: 'mock-binary-data',
        metadata: { channel_id: 'test-channel' },
    };
    await testEndpoint(
        'POST /api/v1/files/',
        'POST',
        '/api/v1/files/?process=true&process_in_background=true',
        uploadInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FileModelResponseSchema
    );

    /* -------------------- FILE RETRIEVAL -------------------- */

    // GET /api/v1/files/:file_id
    await testEndpoint(
        'GET /api/v1/files/:file_id',
        'GET',
        `/api/v1/files/${MockData.MOCK_FILE_ID_1}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FileModelSchema
    );

    /* -------------------- FILE CONTENT -------------------- */

    // GET /api/v1/files/:file_id/content
    await testEndpoint(
        'GET /api/v1/files/:file_id/content',
        'GET',
        `/api/v1/files/${MockData.MOCK_FILE_ID_1}/content`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/files/:file_id/content?attachment=true
    await testEndpoint(
        'GET /api/v1/files/:file_id/content?attachment=true',
        'GET',
        `/api/v1/files/${MockData.MOCK_FILE_ID_1}/content?attachment=true`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/files/:file_id/content/:file_name
    await testEndpoint(
        'GET /api/v1/files/:file_id/content/:file_name',
        'GET',
        `/api/v1/files/${MockData.MOCK_FILE_ID_1}/content/download.pdf`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    // GET /api/v1/files/:file_id/content/html
    await testEndpoint(
        'GET /api/v1/files/:file_id/content/html',
        'GET',
        `/api/v1/files/${MockData.MOCK_FILE_ID_1}/content/html`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` }
    );

    /* -------------------- FILE DATA -------------------- */

    // GET /api/v1/files/:file_id/data/content
    await testEndpoint(
        'GET /api/v1/files/:file_id/data/content',
        'GET',
        `/api/v1/files/${MockData.MOCK_FILE_ID_1}/data/content`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FileDataContentResponseSchema
    );

    // POST /api/v1/files/:file_id/data/content/update
    const contentUpdateInput: Types.ContentForm = {
        content: 'Updated file content with new extracted text.',
    };
    await testEndpoint(
        'POST /api/v1/files/:file_id/data/content/update',
        'POST',
        `/api/v1/files/${MockData.MOCK_FILE_ID_1}/data/content/update`,
        contentUpdateInput,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FileModelResponseSchema
    );

    /* -------------------- FILE PROCESSING -------------------- */

    // GET /api/v1/files/:file_id/process/status
    await testEndpoint(
        'GET /api/v1/files/:file_id/process/status',
        'GET',
        `/api/v1/files/${MockData.MOCK_FILE_ID_2}/process/status`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FileProcessStatusResponseSchema
    );

    // GET /api/v1/files/:file_id/process/status?stream=false
    await testEndpoint(
        'GET /api/v1/files/:file_id/process/status?stream=false',
        'GET',
        `/api/v1/files/${MockData.MOCK_FILE_ID_4}/process/status?stream=false`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FileProcessStatusResponseSchema
    );

    /* -------------------- FILE DELETION -------------------- */

    // DELETE /api/v1/files/:file_id
    await testEndpoint(
        'DELETE /api/v1/files/:file_id',
        'DELETE',
        `/api/v1/files/${MockData.MOCK_FILE_ID_3}`,
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FileDeleteResponseSchema
    );

    /* -------------------- ADMIN ENDPOINTS -------------------- */

    // DELETE /api/v1/files/all (admin only)
    await testEndpoint(
        'DELETE /api/v1/files/all',
        'DELETE',
        '/api/v1/files/all',
        undefined,
        { 'Authorization': `Bearer ${MockData.MOCK_JWT_TOKEN}` },
        Types.FileDeleteResponseSchema
    );
}

/* -------------------- RUN ALL TESTS -------------------- */

async function runTests(): Promise<void> {
    await testAuthEndpoints();
    await testConfigEndpoints();
    await testUserEndpoints();
    await testModelEndpoints();
    await testChatEndpoints();
    await testFolderEndpoints();
    await testFileEndpoints();

    console.log('\n' + '='.repeat(60));
    console.log('ALL TESTS COMPLETED');
    console.log('='.repeat(60));
}

runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
