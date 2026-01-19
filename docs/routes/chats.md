# Chat Routes

## Endpoints

**Context:** Core chat functionality - CRUD operations, sharing, folders, messages, usage stats, and chat completion API.

These endpoints handle chat conversation management including creation, retrieval, updates, deletion, sharing with public links, organization (folders), message editing, cloning, and usage statistics. Also includes the main chat completion API for AI interactions.

---

## Chat List & Retrieval

### GET `/api/v1/chats/`

List current user's chats with pagination. Returns minimal chat info (ID, title, timestamps).

#### Inputs

**Query Parameters:** [`ChatListQuery`](#chatlistquery)

#### Outputs

Response (200): [`ChatTitleIdResponse[]`](#chattitleidresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:47`
  - Method: `get_session_user_chat_list()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access their own chats (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Pagination: 60 items per page
  - If `page` is null/not provided, returns all chats (no pagination)
  - Calls `Chats.get_chat_title_id_list_by_user_id()` with skip/limit
  - Returns only basic chat metadata (no messages)

---

### GET `/api/v1/chats/list`

Alias for `GET /api/v1/chats/` - identical functionality.

#### Inputs

**Query Parameters:** [`ChatListQuery`](#chatlistquery)

#### Outputs

Response (200): [`ChatTitleIdResponse[]`](#chattitleidresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:48`
  - Method: `get_session_user_chat_list()` (same handler as above)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access their own chats
- _OWUI Implementation Notes:_
  - Exact same implementation as `GET /api/v1/chats/`
  - Both endpoints decorated on same function

---

### GET `/api/v1/chats/all`

Get all chats for the current user with full chat data including messages.

#### Inputs

None

#### Outputs

Response (200): [`ChatResponse[]`](#chatresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:740`
  - Method: `get_user_chats()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access their own chats (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Calls `Chats.get_chats_by_user_id(user.id, db=db)` - filtered to current user only
  - Returns full chat objects including messages (not just titles/IDs)
  - No pagination - returns all chats for the user
  - Returns `result.items` from the database query

---

### GET `/api/v1/chats/all/db`

**Admin Only:** Export ALL chats from ALL users in the database. Used for system-wide data export/backup.

#### Inputs

None

#### Outputs

Response (200): [`ChatResponse[]`](#chatresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:787`
  - Method: `get_all_user_chats_in_db()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - **Admin only** (`get_admin_user` dependency)
  - Also requires `ENABLE_ADMIN_EXPORT` config flag to be enabled (default: true)
  - Returns 401 if `ENABLE_ADMIN_EXPORT` is disabled
- _OWUI Implementation Notes:_
  - **Critical:** Calls `Chats.get_chats(db=db)` with NO user_id filter
  - Returns chats from **ALL users** in the system (not just current user)
  - Used for admin data export/backup purposes
  - This is materially different from `/api/v1/chats/all` which only returns current user's chats

---

### GET `/api/v1/chats/{id}`

Get a specific chat by ID including full messages and metadata.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:927`
  - Method: `get_chat_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only access their own chats
- _OWUI Implementation Notes:_
  - Calls `Chats.get_chat_by_id_and_user_id()` to verify ownership
  - Returns 401 if chat not found or user doesn't own it
  - Returns full chat object with messages

---

### GET `/api/v1/chats/list/user/{user_id}`

**Admin Only:** Get chats for a specific user. Used for admin viewing/managing other users' chats.

#### Inputs

**Path Parameters:**
- `user_id` (string, required) - User ID whose chats to retrieve

**Query Parameters:** [`UserChatListQuery`](#userchatlistquery)

#### Outputs

Response (200): [`ChatTitleIdResponse[]`](#chattitleidresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:557`
  - Method: `get_user_chat_list_by_user_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - **Admin only** (`get_admin_user` dependency)
  - Also requires `ENABLE_ADMIN_CHAT_ACCESS` config flag to be enabled (default depends on config)
  - Returns 401 if `ENABLE_ADMIN_CHAT_ACCESS` is disabled
- _OWUI Implementation Notes:_
  - Pagination: 60 items per page (same as other list endpoints)
  - Page defaults to 1 if not specified
  - Calls `Chats.get_chat_list_by_user_id()` with `include_archived=True`
  - **Includes archived chats** in results (unlike normal user list endpoint)
  - Supports filtering with query, order_by, and direction parameters
  - Returns minimal chat info (titles and IDs, not full messages)

---

## Chat Creation & Modification

### POST `/api/v1/chats/new`

Create a new chat conversation.

#### Inputs

**Request Body:** [`ChatForm`](#chatform)

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:597`
  - Method: `create_new_chat()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can create chats
- _OWUI Implementation Notes:_
  - Calls `Chats.insert_new_chat()` with user ID and form data
  - Returns created chat object
  - Automatically sets chat owner to current user

---

### POST `/api/v1/chats/{id}`

Update an existing chat by ID. Merges provided chat data with existing data.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID to update

**Request Body:** [`ChatForm`](#chatform)

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:947`
  - Method: `update_chat_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only update their own chats
- _OWUI Implementation Notes:_
  - Verifies chat ownership with `Chats.get_chat_by_id_and_user_id()`
  - Merges form data with existing chat using spread: `{**chat.chat, **form_data.chat}`
  - Returns 401 if user doesn't own the chat

---

### DELETE `/api/v1/chats/{id}`

Delete a specific chat by ID. **Admins can delete ANY chat; regular users can only delete their own chats.**

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID to delete

#### Outputs

Response (200): `boolean` - Returns `true` if deletion successful

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:1081`
  - Method: `delete_chat_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - **Admin behavior:** Admins can delete ANY chat in the system (no ownership check)
  - **Regular user behavior:** Users can only delete their own chats (filtered by user_id)
  - Regular users also need `chat.delete` permission (checked via `has_permission()`)
- _OWUI Implementation Notes:_
  - **Admin path:** Calls `Chats.delete_chat_by_id(id, db=db)` - deletes by ID only, no user filter
  - **User path:** Calls `Chats.delete_chat_by_id_and_user_id(id, user.id, db=db)` - requires ownership
  - Both paths clean up tags: if this was the last chat using a specific tag, deletes that tag
  - Returns 404 if chat not found
  - Returns 401 if regular user lacks `chat.delete` permission

---

### DELETE `/api/v1/chats/`

Delete all chats for the current user.

#### Inputs

None

#### Outputs

Response (200): `boolean` - Returns `true` if deletion successful

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:533`
  - Method: `delete_all_user_chats()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Only deletes current user's chats
- _OWUI Implementation Notes:_
  - Permanently deletes all chats owned by the requesting user
  - Cannot be undone

---

## Sharing & Cloning

### POST `/api/v1/chats/{id}/share`

Share a chat by generating a public share link. If already shared, updates the share timestamp.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID to share

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:1309`
  - Method: `share_chat_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User must own the chat
  - Requires `chat.share` permission (unless admin)
- _OWUI Implementation Notes:_
  - Checks permission via `has_permission(user.id, "chat.share", ...)`
  - If already shared (`chat.share_id` exists), updates share via `update_shared_chat_by_chat_id()`
  - If not shared, creates new share via `insert_shared_chat_by_chat_id()`
  - Returns chat with `share_id` populated

---

### GET `/api/v1/chats/share/{share_id}`

Get a shared chat by its public share ID. Allows anyone with the link to view the chat (read-only).

#### Inputs

**Path Parameters:**
- `share_id` (string, required) - Public share ID

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:870`
  - Method: `get_shared_chat_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Public access - any authenticated user can view shared chats
- _OWUI Implementation Notes:_
  - Looks up chat by share_id, not by chat id
  - Returns full chat data for read-only viewing

---

### DELETE `/api/v1/chats/{id}/share`

Unshare a chat by removing its public share link.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID to unshare

#### Outputs

Response (200): `boolean` or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:1353`
  - Method: `delete_shared_chat_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User must own the chat
- _OWUI Implementation Notes:_
  - Returns `false` if chat is not currently shared
  - Calls `Chats.delete_shared_chat_by_chat_id()` to remove share entry
  - Updates chat to set `share_id` to `null`
  - Returns success boolean

---

### POST `/api/v1/chats/{id}/clone/shared`

Clone a shared chat to the current user's account. Creates a copy of someone else's shared chat.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID to clone (must be shared)

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:1221`
  - Method: `clone_shared_chat_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can clone publicly shared chats
- _OWUI Implementation Notes:_
  - Chat must have a valid `share_id` (must be publicly shared)
  - Creates a new chat owned by the current user
  - Copies all messages and metadata

---

### POST `/api/v1/chats/{id}/clone`

Clone one of your own chats. Creates a duplicate with a new ID and optional new title.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID to clone

**Request Body:** [`CloneForm`](#cloneform)

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:1171`
  - Method: `clone_chat_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User must own the original chat
- _OWUI Implementation Notes:_
  - Verifies chat ownership
  - Creates a complete copy with new ID
  - Optionally sets a new title from form data

---

## Folder Organization

### POST `/api/v1/chats/{id}/folder`

Move a chat to a folder (or remove from folder by setting to null).

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID to move

**Request Body:** [`ChatFolderIdForm`](#chatfolderidform)

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:1382`
  - Method: `update_chat_folder_id_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User must own the chat
- _OWUI Implementation Notes:_
  - Verifies chat ownership
  - Updates `folder_id` field on chat
  - Pass `null` to remove chat from folder

---

### GET `/api/v1/chats/folder/{folder_id}`

Get all chats in a specific folder with full chat data.

#### Inputs

**Path Parameters:**
- `folder_id` (string, required) - Folder ID

#### Outputs

Response (200): [`ChatResponse[]`](#chatresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:676`
  - Method: `get_chats_by_folder_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only access their own folders/chats
- _OWUI Implementation Notes:_
  - Returns full chat objects (including messages)
  - Filters chats by folder_id and user_id

---

### GET `/api/v1/chats/folder/{folder_id}/list`

Get chat list for a specific folder with pagination (minimal data).

#### Inputs

**Path Parameters:**
- `folder_id` (string, required) - Folder ID

**Query Parameters:** [`FolderChatListQuery`](#folderchatlistquery)

#### Outputs

Response (200): [`FolderChatListItemResponse[]`](#folderchatlistitemresponse)

**Note:** Schema not defined in OpenAPI - we defined this based on actual response structure.

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:695`
  - Method: `get_chat_list_by_folder_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only access their own folders/chats (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - **Note:** Response schema not defined in OpenAPI spec
  - Pagination: 10 items per page (smaller than other list endpoints)
  - Page defaults to 1 if not specified
  - Calls `Chats.get_chats_by_folder_id_and_user_id()` - filters by both folder_id and user_id
  - Returns minimal chat info: only title, id, and updated_at (no created_at)
  - This is slightly different from `ChatTitleIdResponse` which includes created_at

---

## Message Operations

### POST `/api/v1/chats/{id}/messages/{message_id}`

Update the content of a specific message in a chat.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID
- `message_id` (string, required) - Message ID to update

**Request Body:** [`MessageForm`](#messageform)

#### Outputs

Response (200): [`ChatResponse`](#chatresponse) or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:973`
  - Method: `update_chat_message_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User must own the chat
- _OWUI Implementation Notes:_
  - Updates message content within chat's messages array
  - Returns updated full chat object
  - Used for editing messages after they're sent

---

### POST `/api/v1/chats/{id}/messages/{message_id}/event`

Send an event related to a message (e.g., typing indicators, reactions).

#### Inputs

**Path Parameters:**
- `id` (string, required) - Chat ID
- `message_id` (string, required) - Message ID

**Request Body:** [`EventForm`](#eventform)

#### Outputs

Response (200): `boolean` or `null`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:1036`
  - Method: `send_chat_message_event_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User must have access to the chat
- _OWUI Implementation Notes:_
  - Used for real-time events like typing indicators
  - Event type and data determined by form_data
  - Returns success boolean

---

## Statistics

### GET `/api/v1/chats/stats/usage`

Get usage statistics for the current user's chats (message counts, models used, response times, etc.).

#### Inputs

**Query Parameters:** [`ChatUsageStatsQuery`](#chatusagestatsquery)

#### Outputs

Response (200): [`ChatUsageStatsListResponse`](#chatusagestatslistresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/chats.py:89`
  - Method: `get_session_user_chat_usage_stats()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only access their own stats
- _OWUI Implementation Notes:_
  - **EXPERIMENTAL:** May be removed in future releases
  - Returns aggregated statistics per chat
  - Includes message counts, models used, response times, message lengths

---

## Chat Completion API

### POST `/api/v1/chat/completions`

Main chat completion API - send messages to AI and get responses. OpenAI-compatible endpoint. Also available at `/api/chat/completions` (without `/v1`).

#### Inputs

**Request Body:** `object` (flexible, OpenAI-compatible format with extensions)

**Key fields:**
- `model` (string) - Model ID to use
- `messages` (array) - Chat messages
- `stream` (boolean, optional) - Enable streaming response
- `chat_id` (string, optional) - Chat ID for persistence
- `id` (string, optional) - Message ID
- `tool_ids` (array, optional) - Tool IDs to enable
- `files` (array, optional) - File attachments
- `model_item` (object, optional) - Direct model configuration

#### Outputs

Response (200): `object` (flexible response)

**Streaming response:** Server-Sent Events (SSE)
**Non-streaming response:** JSON object
**Async response (with session_id):** `{ status: boolean, task_id: string }`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/main.py:1559`
  - Method: `chat_completion()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can use completions (`get_verified_user` dependency)
  - **Model access control:** Checks if user has access to requested model (unless `BYPASS_MODEL_ACCESS_CONTROL` enabled)
  - **Chat ownership verification:** If `chat_id` provided, verifies user owns the chat (admins can access any chat)
  - Admins bypass access control if `BYPASS_ADMIN_ACCESS_CONTROL` enabled
- _OWUI Implementation Notes:_
  - **This is the primary endpoint for AI interactions**
  - Also registered at `/api/chat/completions` (legacy path without `/v1`)
  - **OpenAI-compatible** but with extensions for tools, files, variables, etc.
  - Supports both streaming (SSE) and static JSON responses
  - **Asynchronous processing:** If `session_id`, `chat_id`, and `message_id` provided, creates background task and returns task_id
  - **Model fallback:** If base model not found and `ENABLE_CUSTOM_MODEL_FALLBACK` enabled, falls back to default model
  - **Tool calling:** Server-side tool execution (native or default mode)
  - **File handling:** Inserts chat files from parent message
  - **MCP client support:** Manages MCP client connections and cleanup
  - **Error handling:** Updates chat message with error if processing fails
  - Calls `process_chat_payload()` then `chat_completion_handler()` then `process_chat_response()`
  - Temporary chats (IDs starting with "local:") are not stored in database

---

### POST `/api/chat/completed`

Handle chat completion event. Called after chat generation finishes to trigger post-completion processing.

#### Inputs

**Request Body:** `object` (flexible)

**Key fields:**
- `model_item` (object, optional) - Direct model configuration

#### Outputs

Response (200): `object` (response from completion handler)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/main.py:1803`
  - Method: `chat_completed()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can use this endpoint (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - **Note:** No `/v1` variant exists - only `/api/chat/completed` (without `/v1` prefix)
  - Extracts `model_item` from form data
  - If model is direct, sets `request.state.direct = True` and `request.state.model`
  - Delegates to `chat_completed_handler(request, form_data, user)` for actual processing
  - Used to trigger post-completion hooks, update chat metadata, or handle completion-specific logic
  - Returns 400 if processing fails

---

## Definitions

### `ChatResponse`

Complete chat object with all fields including messages and metadata.

```typescript
{
    id: string                  // Chat ID
    user_id: string             // Owner's user ID
    title: string               // Chat title
    chat: object                // Chat data (messages, history) - flexible structure
    updated_at: number          // Last update timestamp (unix seconds)
    created_at: number          // Creation timestamp (unix seconds)
    share_id?: string           // Public share ID if shared (null if not shared)
    archived: boolean           // Whether chat is archived
    pinned?: boolean            // Whether chat is pinned (default: false)
    meta?: object               // Additional metadata (default: {})
    folder_id?: string          // Folder ID if organized (null if not in folder)
}
```

**Required fields:** `id`, `user_id`, `title`, `chat`, `updated_at`, `created_at`, `archived`

**Optional fields:** `share_id`, `pinned`, `meta`, `folder_id`

**Notes:**
- `chat` field contains the actual conversation messages and history
- `chat` structure is flexible and not strictly defined in the schema

---

### `ChatTitleIdResponse`

Minimal chat information for list views.

```typescript
{
    id: string          // Chat ID
    title: string       // Chat title
    updated_at: number  // Last update timestamp (unix seconds)
    created_at: number  // Creation timestamp (unix seconds)
}
```

**Required fields:** `id`, `title`, `updated_at`, `created_at`

**Notes:** Used for efficient list rendering without loading full chat content.

---

### `FolderChatListItemResponse`

Minimal chat information for folder list views (excludes created_at).

```typescript
{
    id: string          // Chat ID
    title: string       // Chat title
    updated_at: number  // Last update timestamp (unix seconds)
}
```

**Required fields:** `id`, `title`, `updated_at`

**Notes:**
- Used specifically for `GET /api/v1/chats/folder/{folder_id}/list` endpoint
- Similar to `ChatTitleIdResponse` but excludes `created_at` field
- Schema not defined in OpenAPI - we defined this based on actual OWUI response structure

---

### `ChatForm`

Form data for creating or updating chats.

```typescript
{
    chat: object        // Chat data object (flexible structure)
    folder_id?: string  // Optional folder ID to organize chat
}
```

**Required fields:** `chat`

**Optional fields:** `folder_id`

**Notes:**
- `chat` object structure is flexible
- Typically contains messages, model, system prompt, etc.

---

### `CloneForm`

Form data for cloning a chat with optional new title.

```typescript
{
    title?: string  // Optional new title for cloned chat
}
```

**Required fields:** None

**Optional fields:** `title`

**Notes:** If title not provided, cloned chat inherits original title.

---

### `ChatFolderIdForm`

Form data for moving a chat to a folder.

```typescript
{
    folder_id?: string  // Folder ID to move chat to (null to remove from folder)
}
```

**Required fields:** None

**Optional fields:** `folder_id`

**Notes:** Set to `null` to remove chat from its current folder.

---

### `MessageForm`

Form data for updating a message's content.

```typescript
{
    content: string  // New message content
}
```

**Required fields:** `content`

**Notes:** Simple schema - only updates the message text/content.

---

### `EventForm`

Form data for sending message events.

```typescript
{
    type: string  // Event type (e.g., "typing", "reaction")
    data: object  // Event data (flexible structure)
}
```

**Required fields:** `type`, `data`

**Notes:** Used for real-time features like typing indicators.

---

### `ChatUsageStatsListResponse`

Paginated list of chat usage statistics.

```typescript
{
    items: ChatUsageStatsResponse[]  // Array of stats objects
    total: number                     // Total count for pagination
}
```

**Required fields:** `items`, `total`

**Notes:** Uses `additionalProperties: true`, may include extra pagination metadata.

---

### `ChatUsageStatsResponse`

Detailed usage statistics for a single chat.

```typescript
{
    id: string                                    // Chat ID
    models?: object                               // Models used in current state (default: {})
    message_count: number                         // Current message count
    history_models?: object                       // Models used historically (default: {})
    history_message_count: number                 // Total historical message count
    history_user_message_count: number            // Historical user messages
    history_assistant_message_count: number       // Historical assistant messages
    average_response_time: number                 // Average AI response time (seconds)
    average_user_message_content_length: number   // Average user message length (chars)
    average_assistant_message_content_length: number  // Average assistant message length (chars)
    tags?: string[]                               // Associated tags (default: [])
    last_message_at: number                       // Last message timestamp (unix seconds)
    updated_at: number                            // Last update timestamp (unix seconds)
    created_at: number                            // Creation timestamp (unix seconds)
}
```

**Required fields:** `id`, `message_count`, `history_message_count`, `history_user_message_count`, `history_assistant_message_count`, `average_response_time`, `average_user_message_content_length`, `average_assistant_message_content_length`, `last_message_at`, `updated_at`, `created_at`

**Optional fields:** `models`, `history_models`, `tags`

**Notes:**
- Uses `additionalProperties: true`, may include extra computed statistics
- "History" fields include all-time data, while non-history fields may be for current session

---

### `ChatListQuery`

Query parameters for listing chats with pagination and filtering.

```typescript
{
    page?: number                    // Page number for pagination (60 items per page)
    include_pinned?: boolean         // Whether to include pinned chats (default: false)
    include_folders?: boolean        // Whether to include chats in folders (default: false)
}
```

**Required fields:** None

**Optional fields:** `page`, `include_pinned`, `include_folders`

**Notes:**
- If `page` is not provided, returns all chats (no pagination)
- Pagination: 60 items per page
- Defaults to excluding pinned chats and chats in folders (both default to false)

---

### `UserChatListQuery`

Query parameters for listing a specific user's chats (admin endpoint).

```typescript
{
    page?: number                    // Page number for pagination (60 items per page, default: 1)
    query?: string                   // Search query to filter chats
    order_by?: string               // Field to order results by
    direction?: "asc" | "desc"      // Sort direction
}
```

**Required fields:** None

**Optional fields:** `page`, `query`, `order_by`, `direction`

**Notes:**
- Admin-only endpoint
- Pagination: 60 items per page
- Includes archived chats (unlike normal user list endpoint)
- Page defaults to 1 if not specified

---

### `FolderChatListQuery`

Query parameters for listing chats in a specific folder with pagination.

```typescript
{
    page?: number  // Page number for pagination (10 items per page, default: 1)
}
```

**Required fields:** None

**Optional fields:** `page`

**Notes:**
- Pagination: 10 items per page (smaller than other list endpoints)
- Page defaults to 1 if not specified

---

### `ChatUsageStatsQuery`

Query parameters for retrieving chat usage statistics with pagination.

```typescript
{
    items_per_page?: number  // Items per page (default: 50)
    page?: number            // Page number for pagination (default: 1)
}
```

**Required fields:** None

**Optional fields:** `items_per_page`, `page`

**Notes:**
- Pagination: 50 items per page by default
- Both parameters default to standard values if not specified
- Used for experimental usage statistics endpoint
