# User Management Routes

## Endpoints

**Context:** Core user management - CRUD operations, search, settings, permissions, profile.

These endpoints handle user account management, user search/listing, personal settings and info updates, permissions management, and profile operations. Supports both admin operations (manage any user) and user-specific operations (manage own account).

---

### GET `/api/v1/users/`

**Admin Only:** List users with pagination, filtering, and sorting. Returns users with their group IDs.

#### Inputs

**Query Parameters:** [`UserListQuery`](#userlistquery)

#### Outputs

Response (200): [`UserGroupIdsListResponse`](#usergroupidslistresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:58`
  - Method: `get_users()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Pagination: 30 items per page (`PAGE_ITEM_COUNT`)
  - Page is 1-indexed, clamped to minimum of 1
  - Fetches groups for all users in single query to avoid N+1 problem
  - Calls `Users.get_users()` with filter, skip, and limit parameters
  - Calls `Groups.get_groups_by_member_ids()` to batch-fetch group memberships

---

### GET `/api/v1/users/all`

**Admin Only:** Get all users without pagination. Returns basic user info for each user.

#### Inputs

None

#### Outputs

Response (200): [`UserInfoListResponse`](#userinfolistresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:105`
  - Method: `get_all_users()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Simply calls `Users.get_users()` with no filters or pagination
  - Returns all users in system
  - No group information included (unlike `/api/v1/users/`)

---

### GET `/api/v1/users/search`

Search users with pagination and filtering. Similar to list endpoint but available to all verified users.

#### Inputs

**Query Parameters:** [`UserListQuery`](#userlistquery)

#### Outputs

Response (200): [`UserInfoListResponse`](#userinfolistresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:113`
  - Method: `search_users()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Same pagination as list endpoint (30 items per page)
  - Available to all users, not just admins
  - No group information included in results

---

### GET `/api/v1/users/{user_id}`

Get detailed information about a specific user, including their active status and groups.

#### Inputs

**Path Parameters:**
- `user_id` (string, required) - User ID to retrieve

#### Outputs

Response (200): [`UserActiveResponse`](#useractiveresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:447`
  - Method: `get_user_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Special handling: if `user_id` starts with "shared-", extracts chat ID and resolves to chat owner's user ID
  - Fetches user's groups via `Groups.get_groups_by_member_id()`
  - Checks if user is active via `Users.is_user_active()`
  - Returns user data augmented with `groups` array and `is_active` boolean

---

### POST `/api/v1/users/{user_id}/update`

**Admin Only:** Update a user's profile, role, email, and optionally password. Special protections for primary admin.

#### Inputs

**Path Parameters:**
- `user_id` (string, required) - User ID to update

**Request Body:** [`UserUpdateForm`](#userupdateform)

#### Outputs

Response (200): [`UserModel`](#usermodel) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:554`
  - Method: `update_user_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - **Primary admin protection:** Prevents other admins from modifying the first user (primary admin)
  - **Primary admin role lock:** Primary admin cannot change their own role from "admin"
  - Email validation: checks if new email is already taken by another user
  - Password validation: if password provided, validates with `validate_password()`, hashes with bcrypt
  - Updates both `Auths` table (email, password) and `Users` table (role, name, email, profile_image_url)
  - Returns 403 if attempting to modify primary admin improperly

---

### DELETE `/api/v1/users/{user_id}`

**Admin Only:** Delete a user account. Cannot delete the primary admin.

#### Inputs

**Path Parameters:**
- `user_id` (string, required) - User ID to delete

#### Outputs

Response (200): `boolean` - Returns `true` if deletion successful

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:638`
  - Method: `delete_user_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - **Primary admin protection:** Cannot delete the first user (primary admin) - returns 403
  - Cascades deletion to related data (chats, sessions, etc.)
  - Returns boolean success status

---

### GET `/api/v1/users/user/settings`

Get the current authenticated user's settings (UI preferences, etc.).

#### Inputs

None

#### Outputs

Response (200): [`UserSettings`](#usersettings) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:278`
  - Method: `get_user_settings_by_session_user()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access their own settings (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Gets user from session token
  - Returns `user.settings` field from database
  - Returns 400 if user not found

---

### POST `/api/v1/users/user/settings/update`

Update the current authenticated user's settings.

#### Inputs

**Request Body:** [`UserSettings`](#usersettings)

#### Outputs

Response (200): [`UserSettings`](#usersettings)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:297`
  - Method: `update_user_settings_by_session_user()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can update their own settings (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - **Permission check:** If user is not admin and lacks `features.direct_tool_servers` permission, removes `toolServers` from `ui` settings
  - Updates settings via `Users.update_user_settings_by_id()`
  - Returns updated settings object

---

### GET `/api/v1/users/user/info`

Get the current authenticated user's custom info object (arbitrary JSON data).

#### Inputs

None

#### Outputs

Response (200): `object` (generic JSON object) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:388`
  - Method: `get_user_info_by_session_user()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access their own info (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Returns `user.info` field from database
  - Info is flexible JSON object - no strict schema
  - Returns 400 if user not found
- **⚠️ Frontend Usage:** NOT used by frontend - API function exists (`getUserInfo()`) but is never called

---

### POST `/api/v1/users/user/info/update`

Update the current authenticated user's custom info object.

#### Inputs

**Request Body:** `object` (generic JSON object)

#### Outputs

Response (200): `object` (generic JSON object) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:407`
  - Method: `update_user_info_by_session_user()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can update their own info (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Accepts any JSON object as form data
  - Updates `user.info` field via `Users.update_user_info_by_id()`
  - Returns updated info object

---

### GET `/api/v1/users/permissions`

Get the current authenticated user's computed permissions (workspace, sharing, chat, features, settings).

#### Inputs

None

#### Outputs

Response (200): [`UserPermissions`](#userpermissions)

**Note:** Schema not strictly defined in OpenAPI spec, but follows the UserPermissions structure.

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:155`
  - Method: `get_user_permissisions()` (note: typo in function name)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access their own permissions (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Calls `get_permissions()` with user ID and `request.app.state.config.USER_PERMISSIONS`
  - Computes final permissions by merging default permissions with user/group-specific overrides
  - Returns computed [`UserPermissions`](#userpermissions) structure
- **⚠️ Frontend Usage:** NOT used by frontend - no API wrapper function exists; permissions accessed via session user data (`$user?.permissions`) instead

---

### GET `/api/v1/users/default/permissions`

**Admin Only:** Get the default permissions template for new users. Used to configure what permissions new users receive upon registration.

#### Inputs

None

#### Outputs

Response (200): [`UserPermissions`](#userpermissions)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:244`
  - Method: `get_default_user_permissions()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Reads from `request.app.state.config.USER_PERMISSIONS` (app state config)
  - Returns structured permissions object with defaults for each category
  - Uses Pydantic models to ensure proper structure with default values

---

### POST `/api/v1/users/default/permissions`

**Admin Only:** Update the default permissions template for new users.

#### Inputs

**Request Body:** [`UserPermissions`](#userpermissions)

#### Outputs

Response (200): `object` (empty response)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:265`
  - Method: `update_default_user_permissions()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Updates `request.app.state.config.USER_PERMISSIONS` directly (app state, not database)
  - Uses `form_data.model_dump()` to convert Pydantic model to dict
  - Changes apply immediately to new user registrations

---

### GET `/api/v1/users/{user_id}/profile/image`

Get a user's profile image. Returns either a redirect (for HTTP URLs), streaming image data (for data URIs), or the default user.png fallback.

#### Inputs

**Path Parameters:**
- `user_id` (string, required) - User ID whose profile image to retrieve

#### Outputs

- **302 Redirect:** If `profile_image_url` starts with "http"
  - Headers: `Location: <url>`
- **200 Streaming Response:** If `profile_image_url` starts with "data:image"
  - Body: Decoded base64 image data
  - Headers: `Content-Type: <media-type>` (extracted from data URI), `Content-Disposition: inline`
- **200 File Response:** Fallback default image
  - Body: Static file `/static/user.png` (from STATIC_DIR)
  - Used when: profile_image_url is null/empty, or doesn't match http/data:image patterns, or data URI decode fails
- **400 Error:** If user not found

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/users.py:500`
  - Method: `get_user_profile_image_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access profile images (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - **Flow:**
    1. Look up user by ID
    2. If user not found: return 400 error (NOT 404)
    3. Check `user.profile_image_url`:
       - If starts with "http": return 302 redirect to URL
       - If starts with "data:image": parse data URI, decode base64, stream image with correct Content-Type
       - Otherwise (null, empty, or other format): return default user.png file
    4. If data URI parsing fails: silently fall through to default user.png
  - **Data URI parsing:**
    - Split on first comma: `header, base64_data = url.split(",", 1)`
    - Extract media type from header: `header.split(";")[0].lstrip("data:")`
    - Decode base64 data
    - Stream as `StreamingResponse` with extracted media type
  - **Fallback behavior:** Never fails with 404 for missing/invalid images - always returns either redirect, image data, or default fallback
  - **Error handling:** Only returns 400 if user doesn't exist; all other issues fall back to default image

---

## Definitions

### `UserListQuery`

Query parameters for user list and search endpoints.

```typescript
{
    query?: string       // Search query to filter users
    order_by?: string    // Field to order results by
    direction?: 'asc' | 'desc'  // Sort direction
    page?: number        // Page number for pagination (default: 1, min: 1)
}
```

**Required fields:** None (all optional)

**Defaults:** `page` defaults to 1

**Notes:**
- `page` is 1-indexed and clamped to minimum of 1
- Used by both admin list endpoint and user search endpoint
- Pagination uses 30 items per page

---

### `UserGroupIdsListResponse`

```typescript
{
    users: UserGroupIdsModel[]  // Array of users with their group IDs
    total: number                // Total count of users (for pagination)
}
```

**Required fields:** `users`, `total`

---

### `UserGroupIdsModel`

Extends [`UserModel`](#usermodel) with an additional `group_ids` field.

```typescript
{
    // All fields from UserModel, plus:
    group_ids: string[]  // Array of group IDs user belongs to (default: [])
}
```

**Required fields:** Same as `UserModel` (id, email, name, profile_image_url, last_active_at, updated_at, created_at)

---

### `UserInfoListResponse`

```typescript
{
    users: UserInfoResponse[]  // Array of basic user info
    total: number              // Total count of users (for pagination)
}
```

**Required fields:** `users`, `total`

---

### `UserInfoResponse`

Basic user information (subset of UserModel).

```typescript
{
    id: string                    // User ID
    name: string                  // Display name
    email: string                 // Email address
    role: string                  // User role (e.g., "user", "admin", "pending")
    status_emoji?: string         // Optional status emoji
    status_message?: string       // Optional status message
    status_expires_at?: number    // Optional status expiration (unix timestamp)
}
```

**Required fields:** `id`, `name`, `email`, `role`

**Optional fields:** `status_emoji`, `status_message`, `status_expires_at`

---

### `UserActiveResponse`

User information with active status and group memberships.

```typescript
{
    name: string                  // Display name
    profile_image_url?: string    // Profile image URL or data URI
    groups?: object[]             // Array of groups (default: [])
    is_active: boolean            // Whether user is currently active
    status_emoji?: string         // Optional status emoji
    status_message?: string       // Optional status message
    status_expires_at?: number    // Optional status expiration (unix timestamp)
}
```

**Required fields:** `name`, `is_active`

**Optional fields:** `profile_image_url`, `groups`, `status_emoji`, `status_message`, `status_expires_at`

**Notes:** This response uses `additionalProperties: true`, so may include other user fields.

---

### `UserModel`

Complete user object with all fields.

```typescript
{
    id: string                          // User ID (CUID)
    email: string                       // Email address
    username?: string                   // Optional username
    role: string                        // User role (default: "pending")
    name: string                        // Display name
    profile_image_url: string           // Profile image URL or data URI
    profile_banner_image_url?: string   // Optional banner image URL
    bio?: string                        // Optional biography
    gender?: string                     // Optional gender
    date_of_birth?: string              // Optional date of birth (ISO date format)
    timezone?: string                   // Optional timezone
    presence_state?: string             // Optional presence (e.g., "online", "away")
    status_emoji?: string               // Optional status emoji
    status_message?: string             // Optional status message
    status_expires_at?: number          // Optional status expiration (unix timestamp)
    info?: object                       // Optional custom info object (flexible JSON)
    settings?: UserSettings             // Optional user settings
    oauth?: object                      // Optional OAuth connection data
    last_active_at: number              // Last activity timestamp (unix seconds)
    updated_at: number                  // Last update timestamp (unix seconds)
    created_at: number                  // Creation timestamp (unix seconds)
}
```

**Required fields:** `id`, `email`, `name`, `profile_image_url`, `last_active_at`, `updated_at`, `created_at`

**Optional fields:** `username`, `profile_banner_image_url`, `bio`, `gender`, `date_of_birth`, `timezone`, `presence_state`, `status_emoji`, `status_message`, `status_expires_at`, `info`, `settings`, `oauth`

**Defaults:** `role` defaults to "pending"

---

### `UserUpdateForm`

Form data for updating a user (admin operation).

```typescript
{
    role: string               // User role to set
    name: string               // Display name
    email: string              // Email address
    profile_image_url: string  // Profile image URL or data URI
    password?: string          // Optional new password (hashed if provided)
}
```

**Required fields:** `role`, `name`, `email`, `profile_image_url`

**Optional fields:** `password`

**Notes:** If password is provided, it will be validated and hashed before storage.

---

### `UserSettings`

User-specific settings (UI preferences, etc.).

```typescript
{
    ui?: object  // Optional UI settings object (flexible JSON, default: {})
}
```

**Required fields:** None

**Optional fields:** `ui`

**Notes:**
- Uses `additionalProperties: true`, so can include arbitrary settings
- `ui` object structure is flexible - frontend-specific
- Non-admin users cannot set `ui.toolServers` without permission

---

### `UserPermissions`

Complete permissions structure for a user.

```typescript
{
    workspace: WorkspacePermissions    // Workspace management permissions
    sharing: SharingPermissions        // Sharing/public access permissions
    chat: ChatPermissions              // Chat feature permissions
    features: FeaturesPermissions      // Feature toggle permissions
    settings: SettingsPermissions      // Settings access permissions
}
```

**Required fields:** `workspace`, `sharing`, `chat`, `features`, `settings`

---

### `WorkspacePermissions`

Permissions for workspace/admin panel access.

```typescript
{
    models: boolean           // Access to models management (default: false)
    knowledge: boolean        // Access to knowledge base (default: false)
    prompts: boolean          // Access to prompts (default: false)
    tools: boolean            // Access to tools (default: false)
    models_import: boolean    // Can import models (default: false)
    models_export: boolean    // Can export models (default: false)
    prompts_import: boolean   // Can import prompts (default: false)
    prompts_export: boolean   // Can export prompts (default: false)
    tools_import: boolean     // Can import tools (default: false)
    tools_export: boolean     // Can export tools (default: false)
}
```

**Required fields:** None (all have defaults)

---

### `SharingPermissions`

Permissions for sharing content publicly or with others.

```typescript
{
    models: boolean           // Can share models privately (default: false)
    public_models: boolean    // Can share models publicly (default: false)
    knowledge: boolean        // Can share knowledge privately (default: false)
    public_knowledge: boolean // Can share knowledge publicly (default: false)
    prompts: boolean          // Can share prompts privately (default: false)
    public_prompts: boolean   // Can share prompts publicly (default: false)
    tools: boolean            // Can share tools privately (default: false)
    public_tools: boolean     // Can share tools publicly (default: true)
    notes: boolean            // Can share notes privately (default: false)
    public_notes: boolean     // Can share notes publicly (default: true)
}
```

**Required fields:** None (all have defaults)

---

### `ChatPermissions`

Permissions for chat features and controls.

```typescript
{
    controls: boolean            // Access to chat controls (default: true)
    valves: boolean              // Access to valves configuration (default: true)
    system_prompt: boolean       // Can edit system prompt (default: true)
    params: boolean              // Can edit model parameters (default: true)
    file_upload: boolean         // Can upload files (default: true)
    delete: boolean              // Can delete chats (default: true)
    delete_message: boolean      // Can delete messages (default: true)
    continue_response: boolean   // Can continue response (default: true)
    regenerate_response: boolean // Can regenerate response (default: true)
    rate_response: boolean       // Can rate responses (default: true)
    edit: boolean                // Can edit chats (default: true)
    share: boolean               // Can share chats (default: true)
    export: boolean              // Can export chats (default: true)
    stt: boolean                 // Can use speech-to-text (default: true)
    tts: boolean                 // Can use text-to-speech (default: true)
    call: boolean                // Can use calling features (default: true)
    multiple_models: boolean     // Can use multiple models (default: true)
    temporary: boolean           // Can create temporary chats (default: true)
    temporary_enforced: boolean  // Temporary chats enforced (default: false)
}
```

**Required fields:** None (all have defaults)

---

### `FeaturesPermissions`

Permissions for specific features.

```typescript
{
    api_keys: boolean          // Can manage API keys (default: false)
    notes: boolean             // Can use notes (default: true)
    channels: boolean          // Can use channels (default: true)
    folders: boolean           // Can use folders (default: true)
    direct_tool_servers: boolean // Can configure tool servers (default: false)
    web_search: boolean        // Can use web search (default: true)
    image_generation: boolean  // Can generate images (default: true)
    code_interpreter: boolean  // Can use code interpreter (default: true)
    memories: boolean          // Can use memories (default: true)
}
```

**Required fields:** None (all have defaults)

---

### `SettingsPermissions`

Permissions for settings access.

```typescript
{
    interface: boolean  // Can access interface settings (default: true)
}
```

**Required fields:** None (all have defaults)
