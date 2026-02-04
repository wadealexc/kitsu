# Models Database Model

## Overview

The Models system stores metadata and configuration for AI models available in the application. Models can either represent actual AI models (base models) or act as custom configurations/aliases that reference base models (custom models).

**Key Concepts:**
- **Base Models** (`base_model_id = null`): Represent actual AI models from backends (llama.cpp, Ollama, OpenAI, etc.)
- **Custom Models** (`base_model_id != null`): User-created configurations that reference and customize base models
- **Access Control**: Granular read/write permissions via user_ids
- **Active Status**: Models can be toggled active/inactive to control visibility

References:
- _OWUI Implementation:_ `open-webui/backend/open_webui/models/models.py`
- _OWUI Router:_ `open-webui/backend/open_webui/routers/models.py`
- _OWUI Utils:_ `open-webui/backend/open_webui/utils/models.py`
- _OWUI Main:_ `open-webui/backend/open_webui/main.py` (get_models endpoint)
- _Our Route Spec:_ `/docs/routes/models.md`

---

## Table Schema

### Table Name: `model`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY, UNIQUE | Model ID (max 256 chars) - used in API calls |
| `user_id` | TEXT | NOT NULL, INDEX, FK → user(id) | Creator/owner user ID |
| `base_model_id` | TEXT | NULLABLE, INDEX | Base model reference; null = base model, non-null = custom model |
| `name` | TEXT | NOT NULL | Human-readable display name |
| `params` | JSON | NOT NULL | Model parameters (temperature, top_p, etc.) - see ModelParams |
| `meta` | JSON | NOT NULL | Model metadata (description, image, capabilities) - see ModelMeta |
| `access_control` | JSON | NULLABLE | Read/write permissions structure - see AccessControl |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT: true | Whether model is active/visible |
| `created_at` | BIGINT | NOT NULL, INDEX | Creation timestamp (unix seconds) |
| `updated_at` | BIGINT | NOT NULL, INDEX | Last update timestamp (unix seconds) |

### Indexes

```sql
-- Primary key and unique constraints
CREATE UNIQUE INDEX idx_model_id ON model(id);

-- User lookup (for filtering user's models)
CREATE INDEX idx_model_user_id ON model(user_id);

-- Base model lookup (for filtering base vs custom models)
CREATE INDEX idx_model_base_model_id ON model(base_model_id);

-- Active status filtering
CREATE INDEX idx_model_is_active ON model(is_active);

-- Composite index for common queries (user's custom models)
CREATE INDEX idx_model_user_base ON model(user_id, base_model_id);

-- Timestamp ordering (for sorting by creation/update time)
CREATE INDEX idx_model_created_at ON model(created_at);
CREATE INDEX idx_model_updated_at ON model(updated_at);

-- Composite for paginated list queries
CREATE INDEX idx_model_base_updated ON model(base_model_id, updated_at);
```

### Constraints

```sql
-- Foreign key
FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;

-- Model ID length validation (application level)
-- id must be <= 256 characters
```

**Cascade Behavior:**
- When a user is deleted, all their models are automatically deleted
- No FK constraint on `base_model_id` - allows flexible model references

### JSON Structures

#### ModelParams

The `params` column stores model-specific parameters for chat completion.

```typescript
{
    temperature?: number;    // Sampling temperature (0.0-2.0)
    top_p?: number;         // Nucleus sampling (0.0-1.0)
    top_k?: number;         // Top-k sampling
    max_tokens?: number;    // Maximum tokens to generate
    seed?: number;          // Random seed for reproducibility
    [key: string]: any;     // Additional model-specific parameters (extensible)
}
```

**Notes:**
- All fields are optional
- Uses passthrough to allow additional backend-specific parameters
- Common parameters standardized across backends

#### ModelMeta

The `meta` column stores model metadata and UI information.

```typescript
{
    profile_image_url?: string;  // Default: "/static/favicon.png"
    description?: string;        // User-facing description
    capabilities?: object;       // Model capabilities (vision, function calling, etc.)
    [key: string]: any;         // Additional extensible metadata
}
```

**Notes:**
- Flexible structure allows extensibility
- `profile_image_url` can be:
  - HTTP URL (external image)
  - `data:image/...` URI (embedded image)
  - Relative path (static asset)

#### AccessControl

The `access_control` column defines read/write permissions.

