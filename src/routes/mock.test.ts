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

const BASE_URL = 'http://192.168.87.30:8081';

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
    const adminConfigInput: Types.AdminConfig = {
        SHOW_ADMIN_DETAILS: true,
        ADMIN_EMAIL: 'admin@example.com',
        WEBUI_URL: 'http://localhost:3000',
        ENABLE_SIGNUP: false,
        ENABLE_API_KEYS: true,
        ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
        API_KEYS_ALLOWED_ENDPOINTS: '',
        DEFAULT_USER_ROLE: 'pending',
        DEFAULT_GROUP_ID: 'default-group',
        JWT_EXPIRES_IN: '14d',
        ENABLE_COMMUNITY_SHARING: true,
        ENABLE_MESSAGE_RATING: true,
        ENABLE_FOLDERS: true,
        FOLDER_MAX_FILE_COUNT: 100,
        ENABLE_CHANNELS: false,
        ENABLE_MEMORIES: false,
        ENABLE_NOTES: false,
        ENABLE_USER_WEBHOOKS: false,
        ENABLE_USER_STATUS: true,
        PENDING_USER_OVERLAY_TITLE: 'Pending Approval',
        PENDING_USER_OVERLAY_CONTENT: 'Your account is pending admin approval.',
        RESPONSE_WATERMARK: null,
    };
    await testEndpoint(
        'POST /api/v1/auths/admin/config',
        'POST',
        '/api/v1/auths/admin/config',
        adminConfigInput,
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
    const defaultPermsInput: Types.UserPermissions = {
        workspace: {
            models: true,
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
    await testEndpoint(
        'POST /api/v1/users/default/permissions',
        'POST',
        '/api/v1/users/default/permissions',
        defaultPermsInput,
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

/* -------------------- RUN ALL TESTS -------------------- */

async function runTests(): Promise<void> {
    await testAuthEndpoints();
    await testConfigEndpoints();
    await testUserEndpoints();
    await testModelEndpoints();

    console.log('\n' + '='.repeat(60));
    console.log('ALL TESTS COMPLETED');
    console.log('='.repeat(60));
}

runTests().catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
});
