# Extra Endpoints

Endpoints discovered while integrating with the OpenWebUI frontend that weren't in the original OpenAPI spec or need additional documentation.

---

## Temporary Stub Endpoints

**Location:** `src/index.ts` (marked as temporary)

These endpoints return empty arrays to prevent frontend errors. They should be removed once the frontend is cleaned up to not depend on features we've excluded.

### GET `/api/v1/tools`
Returns empty array `[]` - Tools/integrations system not implemented

### GET `/api/v1/functions`
Returns empty array `[]` - Functions system not implemented

### GET `/api/v1/chats/all/tags`
Returns empty array `[]` - Tags system not implemented

### GET `/api/v1/chats/pinned`
Returns empty array `[]` - Pinned chats feature not implemented

### GET `/api/v1/models/model/profile/image`
Returns 'mock profile image'

---

## GET `/api/config`

Get backend configuration and feature flags. Returns different levels of configuration based on authentication status.

### Inputs

**Headers:**
- `Authorization: Bearer <token>` (optional)

**Cookies:**
- `token` (optional, fallback if Authorization header not present)

### Outputs

Response (200): [`BackendConfig`](#backendconfig)

### Notes

- _Reference Implementation:_
  - File: `/open-webui/backend/open_webui/main.py:1878-2047`
  - Method: `get_app_config()`
  - Frontend Type: `/open-webui/src/lib/stores/index.ts:255-291` (type Config)
  - Frontend API Call: `/open-webui/src/lib/apis/index.ts:1355-1380` (getBackendConfig)
  - Frontend Usage: `/open-webui/src/routes/+layout.svelte:746` (loads on app initialization)

- _Security:_
  - Public endpoint - no authentication required for basic config
  - Authenticated users receive full configuration
  - Returns different data based on user role (admin/user/pending/unauthenticated)

- _Implementation Notes:_
  - **Auth detection (lines 1883-1902):** Checks Authorization header first, then falls back to cookie
  - **Conditional features (lines 1933-1964):** Extra features only returned `if user is not None`
  - **Conditional full config (lines 1967-2046):** Different response branches:
    - Lines 1969-2018: Full config `if user is not None and (user.role in ["admin", "user"])`
    - Lines 2020-2045: Limited config for pending/unauthenticated users
  - **Unauthenticated users (lines 1910-1921 base + limited features):**
    - Returns basic config: status, name, version, default_locale, oauth providers, core auth features
    - Includes `onboarding: true` if user_count is 0 (first user setup) - line 1911
  - **Authenticated users admin/user (lines 1969-2018):**
    - Returns full config including all features, default models, permissions, file settings, etc.
    - Admins get additional `active_entries` field (lines 2012-2016)
  - **Pending users (lines 2022-2029):**
    - Returns basic config + UI overlay messages for pending state
  - Used by frontend on initial load to determine available features and configuration
  - Backend checks both Authorization header and cookie for token

---

## Definitions

### `BackendConfig`

Backend configuration object. Structure varies based on authentication status.

**Source:**
- Backend: `/open-webui/backend/open_webui/main.py:1910-2047` (return statement)
- Frontend Type: `/open-webui/src/lib/stores/index.ts:255-291`

**Base fields (always present):**
```typescript
{
    status: boolean;              // Always true
    name: string;                 // WEBUI_NAME (e.g., "Open WebUI")
    version: string;              // Backend version (e.g., "0.3.9")
    default_locale: string;       // Default UI locale (e.g., "en-US")
    oauth: {
        providers: {
            [provider: string]: string;  // OAuth provider name mappings
        };
    };
    features: {
        auth: boolean;                        // Authentication enabled
        auth_trusted_header: boolean;         // Trusted header auth enabled
        enable_signup: boolean;               // User signup enabled
        enable_login_form: boolean;           // Login form enabled
        enable_api_keys: boolean;             // API keys feature enabled
        enable_websocket?: boolean;           // WebSocket support enabled
        enable_version_update_check?: boolean; // Version update checking enabled

        // Additional features (only present for authenticated users)
        enable_ldap?: boolean;
        enable_signup_password_confirmation?: boolean;
        enable_public_active_users_count?: boolean;
        enable_direct_connections?: boolean;
        enable_folders?: boolean;
        folder_max_file_count?: number;
        enable_channels?: boolean;
        enable_notes?: boolean;
        enable_web_search?: boolean;
        enable_code_execution?: boolean;
        enable_code_interpreter?: boolean;
        enable_image_generation?: boolean;
        enable_autocomplete_generation?: boolean;
        enable_community_sharing?: boolean;
        enable_message_rating?: boolean;
        enable_user_webhooks?: boolean;
        enable_user_status?: boolean;
        enable_admin_export?: boolean;
        enable_admin_chat_access?: boolean;
        enable_google_drive_integration?: boolean;
        enable_onedrive_integration?: boolean;
        enable_onedrive_personal?: boolean;
        enable_onedrive_business?: boolean;
        enable_memories?: boolean;
    };
}
```

**Additional fields for authenticated users:**
```typescript
{
    default_models: string;                // Default model selection
    default_pinned_models?: string[];      // Pinned models list
    default_prompt_suggestions: PromptSuggestion[];  // Default prompt suggestions
    user_count: number;                    // Total user count
    code: {
        engine: string;                    // Code execution engine
    };
    audio: {
        tts: {
            engine: string;                // TTS engine
            voice: string;                 // Default TTS voice
            split_on: string;              // TTS text splitting rules
        };
        stt: {
            engine: string;                // STT engine
        };
    };
    file: {
        max_size: number;                  // Max file size in bytes
        max_count: number;                 // Max files per upload
        image_compression: {
            width: number;                 // Max image width
            height: number;                // Max image height
        };
    };
    permissions: object;                   // User permissions object
    google_drive: {
        client_id: string;
        api_key: string;
    };
    onedrive: {
        client_id_personal: string;
        client_id_business: string;
        sharepoint_url: string;
        sharepoint_tenant_id: string;
    };
    ui: {
        pending_user_overlay_title?: string;
        pending_user_overlay_content?: string;
        response_watermark?: string;
    };
    license_metadata: any;
    active_entries?: number;               // Only for admin users
}
```

**Additional fields for unauthenticated (onboarding):**
```typescript
{
    onboarding?: boolean;  // Present only if user_count === 0
}
```

**Additional fields for pending users:**
```typescript
{
    ui: {
        pending_user_overlay_title?: string;
        pending_user_overlay_content?: string;
    };
    metadata?: {
        login_footer?: string;
        auth_logo_position?: string;
    };
}
```

### `PromptSuggestion`

Default prompt suggestion for UI.

**Source:**
- Frontend Type: `open-webui/src/lib/stores/index.ts:293-296`
- Backend Usage: `open-webui/backend/open_webui/main.py:1971` (default_prompt_suggestions)

```typescript
{
    content: string;
    title: [string, string];  // [main_title, subtitle]
}
```

**Example:**
```json
{
    "content": "Tell me a joke",
    "title": ["Fun", "Tell me a joke"]
}
```

### `UserSettings`

User settings object stored in `user.settings` column as JSON. Flexible structure with intentionally minimal schema to allow dynamic properties.

**Source:**
- Backend Model: `open-webui/backend/open_webui/models/users.py:40-43` (UserSettings Pydantic model with `extra="allow"`)
- Backend Column: `open-webui/backend/open_webui/models/users.py:70` (SQLAlchemy JSON column)
- Frontend Type: `open-webui/src/lib/stores/index.ts:155-217` (Settings type definition)
- Backend API - Get: `open-webui/backend/open_webui/routers/users.py:272-285` (`GET /users/user/settings`)
- Backend API - Update: `open-webui/backend/open_webui/routers/users.py:297-326` (`POST /users/user/settings/update`)
- Frontend API: `open-webui/src/lib/apis/users/index.ts:247-301` (getUserSettings, updateUserSettings)

**Structure:**
```typescript
{
    // UI settings (60+ display, behavior, and preference properties)
    ui?: {
        // Notifications
        notifications?: {
            webhook_url?: string;  // Webhook URL for user notifications
        };

        // Tool configuration
        toolServers?: string[];    // Allowed tool server URLs (admin permission required)

        // Display settings
        detectArtifacts?: boolean;
        showUpdateToast?: boolean;
        showChangelog?: boolean;
        chatBubble?: boolean;
        highContrastMode?: boolean;
        textScale?: number;
        chatDirection?: 'LTR' | 'RTL' | 'auto';
        widescreenMode?: null;
        backgroundImageUrl?: null;
        landingPageMode?: string;
        showUsername?: boolean;
        showChatTitleInTab?: boolean;

        // Model configuration
        pinnedModels?: string[];   // Pinned model IDs
        models?: string[];          // Available model IDs

        // Chat parameters
        system?: string;            // Default system prompt
        temperature?: string;       // Default temperature
        seed?: number;              // Random seed
        repeat_penalty?: string;
        top_k?: string;
        top_p?: string;
        num_ctx?: string;           // Context window size
        num_batch?: string;
        num_keep?: string;
        params?: {
            stop?: string[];        // Stop sequences
        };

        // Feature toggles
        memory?: boolean;           // Conversation memory
        autoTags?: boolean;         // Automatic tagging
        autoFollowUps?: boolean;    // Auto-generate follow-up questions
        webSearch?: any;            // Web search settings
        userLocation?: any;         // User geolocation for {{USER_LOCATION}} template

        // Audio settings
        audio?: {
            stt?: any;              // Speech-to-text settings
            tts?: {
                engine?: string;
                playbackRate?: number;
                nonLocalVoices?: boolean;
                engineConfig?: {
                    dtype?: string;
                };
            };
            STTEngine?: string;
            TTSEngine?: string;
            speaker?: string;
            model?: string;
        };

        // Title generation
        title?: {
            auto?: boolean;         // Auto-generate chat titles
            model?: string;         // Model for title generation
            modelExternal?: string;
            prompt?: string;        // Custom title generation prompt
        };

        // Additional UI properties (60+ total in OWUI)
        // Full list includes: collapseCodeBlocks, expandDetails, notificationSound,
        // stylizedPdfExport, imageCompression, promptAutocomplete, hapticFeedback,
        // richTextInput, scrollOnBranchChange, copyFormatted, ctrlEnterToSend,
        // floatingActionButtons, voiceInterruption, conversationMode, etc.
        [key: string]: any;
    };

    // Function valves (user-specific function configurations)
    functions?: {
        valves?: {
            [functionId: string]: any;  // Per-function configuration
        };
    };

    // Tool valves (user-specific tool configurations)
    tools?: {
        valves?: {
            [toolId: string]: any;      // Per-tool configuration
        };
    };

    // Allow additional properties (matches backend ConfigDict(extra="allow"))
    [key: string]: any;
}
```

**Key Usage Examples:**

1. **Webhook Notifications**
   - Backend: `open-webui/backend/open_webui/models/users.py:501-517` (get_user_webhook_url_by_id)
   - Frontend: `open-webui/src/lib/components/chat/Settings/Account.svelte:52-58`
   - Used in: `open-webui/backend/open_webui/routers/channels.py:945-960` (send_notification)

2. **Tool Server Configuration**
   - Permission check: `open-webui/backend/open_webui/routers/users.py:309-316`
   - Requires `features.direct_tool_servers` permission for non-admin users
   - Stripped from updates if user lacks permission

3. **Function/Tool Valves**
   - Functions: `open-webui/backend/open_webui/models/functions.py:331-365`
   - Tools: `open-webui/backend/open_webui/models/tools.py:222-257`
   - User-specific configuration storage for functions and tools

4. **Settings Modal**
   - Frontend: `open-webui/src/lib/components/chat/SettingsModal.svelte:531-536`
   - Saves settings via `updateUserSettings(token, { ui: $settings })`

**Notes:**
- Flexible schema allows frontend to add new settings without backend changes
- Backend enforces permission controls on specific properties (e.g., `toolServers`)
- Stored as JSON in database, validated via Pydantic on backend
- Frontend stores settings in Svelte store and syncs to backend

---

## Example Responses

### Unauthenticated User (no users exist - onboarding)

```json
{
    "onboarding": true,
    "status": true,
    "name": "Open WebUI",
    "version": "0.3.9",
    "default_locale": "en-US",
    "oauth": {
        "providers": {}
    },
    "features": {
        "auth": true,
        "auth_trusted_header": false,
        "enable_signup": true,
        "enable_login_form": true,
        "enable_api_keys": false,
        "enable_websocket": false,
        "enable_version_update_check": true
    }
}
```

### Authenticated User (full config)

```json
{
    "status": true,
    "name": "Open WebUI",
    "version": "0.3.9",
    "default_locale": "en-US",
    "oauth": {
        "providers": {}
    },
    "features": {
        "auth": true,
        "auth_trusted_header": false,
        "enable_signup": true,
        "enable_login_form": true,
        "enable_api_keys": false,
        "enable_websocket": false,
        "enable_folders": true,
        "enable_web_search": true,
        "enable_image_generation": false,
        "enable_community_sharing": false,
        "enable_memories": false
    },
    "default_models": "gpt-4",
    "default_prompt_suggestions": [
        {
            "content": "Help me brainstorm",
            "title": ["Creative", "Help me brainstorm"]
        }
    ],
    "user_count": 3,
    "code": {
        "engine": "python"
    },
    "audio": {
        "tts": {
            "engine": "openai",
            "voice": "alloy",
            "split_on": "punctuation"
        },
        "stt": {
            "engine": "openai"
        }
    },
    "file": {
        "max_size": 10485760,
        "max_count": 10,
        "image_compression": {
            "width": 1920,
            "height": 1080
        }
    },
    "permissions": {},
    "google_drive": {
        "client_id": "",
        "api_key": ""
    },
    "onedrive": {
        "client_id_personal": "",
        "client_id_business": "",
        "sharepoint_url": "",
        "sharepoint_tenant_id": ""
    },
    "ui": {},
    "license_metadata": null
}
```