```typescript
{
    read?: {
        user_ids?: string[];    // Users with read access
    };
    write?: {
        user_ids?: string[];    // Users with write access
    };
}
```

**Access Control Behavior:**

| `access_control` Value | Read Access | Write Access |
|------------------------|-------------|--------------|
| `null` | Public (all users) | Owner only |
| `{}` | Owner only | Owner only |
| With `read`/`write` | Specified users | Specified users |

**Access Check Logic:**
1. Admin users bypass all access control (if `BYPASS_ADMIN_ACCESS_CONTROL` enabled)
2. Owner (user_id) always has read and write access
3. User has access if their user_id is in the permission's `user_ids` array
4. For `null` access_control: public read access, no write access (except owner)

---

## Operations

### Core CRUD Operations

#### `insertNewModel(data: ModelForm, userId: string): Promise<ModelModel | null>`

Creates a new model entry in the registry.

_Required fields:_
- `data.id` - Model ID (max 256 chars, must be unique)
- `data.name` - Display name
- `data.params` - Model parameters (can be empty object)
- `data.meta` - Model metadata (can be empty object)

_Optional fields:_
- `data.base_model_id` - Base model reference (null for base models)
- `data.access_control` - Access permissions (null for public read)
- `data.is_active` - Active status (default: true)

_Auto-generated fields:_
- `createdAt` - Current unix timestamp
- `updatedAt` - Current unix timestamp

_Validation:_
- Model ID must be <= 256 characters
- Model ID must be unique (check before insert)
- All JSON fields must be valid JSON

_Example:_
```typescript
const model = await insertNewModel({
    id: 'custom-gpt4',
    base_model_id: 'gpt-4-turbo',
    name: 'My Custom GPT-4',
    params: {
        temperature: 0.7,
        max_tokens: 2000
    },
    meta: {
        description: 'Custom GPT-4 configuration for coding'
    },
    access_control: {
        read: {
            user_ids: [userId, otherUserId]
        },
        write: {
            user_ids: [userId]
        }
    },
    is_active: true
}, userId);
```

#### `getAllModels(): Promise<ModelModel[]>`

_Admin only:_ Retrieves ALL models from the database (no filtering).

_Use case:_ System-wide model aggregation, admin views

_Notes:_
- Returns both base and custom models
- No access control filtering
- No pagination

#### `getCustomModels(): Promise<ModelUserResponse[]>`

Retrieves all custom models (models with `base_model_id != null`) with user information.

_Returns:_ Models joined with User table for owner information

_Use case:_ Custom models list with owner details

_Query:_
```sql
SELECT model.*, user.*
FROM model
LEFT JOIN user ON user.id = model.user_id
WHERE model.base_model_id IS NOT NULL;
```

#### `getBaseModels(): Promise<ModelModel[]>`

_Admin only:_ Retrieves all base models (models with `base_model_id = null`).

_Use case:_ Base model management, backend synchronization

_Query:_
```sql
SELECT * FROM model WHERE base_model_id IS NULL;
```

#### `getModelById(id: string): Promise<ModelModel | null>`

Retrieves a specific model by ID.

_Returns:_ Full model object or null if not found

_Use case:_ Model detail views, access control checks

#### `getModelsByIds(ids: string[]): Promise<ModelModel[]>`

Retrieves multiple models by their IDs.

_Use case:_ Bulk access control checks, model filtering

_Query:_
```sql
SELECT * FROM model WHERE id IN (?);
```

#### `updateModelById(id: string, data: ModelForm): Promise<ModelModel | null>`

Updates a model's configuration.

_Updatable fields:_
- `name` - Display name
- `base_model_id` - Base model reference
- `params` - Model parameters
- `meta` - Model metadata
- `access_control` - Access permissions
- `is_active` - Active status

_Auto-updated fields:_
- `updatedAt` - Set to current unix timestamp

_Protected fields (cannot update):_
- `id` - Model ID (excluded from update)
- `user_id` - Owner (preserved)
- `created_at` - Creation time (preserved)

_Security:_ Requires write access (owner, admin, or has write permission)

_Example:_
```typescript
const updated = await updateModelById('custom-gpt4', {
    id: 'custom-gpt4',  // Excluded from update
    name: 'Updated GPT-4',
    params: {
        temperature: 0.8
    },
    meta: {
        description: 'Updated description'
    },
    is_active: true
});
```

#### `toggleModelById(id: string): Promise<ModelModel | null>`

