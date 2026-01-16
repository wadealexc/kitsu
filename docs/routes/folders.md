# Folders API Specification

## Endpoints

**Context:** Core folder management - hierarchical folder organization for chats.

These endpoints handle folder creation, retrieval, updates, deletion, and organization. Folders support hierarchical structures (parent-child relationships) and are user-scoped. Each folder can contain chats and other folders, enabling tree-based organization of conversations.

---

### GET `/api/v1/folders/`

Get all folders for the current user.

#### Inputs

None

#### Outputs

Response (200): Array of [`FolderNameIdResponse`](#foldernameIdresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/folders.py:48`
  - Method: `get_folders()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access their own folders (`get_verified_user` dependency)
  - Requires `features.folders` permission via `has_permission()` check
  - Feature flag: `ENABLE_FOLDERS` must be enabled
- _OWUI Implementation Notes:_
  - Returns all folders owned by current user
  - Validates parent folder references (removes orphaned parent_id)
  - Verifies file access permissions within folders
  - Validates knowledge collection access
  - Updates folder data if modifications found during validation
  - Admin users bypass permission checks

---

### POST `/api/v1/folders/`

Create a new root-level folder for the user.

#### Inputs

**Request Body:** [`FolderForm`](#folderform)

#### Outputs

Response (200): [`FolderModel`](#foldermodel)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/folders.py:116`
  - Method: `create_folder()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can create folders
  - Requires `features.folders` permission via `has_permission()` check
  - Feature flag: `ENABLE_FOLDERS` must be enabled
- _OWUI Implementation Notes:_
  - Creates folder at root level (parent_id = null)
  - Checks for duplicate folder names at root level
  - Returns 400 BAD_REQUEST if folder name already exists
  - Automatically sets user_id to current user
  - Automatically sets created_at and updated_at timestamps
  - Logs exceptions and returns 400 on failure

---

### GET `/api/v1/folders/{id}`

Get a specific folder by ID with all details.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Folder ID to retrieve

#### Outputs

Response (200): [`FolderModel`](#foldermodel) or `null` if not found

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/folders.py:149`
  - Method: `get_folder_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only access their own folders (filtered by user_id)
  - Requires `features.folders` permission
- _OWUI Implementation Notes:_
  - Returns 404 NOT_FOUND if folder doesn't exist or user lacks access
  - Queries database with both id and user_id filter

---

### POST `/api/v1/folders/{id}/update`

Update folder properties (name, data, meta).

#### Inputs

**Path Parameters:**
- `id` (string, required) - Folder ID to update

**Request Body:** [`FolderUpdateForm`](#folderupdateform)

#### Outputs

Response (200): [`FolderModel`](#foldermodel)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/folders.py:168`
  - Method: `update_folder_name_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only update their own folders
  - Requires `features.folders` permission
- _OWUI Implementation Notes:_
  - If name is updated, checks for duplicate names within same parent folder
  - Returns 400 BAD_REQUEST if duplicate name found
  - Data and meta fields are merged with existing values (deep merge)
  - Only updates provided fields (partial update)
  - Returns 404 NOT_FOUND if folder doesn't exist
  - Logs errors and returns 400 on update failure

---

### DELETE `/api/v1/folders/{id}`

Delete a folder and optionally its contents.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Folder ID to delete

**Query Parameters:**
- `delete_contents` (boolean, optional, default: `true`) - If true, deletes all chats in folder; if false, moves chats to root level

#### Outputs

Response (200): `boolean` - Returns `true` on success

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/folders.py:297`
  - Method: `delete_folder_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only delete their own folders
  - If folder contains chats, requires `chat.delete` permission
  - Admin users bypass permission checks
  - Requires `features.folders` permission
- _OWUI Implementation Notes:_
  - Recursively deletes all subfolders
  - Deletes or moves all chat contents based on `delete_contents` parameter
  - If `delete_contents=true`, removes all chats in folder and subfolders
  - If `delete_contents=false`, moves chats to root level (folder_id = null)
  - Returns 404 NOT_FOUND if folder doesn't exist
  - Logs errors and returns 400 on failure

---

### POST `/api/v1/folders/{id}/update/parent`

Move a folder to a different parent folder or root level.

#### Inputs

**Path Parameters:**
- `id` (string, required) - Folder ID to move

**Request Body:** [`FolderParentIdForm`](#folderparentidform)

#### Outputs

Response (200): [`FolderModel`](#foldermodel)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/folders.py:217`
  - Method: `update_folder_parent_id_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only update their own folders
  - Requires `features.folders` permission
- _OWUI Implementation Notes:_
  - Checks for duplicate folder names within target parent folder
  - Returns 400 BAD_REQUEST if duplicate exists
  - Setting parent_id to null moves folder to root level
  - Returns 404 NOT_FOUND if folder doesn't exist
  - Logs errors and returns 400 on failure

---

### POST `/api/v1/folders/{id}/update/expanded`

Update the UI expansion state of a folder (for tree view persistence).

#### Inputs

**Path Parameters:**
- `id` (string, required) - Folder ID

**Request Body:** [`FolderIsExpandedForm`](#folderisexpandedform)

#### Outputs

Response (200): [`FolderModel`](#foldermodel)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/folders.py:264`
  - Method: `update_folder_is_expanded_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - User can only update their own folders
  - Requires `features.folders` permission
- _OWUI Implementation Notes:_
  - Persists folder expansion state for UI tree view
  - Used to remember which folders are expanded/collapsed
  - Returns 404 NOT_FOUND if folder doesn't exist
  - Logs errors and returns 400 on failure

---

## Definitions

### `FolderNameIdResponse`

Lightweight folder response with essential fields for listing.

```typescript
{
    id: string;
    name: string;
    meta: FolderMetadataResponse | null;
    parent_id: string | null;
    is_expanded: boolean;  // Default: false
    created_at: number;    // Unix timestamp (seconds)
    updated_at: number;    // Unix timestamp (seconds)
}
```

**Fields:**
- `id` - Unique folder identifier (UUID)
- `name` - Folder display name
- `meta` - Metadata (icon, etc.)
- `parent_id` - Parent folder ID (null for root-level folders)
- `is_expanded` - UI state: whether folder is expanded in tree view
- `created_at` - Creation timestamp (Unix seconds)
- `updated_at` - Last update timestamp (Unix seconds)

---

### `FolderModel`

Full folder representation with all fields.

```typescript
{
    id: string;
    parent_id: string | null;
    user_id: string;
    name: string;
    items: object | null;      // Item references
    meta: object | null;       // Metadata
    data: object | null;       // Custom folder data
    is_expanded: boolean;      // Default: false
    created_at: number;        // Unix timestamp (seconds)
    updated_at: number;        // Unix timestamp (seconds)
}
```

**Fields:**
- `id` - Unique folder identifier
- `parent_id` - Parent folder ID (null for root level)
- `user_id` - Owner user ID
- `name` - Folder display name
- `items` - JSON object with item references (flexible schema)
- `meta` - JSON object with metadata (icon, etc.)
- `data` - JSON object with custom data (flexible schema)
- `is_expanded` - Whether folder is expanded in UI
- `created_at` - Creation timestamp (Unix seconds)
- `updated_at` - Last update timestamp (Unix seconds)

---

### `FolderForm`

Request form for creating a folder.

```typescript
{
    name: string;           // Required
    data?: object | null;   // Optional custom data
    meta?: object | null;   // Optional metadata
}
```

**Validation:**
- `name` is required
- Additional properties allowed (additionalProperties: true)

---

### `FolderUpdateForm`

Request form for updating folder properties.

```typescript
{
    name?: string | null;   // Optional new name
    data?: object | null;   // Optional new data (merged with existing)
    meta?: object | null;   // Optional new metadata (merged with existing)
}
```

**Notes:**
- All fields are optional
- Data and meta are merged with existing values (not replaced)
- Additional properties allowed (additionalProperties: true)

---

### `FolderParentIdForm`

Request form for changing folder parent.

```typescript
{
    parent_id?: string | null;  // Optional new parent ID
}
```

**Notes:**
- `null` parent_id moves folder to root level
- Must reference an existing folder owned by the user

---

### `FolderIsExpandedForm`

Request form for updating folder expansion state.

```typescript
{
    is_expanded: boolean;  // Required
}
```

**Notes:**
- Used to persist UI tree view state
- `true` = folder is expanded, `false` = folder is collapsed

---

### `FolderMetadataResponse`

Metadata structure for folder display properties.

```typescript
{
    icon?: string | null;  // Icon identifier or URL
}
```

**Notes:**
- Currently only supports icon field
- Extensible for future metadata properties
