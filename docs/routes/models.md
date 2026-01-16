# Models API Specification

## Endpoints

**Context:** The Models API provides a registry system for managing AI models available in the application. Models in OpenWebUI (and our implementation) serve as metadata entries that can either represent actual models (base models with `base_model_id = null`) or act as proxies/aliases to base models (with `base_model_id` set to another model's ID).

**Key Concepts:**
- **Base Models**: Models with `base_model_id = null` - these represent actual AI models (from llama.cpp, Ollama, OpenAI, etc.)
- **Custom/Proxy Models**: Models with `base_model_id` set - these are user-created entries that reference a base model with custom configurations
- **Access Control**: Models support granular read/write permissions via group_ids and user_ids
- **Model Tags**: Models can have tags (stored in `meta.tags`) for categorization
- **Active Status**: Models can be toggled active/inactive to control visibility

---

### GET `/api/v1/models`

Get all accessible models for the current user. Returns models from multiple sources (base models from backends + custom models from registry) with optional refresh.

#### Inputs

**Query Parameters:** [`ModelsQuery`](#modelsquery)

#### Outputs

Response (200): OpenAI-compatible format `{"data": [models]}`

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/main.py:1470`
  - Method: `get_models()`
  - Also uses: `/home/fox/open-webui/backend/open_webui/utils/models.py:get_all_models()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Aggregates models from OpenAI, Ollama, and custom models registry
  - Filters out "filter" pipeline types from results
  - Removes `profile_image_url` from meta to reduce payload size
  - Merges and deduplicates tags from `info.meta.tags` and `tags` fields
  - Sorts models by `MODEL_ORDER_LIST` config if configured
  - Respects user access control via `get_filtered_models()` - only returns models user can access
  - When `refresh=true`, fetches fresh data from connected backends
  - Response format: `{"data": [models]}` (OpenAI-compatible)
  - **Note:** Marked as "Experimental: Compatibility with OpenAI API" in codebase

---

### GET `/api/v1/models/list`

Get paginated list of custom models with filtering, searching, and sorting capabilities.

#### Inputs

**Query Parameters:** [`ModelListQuery`](#modellistquery)

#### Outputs

Response (200): [`ModelAccessListResponse`](#modelaccesslistresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:55`
  - Method: `get_models()`
  - Database: `ModelsTable.search_models()` (line 267-385)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Returns only custom models (those with `base_model_id != null`) from registry
  - Each model includes `write_access` flag indicating if user can modify it
  - Filters results based on user's group membership and access control settings
  - Admin users bypass access control and see all models
  - Pagination: 30 items per page (PAGE_ITEM_COUNT constant)
  - Total count reflects all accessible models (not just current page)

---

### GET `/api/v1/models/base`

**Admin Only:** Get all base models (models representing actual AI models, not proxies).

#### Inputs

None

#### Outputs

Response (200): Array of [`ModelResponse`](#modelresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:115`
  - Method: `get_base_models()`
  - Database: `ModelsTable.get_base_models()` (line 232-241)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Returns only models where `base_model_id = null`
  - These represent the actual models available from backends (not user-created proxies)

---

### GET `/api/v1/models/tags`

Get all unique model tags from accessible models.

#### Inputs

None

#### Outputs

Response (200): Array of strings

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:127`
  - Method: `get_model_tags()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access (`get_verified_user` dependency)
- _OWUI Implementation Notes:_
  - Extracts unique tags from `meta.tags` field across all accessible models
  - Admin users see tags from all models
  - Regular users only see tags from models they have access to
  - Returns deduplicated, sorted list of tag strings
  - Tags are stored as array in model metadata: `meta: { tags: ["tag1", "tag2"] }`

---

### POST `/api/v1/models/create`

Create a new custom model entry in the registry.

#### Inputs

**Request Body:** [`ModelForm`](#modelform)

#### Outputs

Response (200): [`ModelModel`](#modelmodel) or `null` on failure

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:153`
  - Method: `create_new_model()`
  - Database: `ModelsTable.insert_new_model()` (line 169-183)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Requires `workspace.models` permission via `has_permission()` check
- _OWUI Implementation Notes:_
  - Validates model ID length (must be ≤ 256 characters)
  - Returns 401 with MODEL_ID_TAKEN error if ID already exists
  - Automatically sets `user_id` to creator
  - Automatically sets `created_at` and `updated_at` timestamps
  - If `base_model_id` is null, creates a base model; otherwise creates a proxy/alias
  - Default `is_active` is `true` if not specified

---

### GET `/api/v1/models/model`

Get a specific model by ID with access control validation.

#### Inputs

**Query Parameters:** [`ModelIdQuery`](#modelidquery)

#### Outputs

Response (200): [`ModelAccessResponse`](#modelaccessresponse) or `null` if not found/no access

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:309`
  - Method: `get_model_by_id()`
  - Database: `ModelsTable.get_model_by_id()` (line 243-253)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access (`get_verified_user` dependency)
  - Access control: checks if user can read the model via `has_access()`
- _OWUI Implementation Notes:_
  - Returns 404 if model not found or user lacks read access
  - Admin users bypass access control checks
  - Includes `write_access` flag indicating if user can modify the model
  - Joins with User table to include owner information
  - Returns `null` if model doesn't exist (not a 404 error)

---

### POST `/api/v1/models/model/toggle`

Toggle a model's active status (enable/disable).

#### Inputs

**Query Parameters:** [`ModelIdQuery`](#modelidquery)

#### Outputs

Response (200): Updated [`ModelResponse`](#modelresponse) or `null` on failure

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:389`
  - Method: `toggle_model_by_id()`
  - Database: `ModelsTable.toggle_model_by_id()` (line 406-419)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Requires write access: user must be owner, have write permission, or be admin
- _OWUI Implementation Notes:_
  - Returns 401 UNAUTHORIZED if user lacks write access
  - Toggles `is_active` field: `true` ↔ `false`
  - Updates `updated_at` timestamp
  - Common use case: temporarily hide models from user selection without deleting

---

### POST `/api/v1/models/model/update`

Update a model's configuration (name, params, meta, access control, etc.).

#### Inputs

**Request Body:** [`ModelForm`](#modelform)

#### Outputs

Response (200): Updated [`ModelModel`](#modelmodel) or `null` on failure

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:426`
  - Method: `update_model_by_id()`
  - Database: `ModelsTable.update_model_by_id()` (line 421-439)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Requires write access: user must be owner, have write permission, or be admin
- _OWUI Implementation Notes:_
  - Returns 400 if model not found
  - Returns 401 if user lacks write access
  - Cannot update `id` field (excluded from update)
  - Automatically updates `updated_at` timestamp
  - Can update: name, base_model_id, params, meta, access_control, is_active

---

### POST `/api/v1/models/model/delete`

Delete a specific model from the registry.

#### Inputs

**Request Body:** [`ModelIdForm`](#modelidform)

#### Outputs

Response (200): `boolean` - Returns `true` if deleted, `false` otherwise

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:460`
  - Method: `delete_model_by_id()`
  - Database: `ModelsTable.delete_model_by_id()` (line 474-481)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Requires write access: user must be owner, have write permission, or be admin
- _OWUI Implementation Notes:_
  - Returns 401 if user lacks write access
  - Returns `false` if model not found (not an error)
  - Permanently removes model from database
  - No cascade delete - references to this model will break

---

### DELETE `/api/v1/models/delete/all`

**Admin Only:** Delete all models from the registry.

#### Inputs

None

#### Outputs

Response (200): `boolean` - Returns `true` on success

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:487`
  - Method: `delete_all_models()`
  - Database: `ModelsTable.delete_all_models()` (line 483-491)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Returns 401 if user is not admin
  - Deletes ALL models from database with no filtering
  - Destructive operation - no undo
  - Use with extreme caution

---

### POST `/api/v1/models/sync`

**Admin Only:** Sync models list with incoming data (update existing, insert new, delete removed).

#### Inputs

**Request Body:** [`SyncModelsForm`](#syncmodelsform)

#### Outputs

Response (200): Array of [`ModelModel`](#modelmodel) (synced models)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:289`
  - Method: `sync_models()`
  - Database: `ModelsTable.sync_models()` (line 442-472)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Synchronizes database with incoming models list:
    - Updates existing models (matched by ID)
    - Inserts new models not in database
    - Deletes models in database but not in incoming list
  - Used for bulk model management and backend synchronization
  - Preserves timestamps for existing models, generates new for inserts
  - Returns the complete synced model list

---

## Definitions

### `ModelAccessListResponse`

Paginated list response for models with total count.

```typescript
{
    items: ModelAccessResponse[];
    total: number;
}
```

**Fields:**
- `items` - Array of models with access information
- `total` - Total count of accessible models (not just current page)

---

### `ModelAccessResponse`

Extended model response with user information and write access flag.

```typescript
{
    id: string;
    user_id: string;
    base_model_id: string | null;
    name: string;
    params: ModelParams;
    meta: ModelMeta;
    access_control: AccessControl | null;
    is_active: boolean;
    updated_at: number;  // Unix timestamp (seconds)
    created_at: number;  // Unix timestamp (seconds)
    user: UserResponse | null;
    write_access: boolean;
}
```

**Fields:**
- `id` - Unique model identifier (max 256 chars)
- `user_id` - Owner user ID
- `base_model_id` - If null, this is a base model; otherwise references another model
- `name` - Display name
- `params` - Model-specific parameters (JSON object)
- `meta` - Metadata including profile image, description, capabilities, tags
- `access_control` - Read/write permissions by user/group
- `is_active` - Whether model is active/visible
- `updated_at` - Last update timestamp (Unix seconds)
- `created_at` - Creation timestamp (Unix seconds)
- `user` - Owner user information (joined from User table)
- `write_access` - Boolean flag indicating if current user can modify this model

---

### `ModelResponse`

Standard model response without access flags.

```typescript
{
    id: string;
    user_id: string;
    base_model_id: string | null;
    name: string;
    params: ModelParams;
    meta: ModelMeta;
    access_control: AccessControl | null;
    is_active: boolean;
    updated_at: number;
    created_at: number;
}
```

**Same as [`ModelAccessResponse`](#modelaccessresponse) but without:**
- `user` field
- `write_access` field

---

### `ModelModel`

Database model representation (same as [`ModelResponse`](#modelresponse)).

```typescript
{
    id: string;
    user_id: string;
    base_model_id: string | null;
    name: string;
    params: ModelParams;
    meta: ModelMeta;
    access_control: AccessControl | null;
    is_active: boolean;
    updated_at: number;
    created_at: number;
}
```

---

### `ModelForm`

Request form for creating or updating a model.

```typescript
{
    id: string;                           // Required
    base_model_id?: string | null;        // Optional
    name: string;                         // Required
    meta: ModelMeta;                      // Required
    params: ModelParams;                  // Required
    access_control?: AccessControl | null; // Optional
    is_active?: boolean;                  // Optional, default: true
}
```

**Validation:**
- `id` must be ≤ 256 characters
- `id` must be unique (checked on create)

---

### `ModelIdForm`

Simple form containing just a model ID.

```typescript
{
    id: string;  // Required
}
```

**Used for:**
- Delete operations
- Single-ID operations

---

### `ModelsImportForm`

Form for importing multiple models.

```typescript
{
    models: object[];  // Array of model objects (additionalProperties: true)
}
```

**Notes:**
- Models array contains arbitrary objects (flexible schema)
- Used for bulk import/restore operations

---

### `SyncModelsForm`

Form for syncing model list.

```typescript
{
    models: ModelModel[];  // Array of ModelModel objects, default: []
}
```

**Notes:**
- Used by sync endpoint to reconcile database with incoming list

---

### `ModelParams`

Model-specific parameters (flexible JSON object).

```typescript
{
    [key: string]: any;  // additionalProperties: true
}
```

**Notes:**
- Flexible schema - can contain any parameters
- Common fields might include: temperature, max_tokens, top_p, etc.
- Specific to the model or backend being used

---

### `ModelMeta`

Model metadata with profile image, description, and capabilities.

```typescript
{
    profile_image_url?: string | null;  // Default: "/static/favicon.png"
    description?: string | null;
    capabilities?: object | null;
    tags?: string[];                     // Array of tag strings
    [key: string]: any;                  // additionalProperties: true
}
```

**Fields:**
- `profile_image_url` - URL or data:image for model avatar
- `description` - Human-readable model description
- `capabilities` - Object describing model capabilities (vision, function calling, etc.)
- `tags` - Array of category tags
- Additional properties allowed for extensibility

---

### `AccessControl`

Access control structure for read/write permissions.

```typescript
{
    read?: {
        group_ids?: string[];
        user_ids?: string[];
    };
    write?: {
        group_ids?: string[];
        user_ids?: string[];
    };
}
```

**Behavior:**
- `null` access_control = public read access, no write access
- Empty arrays = no access for that permission level
- User has access if their ID is in user_ids OR their group is in group_ids
- Admin users bypass all access control checks

---

### `UserResponse`

User information included in model responses (referenced from User API).

```typescript
{
    id: string;
    name: string;
    email: string;
    role: string;  // "admin" | "user" | "pending"
    profile_image_url: string;
}
```

**Note:** Full schema defined in users.md specification.

---

### `ModelsQuery`

Query parameters for GET `/api/v1/models`.

```typescript
{
    refresh?: boolean;  // default: false
}
```

**Fields:**
- `refresh` - If true, refreshes model list from backends before returning

---

### `ModelListQuery`

Query parameters for GET `/api/v1/models/list`.

```typescript
{
    query?: string;
    view_option?: string;
    tag?: string;
    order_by?: string;
    direction?: "asc" | "desc";
    page?: number;  // default: 1, min: 1
}
```

**Fields:**
- `query` - Search query to filter models by name/ID
- `view_option` - View filter option
- `tag` - Filter by specific tag
- `order_by` - Field to sort by (e.g., "name", "created_at", "updated_at")
- `direction` - Sort direction: "asc" or "desc"
- `page` - Page number for pagination

---

### `ModelIdQuery`

Query parameters for GET `/api/v1/models/model` and POST `/api/v1/models/model/toggle`.

```typescript
{
    id: string;
}
```

**Fields:**
- `id` - Model ID to retrieve or toggle