Toggles a model's active status (enabled/disabled).

_Behavior:_
- `is_active: true` → `is_active: false`
- `is_active: false` → `is_active: true`
- Updates `updatedAt` timestamp

_Security:_ Requires write access

_Use case:_ Temporarily hide models without deleting them

#### `deleteModelById(id: string): Promise<boolean>`

Permanently deletes a model from the database.

_Security:_ Requires write access

_Returns:_ `true` if deleted, `false` if not found

_Cascade:_ No cascade delete - references to this model will break

_Use case:_ Model removal

#### `deleteAllModels(): Promise<boolean>`

_Admin only:_ Deletes ALL models from the database.

_Warning:_ Destructive operation - no undo

_Returns:_ `true` on success

---

### Search & Filtering

#### `searchModels(userId: string, filter: SearchFilter, skip: number, limit: number): Promise<ModelListResponse>`

Searches and filters custom models with pagination.

_Default pagination:_ 30 items per page

_Filter options:_
```typescript
type SearchFilter = {
    query?: string;                          // Search by name or base_model_id (case-insensitive)
    view_option?: 'created' | 'shared';     // 'created' = user's models, 'shared' = others' models
    order_by?: 'name' | 'created_at' | 'updated_at';  // Sort field
    direction?: 'asc' | 'desc';              // Sort direction
    user_id?: string;                        // Current user ID (for access control)
};
```

_Filtering behavior:_
- `query`: Searches `name` and `base_model_id` fields with ILIKE
- `view_option: 'created'`: Only models where `user_id = userId`
- `view_option: 'shared'`: Only models where `user_id != userId`
- Access control: Automatically filters based on public models and user permissions

_Access control filtering:_
1. Public models (`access_control = null` or `= "null"`) are included
2. Models owned by user are included
3. Models with user in read permissions are included
4. Admin users bypass filtering (if `BYPASS_ADMIN_ACCESS_CONTROL` enabled)

_Returns:_
```typescript
{
    items: ModelUserResponse[];  // Current page of models with user info
    total: number;               // Total count (before pagination)
}
```

_Example:_
```typescript
const result = await searchModels(userId, {
    query: 'gpt',
    order_by: 'updated_at',
    direction: 'desc',
    user_id: userId
}, 0, 30);

console.log(`Found ${result.total} models, showing ${result.items.length}`);
```

#### `getModelsByUserId(userId: string, permission: 'read' | 'write'): Promise<ModelUserResponse[]>`

Retrieves all custom models accessible to a user with specified permission level.

_Access logic:_
- Models owned by user
- Models where user has permission (via access_control)

_Use case:_ User's accessible models list, permission-based filtering

---

### Sync & Import Operations

#### `syncModels(userId: string, models: ModelModel[]): Promise<ModelModel[]>`

_Admin only:_ Synchronizes database with incoming models list.

_Behavior:_
1. **Update existing models**: Matches by ID, updates all fields except timestamps
2. **Insert new models**: Creates models not in database
3. **Delete removed models**: Removes models in database but not in incoming list

_Auto-updated fields (for existing models):_
- `updatedAt` - Set to current unix timestamp
- `user_id` - Set to provided userId (overwrites original)

_Auto-generated fields (for new models):_
- `createdAt` - Current unix timestamp
- `updatedAt` - Current unix timestamp
- `user_id` - Provided userId

_Returns:_ Complete synced model list from database

_Use case:_ Backend model synchronization, bulk model updates

_Transaction:_ Yes (all changes in single transaction)

_Example:_
```typescript
await syncModels(adminUserId, [
    {
        id: 'gpt-4-turbo',
        base_model_id: null,
        name: 'GPT-4 Turbo',
        params: {},
        meta: { description: 'Latest GPT-4' },
        access_control: null,
        is_active: true,
        created_at: 1704067200,
        updated_at: 1704067200
    }
]);
// Database now contains only this model; all others deleted
```

#### `importModels(models: ModelImportForm[], userId: string): Promise<boolean>`

Bulk imports or updates models (non-destructive).

_Behavior:_
- If model ID exists: updates the model
- If model ID doesn't exist: creates new model
- Does NOT delete existing models (unlike sync)

_Validation:_
- Model ID must be valid (length check)
- Requires `workspace.models_import` permission

_Use case:_ Backup restoration, model migration

