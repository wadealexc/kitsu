# Models API Specification

## Endpoints

**Context:** The Models API provides a hybrid system for managing AI models. Base models (actual GGUF files) are configured via backend config.json and managed by LlamaManager, while custom models (user-created configurations) are stored in the database.

**Architecture:**
- **Base Models**: Configured in `config.json`, managed by LlamaManager, NOT stored in database
  - Represent actual model files on disk with GGUF paths, mmproj, and runtime params
  - Configured by system admins, not editable via frontend/API
  - Always have `base_model_id = null` when returned from API
  - Source of truth is the filesystem + LlamaManager
- **Custom Models**: Stored in database, created/managed via frontend/API
  - User-created configurations that reference a base model by ID
  - Always have `base_model_id` set to a valid base model ID
  - Can override name, params, meta, and have access control
  - Stored in database with full CRUD operations

**Key Concepts:**
- **Access Control**: Custom models support granular read/write permissions via user_ids (base models are always visible to all users)
- **Active Status**: Custom models can be toggled active/inactive to control visibility
- **Validation**: Custom models must reference a valid base_model_id that exists in LlamaManager

---

### GET `/api/v1/models`

Get all accessible models for the current user. Returns models from multiple sources: base models from LlamaManager + custom models from database.

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
- _Our Implementation:_
  - **Base Models**: Retrieved from `LlamaManager.getAllModelNames()` (from config.json)
    - Always visible to all users (no access control)
    - Returned with `base_model_id = null`
  - **Custom Models**: Retrieved from database via `getCustomModels()`
    - Filtered by user access control (only accessible custom models returned)
    - Have `base_model_id` set to their base model reference
  - Merged and returned as single array
  - Response format: `{"data": [models]}` (OpenAI-compatible)
  - `refresh` query parameter currently ignored (no backend refresh implemented)

---

### GET `/api/v1/models/list`

Get paginated list of **custom models only** (from database) with filtering, searching, and sorting capabilities. Base models are NOT included in this endpoint.

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
- _Our Implementation:_
  - Returns **only custom models from database** (base models NOT included)
  - Used for model management UI where users create/edit custom model configurations
  - Each model includes `write_access` flag indicating if user can modify it
  - Filters results based on user permissions and access control settings
  - Admin users bypass access control and see all custom models
  - Uses `searchModels()` database operation with pagination
  - Pagination: 30 items per page (default)
  - Total count reflects all accessible custom models (not just current page)

---

### GET `/api/v1/models/base`

**Admin Only:** Get all base models from LlamaManager (backend-configured models from config.json).

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
- _Our Implementation:_
  - Returns base models from `LlamaManager.getAllModelNames()` (NOT from database)
  - These represent actual model files configured in config.json
  - Returned with `base_model_id = null`
  - Useful for admins to see what base models are available when creating custom models

---

### POST `/api/v1/models/create`

Create a new **custom model only** (stored in database). Cannot create base models via API.

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
  - Any authenticated user can create custom models
- _Our Implementation:_
  - Creates **custom models only** (stored in database)
  - `base_model_id` is **required** and must reference a valid base model from LlamaManager
  - Validates model ID length (must be ≤ 256 characters)
  - Returns 400 if ID already exists in database
  - Returns 400 if `base_model_id` doesn't exist in LlamaManager
  - Automatically sets `user_id` to creator
  - Automatically sets `created_at` and `updated_at` timestamps
  - Default `is_active` is `true` if not specified
  - Base models can only be configured via config.json (not via this endpoint)

---

### GET `/api/v1/models/model`

Get a specific model by ID. Checks both base models (LlamaManager) and custom models (database).

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
  - Access control: custom models check if user can read via `has_access()`, base models always accessible
- _Our Implementation:_
  - First checks LlamaManager for base model with this ID
  - If not found, checks database for custom model with this ID
  - Base models: always accessible, no access control
  - Custom models: Returns 404 if user lacks read access
  - Includes `write_access` flag (always false for base models, computed for custom models)
  - Returns `null` if model doesn't exist

---

### POST `/api/v1/models/model/toggle`

Toggle a **custom model's** active status (enable/disable). Cannot toggle base models.

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
  - Requires write access: user must be owner or have write permission
- _Our Implementation:_
  - Only works with custom models (stored in database)
  - Returns 404 if ID refers to a base model (base models cannot be toggled)
  - Returns 401 if user lacks write access
  - Toggles `is_active` field: `true` ↔ `false`
  - Updates `updated_at` timestamp
  - Common use case: temporarily hide custom models from selection without deleting