_Example:_
```typescript
await importModels([
    {
        id: 'my-model',
        name: 'My Model',
        params: {},
        meta: {}
    }
], userId);
```

---

### Access Control Operations

#### `hasAccess(userId: string, type: 'read' | 'write', accessControl: AccessControl | null): boolean`

Checks if a user has access to a model.

_Access logic:_
```typescript
// Public read access
if (accessControl === null && type === 'read') return true;

// No access for write if access_control is null
if (accessControl === null && type === 'write') return false;

// Check user_ids
if (accessControl[type]?.user_ids?.includes(userId)) return true;

return false;
```

_Use case:_ Permission checks before read/write operations

---

## Special Logic & Considerations

### Model ID Validation

- **Maximum length:** 256 characters
- **Uniqueness:** Must be globally unique across all models
- **Character restrictions:** No specific restrictions (can contain '/', ':', etc.)
- **Validation timing:** Check before insert/import operations

### Base vs Custom Models Distinction

**Base Models** (`base_model_id = null`):
- Represent actual AI models from backends
- Typically created/synced by system/admin
- Referenced by custom models
- Example: `gpt-4-turbo`, `llama-3-70b`

**Custom Models** (`base_model_id != null`):
- User-created configurations
- Reference a base model for actual inference
- Override name, params, meta of base model
- Example: `my-coding-gpt4` → references `gpt-4-turbo`

**Model Matching (OWUI behavior):**
- When aggregating models, custom models can match base models by:
  1. Exact ID match: `custom_model.id === base_model.id`
  2. Ollama prefix match: `custom_model.id === base_model.id.split(':')[0]`
     - Handles Ollama's versioned model IDs (`llama3` matches `llama3:7b`)

### Access Control Behavior

**Public Access** (`access_control = null`):
- Read: All users can read
- Write: Only owner can write

**Private Access** (`access_control = {}`):
- Read: Only owner can read
- Write: Only owner can write

**Custom Access** (with read/write structures):
- User must be in `user_ids`
- Empty arrays mean no access (even more restrictive than owner-only)

**Admin Bypass:**
- If `BYPASS_ADMIN_ACCESS_CONTROL` is enabled, admin users skip all checks
- Useful for administrative operations

### Active Status Management

**Purpose:** Soft-disable models without deleting them

**Behavior:**
- `is_active: false` → Model hidden from normal model lists
- Model still in database, can be retrieved by ID
- Can be re-enabled with toggle operation

**Use cases:**
- Temporarily disable problematic models
- Hide models during maintenance
- Model access management

### Timestamp Handling

- All timestamps use **unix seconds** (NOT milliseconds)
- JavaScript conversion: `Math.floor(Date.now() / 1000)`
- Stored in BIGINT columns
- Updated on every modification

### Model Ordering

**In GET `/api/v1/models` endpoint:**
- Can apply custom order from `MODEL_ORDER_LIST` config
- Falls back to alphabetical by name
- Filtered models maintain order

**In paginated lists:**
- Default: Order by `created_at DESC`
- Configurable: `order_by` + `direction` parameters

### Profile Images

**Storage options:**
1. **HTTP URL:** External image link
2. **Data URI:** Embedded base64 image (`data:image/png;base64,...`)
3. **Relative path:** Static asset path

**Default:** `/static/favicon.png`

**Optimization:** Remove `profile_image_url` from API responses to reduce payload size

### Params Exposure

**Security consideration:** Model params may contain sensitive information (API keys, etc.)

**Protection:** When returning models in API:
- Remove `params` field from model info
- Only include params in admin/owner views
- Never expose params in public model lists

---

## Transaction Examples

### Model Creation with Access Control

```typescript
await db.transaction(async (tx) => {
    // Validate model ID
    const existing = await getModelById(modelId, tx);
    if (existing) {
        throw new Error('Model ID already taken');
    }

    if (!isValidModelId(modelId)) {
        throw new Error('Model ID too long (max 256 characters)');
    }

    // Create model
    const model = await insertNewModel({
        id: modelId,
        base_model_id: baseModelId,
        name: displayName,
        params: {
            temperature: 0.7,
            max_tokens: 2000
        },
        meta: {
            description: 'Custom model configuration'
        },
        access_control: {
            read: {
                user_ids: [userId, teammateUserId]
            },
            write: {
                user_ids: [userId]
            }
        }
    }, userId, tx);

    return model;
});
```

### Model Update with Permission Check

```typescript
await db.transaction(async (tx) => {
    // Fetch model
    const model = await getModelById(modelId, tx);
    if (!model) {
        throw new Error('Model not found');
    }

    // Check write access
    const hasWriteAccess =
        userId === model.user_id ||
        isAdmin ||
        hasAccess(userId, 'write', model.access_control);

    if (!hasWriteAccess) {
        throw new Error('Unauthorized: write access required');
    }

    // Update model
    const updated = await updateModelById(modelId, {
        ...model,
        name: newName,
        params: newParams
    }, tx);

    return updated;
});
```

### Sync Models (Backend Synchronization)

```typescript
await db.transaction(async (tx) => {
    // Fetch current models from backend
    const backendModels = await fetchBackendModels();

    // Transform to ModelModel format
    const models = backendModels.map(m => ({
        id: m.id,
        user_id: adminUserId,
        base_model_id: null,  // These are base models
        name: m.name,
        params: {},
        meta: {
            description: m.description,
            capabilities: m.capabilities
        },
        access_control: null,  // Public read access
        is_active: true,
        created_at: currentTimestamp(),
        updated_at: currentTimestamp()
    }));

    // Sync (update/insert/delete)
    const synced = await syncModels(adminUserId, models, tx);

    return synced;
});
```

### Access Control Check for Model List

```typescript
// Fetch all custom models
const allModels = await getCustomModels();

// Filter accessible models
const accessibleModels = allModels.filter(model => {
    // Admin bypass
    if (isAdmin && BYPASS_ADMIN_ACCESS_CONTROL) return true;

    // Owner access
    if (model.user_id === userId) return true;

    // Access control check
    return hasAccess(userId, 'read', model.access_control);
});

return accessibleModels;
```

---

## Migration from Mock Data

When implementing database operations for route endpoints:

1. **GET `/api/v1/models`** → Use `get_all_models()` utility
   - Aggregates base models from backends + custom models from registry
   - Applies access control filtering via `get_filtered_models()`
   - Returns OpenAI-compatible format: `{data: [models]}`

2. **GET `/api/v1/models/list`** → Use `searchModels()` with pagination
   - Returns only custom models with user info
   - Includes `write_access` flag for each model
   - Paginated: 30 items per page (PAGE_ITEM_COUNT)

3. **GET `/api/v1/models/base`** → Use `getBaseModels()`
   - Admin only endpoint
   - Returns models where `base_model_id = null`

4. **POST `/api/v1/models/create`** → Use `insertNewModel()`
   - Validate ID length and uniqueness
   - Check `workspace.models` permission
   - Set creator as owner

5. **GET `/api/v1/models/model`** → Use `getModelById()` + access check
   - Verify read access with `hasAccess()`
   - Include `write_access` flag in response
   - Return 404 if not found or no access

6. **POST `/api/v1/models/model/toggle`** → Use `toggleModelById()`
   - Verify write access
   - Toggles `is_active` field
   - Updates timestamp

7. **POST `/api/v1/models/model/update`** → Use `updateModelById()`
   - Verify write access
   - Exclude `id` from update
   - Update timestamp automatically

8. **POST `/api/v1/models/model/delete`** → Use `deleteModelById()`
   - Verify write access
   - Hard delete (no cascade warnings needed)
   - Return false if not found

9. **DELETE `/api/v1/models/delete/all`** → Use `deleteAllModels()`
   - Admin only
   - Deletes ALL models (destructive)

10. **POST `/api/v1/models/sync`** → Use `syncModels()`
    - Admin only
    - Reconciles database with incoming list
    - Update/insert/delete as needed

### Access Control Implementation

For all endpoints requiring access checks:

```typescript
// Check read access
const canRead =
    isAdmin && BYPASS_ADMIN_ACCESS_CONTROL ||
    userId === model.user_id ||
    hasAccess(userId, 'read', model.access_control);

// Check write access
const canWrite =
    isAdmin ||
    userId === model.user_id ||
    hasAccess(userId, 'write', model.access_control);
```

### Search Filter Mapping

Map query parameters to filter object:

```typescript
const filter: SearchFilter = {
    ...(query && { query }),
    ...(view_option && { view_option }),
    ...(order_by && { order_by }),
    ...(direction && { direction })
};

// Add access control info (if not admin)
if (!isAdmin || !BYPASS_ADMIN_ACCESS_CONTROL) {
    filter.user_id = userId;
}
```