---

### POST `/api/v1/models/model/update`

Update a **custom model's** configuration. Cannot update base models.

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
  - Requires write access: user must be owner or have write permission
- _Our Implementation:_
  - Only works with custom models (stored in database)
  - Returns 404 if ID refers to a base model (base models configured via config.json)
  - Returns 400 if model not found in database
  - Returns 401 if user lacks write access
  - Cannot update `id` field (excluded from update)
  - Automatically updates `updated_at` timestamp
  - Can update: name, base_model_id, params, meta, access_control, is_active
  - Validates `base_model_id` exists in LlamaManager if changed

---

### POST `/api/v1/models/model/delete`

Delete a **custom model** from the database. Cannot delete base models.

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
  - Requires write access: user must be owner or have write permission
- _Our Implementation:_
  - Only works with custom models (stored in database)
  - Returns 404 if ID refers to a base model (base models cannot be deleted via API)
  - Returns 401 if user lacks write access
  - Returns `false` if model not found in database
  - Permanently removes custom model from database
  - No cascade delete - references to this model will break

---

### DELETE `/api/v1/models/delete/all`

**Admin Only:** Delete all **custom models** from the database. Does not affect base models.

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
- _Our Implementation:_
  - Returns 401 if user is not admin
  - Deletes ALL custom models from database with no filtering
  - Base models (from config.json) are NOT affected
  - Destructive operation - no undo
  - Use with extreme caution

---

### POST `/api/v1/models/sync`

**Admin Only:** Sync **custom models only** in database with incoming list. Does not affect base models.

#### Inputs

**Request Body:** [`SyncModelsForm`](#syncmodelsform)

#### Outputs

Response (200): Array of [`ModelModel`](#modelmodel) (synced custom models)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/models.py:289`
  - Method: `sync_models()`
  - Database: `ModelsTable.sync_models()` (line 442-472)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _Our Implementation:_
  - Synchronizes **custom models in database** with incoming list:
    - Updates existing custom models (matched by ID)
    - Inserts new custom models not in database
    - Deletes custom models in database but not in incoming list
  - Used for bulk custom model management (import/export, backup restore)
  - Base models (from config.json) are NOT affected
  - All incoming models must have `base_model_id` set
  - Validates that `base_model_id` references exist in LlamaManager
  - Preserves timestamps for existing models, generates new for inserts
  - Returns the complete synced custom model list

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
- `meta` - Metadata including profile image, description, capabilities
- `access_control` - Read/write permissions by user
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

Model parameters for chat completion and model configuration.

```typescript
{
    temperature?: number    // Sampling temperature (0.0-2.0)
    top_p?: number         // Nucleus sampling (0.0-1.0)
    top_k?: number         // Top-k sampling
    max_tokens?: number    // Maximum tokens to generate
    seed?: number          // Random seed for reproducibility
    [key: string]: any     // Additional model-specific parameters
}
```

**Required fields:** None (all optional)

**Notes:**
- All fields are optional
- Uses `passthrough()` to allow additional model-specific parameters
- Common across chat completion and model configuration
- Specific to the model or backend being used

---

### `ModelMeta`

Model metadata with profile image, description, and capabilities.

```typescript
{
    profile_image_url?: string | null;  // Default: "/static/favicon.png"
    description?: string | null;
    capabilities?: object | null;
    [key: string]: any;                  // additionalProperties: true
}
```

**Fields:**
- `profile_image_url` - URL or data:image for model avatar
- `description` - Human-readable model description
- `capabilities` - Object describing model capabilities (vision, function calling, etc.)
- Additional properties allowed for extensibility

---

### `AccessControl`

Access control structure for read/write permissions.

```typescript
{
    read?: {
        user_ids?: string[];
    };
    write?: {
        user_ids?: string[];
    };
}
```

**Behavior:**
- `null` access_control = public read access, no write access
- Empty arrays = no access for that permission level
- User has access if their ID is in user_ids
- Admin users bypass all access control checks

---

### `UserResponse`

User information included in model responses (referenced from User API).

```typescript
{
    id: string;
    name: string;
    email: string;
    role: UserRole;  // "admin" | "user" | "pending"
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
    order_by?: string;
    direction?: "asc" | "desc";
    page?: number;  // default: 1, min: 1
}
```

**Fields:**
- `query` - Search query to filter models by name/ID
- `view_option` - View filter option
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
