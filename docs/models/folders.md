# Folder Database Model

## Overview

The Folder model stores hierarchical folder structures for organizing chats. Folders support parent-child relationships, allowing users to create nested folder trees. Each folder is user-scoped and can contain chats and other folders. Folders maintain UI state (expansion), custom metadata, and flexible data payloads.

References:
- _OWUI Implementation:_ `open-webui/backend/open_webui/models/folders.py`
- _OWUI Routes:_ `open-webui/backend/open_webui/routers/folders.py`
- _Our Route Spec:_ `/docs/routes/folders.md`

---

## Table Schema

### Table Name: `folder`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY, UNIQUE | Folder ID (UUID v4) |
| `parent_id` | TEXT | NULLABLE, INDEX, FK → folder(id) ON DELETE CASCADE | Parent folder ID for hierarchical organization; null for root-level folders |
| `user_id` | TEXT | NOT NULL, INDEX, FK → user(id) ON DELETE CASCADE | Owner's user ID (UUID v4) |
| `name` | TEXT | NOT NULL | Folder display name (case-sensitive) |
| `meta` | JSON | NULLABLE | Folder metadata (see FolderMeta structure below) |
| `data` | JSON | NULLABLE | Folder data structure (see FolderData structure below) |
| `is_expanded` | BOOLEAN | NOT NULL, DEFAULT: false | UI state: whether folder is expanded in tree view (for persistence) |
| `created_at` | BIGINT | NOT NULL, INDEX | Creation timestamp (unix seconds) |
| `updated_at` | BIGINT | NOT NULL, INDEX | Last update timestamp (unix seconds) |

### Indexes

```sql
-- Performance indexes for common queries
CREATE INDEX idx_folder_user_id ON folder(user_id);
CREATE INDEX idx_folder_parent_id ON folder(parent_id);
CREATE INDEX idx_folder_parent_id_user_id ON folder(parent_id, user_id);
CREATE INDEX idx_folder_user_id_parent_id_name ON folder(user_id, parent_id, name);
CREATE INDEX idx_folder_created_at ON folder(created_at);
CREATE INDEX idx_folder_updated_at ON folder(updated_at);

-- Unique constraints
CREATE UNIQUE INDEX idx_folder_id ON folder(id);
```

**Notes on Indexes:**
- `user_id` index enables fast user-scoped queries
- `parent_id` index supports hierarchy traversal and children lookups
- Composite `(parent_id, user_id)` optimizes "get siblings" queries
- Composite `(user_id, parent_id, name)` optimizes duplicate name checking within parent
- `created_at` and `updated_at` indexes support sorting
- Folder ID is unique to prevent duplicates

### Constraints

```sql
-- Foreign keys
FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
FOREIGN KEY (parent_id) REFERENCES folder(id) ON DELETE CASCADE;
```

**Cascade Behavior:**
- When a user is deleted, all their folders are automatically deleted
- When a parent folder is deleted, all child folders are automatically deleted
- When a folder is deleted, chats in that folder have their `folder_id` set to NULL (moved to root) or deleted based on user choice

### Folder Hierarchy

The folder system uses a **parent-child relationship model** with the following characteristics:

- **Root-level folders:** Have `parent_id = NULL`
- **Nested folders:** Have `parent_id` pointing to another folder's ID
- **Maximum nesting:** Unlimited (but should be validated in application logic to prevent excessively deep trees)
- **Naming:** Folder names are unique within their parent context (same parent_id). Multiple folders with the same name can exist at different hierarchy levels.
- **Recursion handling:** Implementation must handle recursive deletion of all descendants when a folder is deleted

### FolderMeta JSON Structure

The `meta` column stores folder metadata for UI presentation.

**Type Definition:**
```typescript
interface FolderMeta {
    icon?: string | null;  // Emoji short code for folder icon
}
```

**Example:**
```json
{
    "icon": ":folder:"
}
```

**Fields:**
- `icon` - Emoji short code for folder icon (e.g., ":folder:", ":star:")

### FolderData JSON Structure

The `data` column stores folder functionality settings.

**Type Definition:**
```typescript
interface FolderFileItem {
    type: 'file' | 'collection';
    id: string;
    name: string;
    collection_name?: string;
    url?: string;
    status?: 'uploading' | 'uploaded';
    size?: number;
    context?: 'full';
    error?: string;
    itemId?: string;
}

interface FolderData {
    system_prompt?: string;
    files?: FolderFileItem[];
    model_ids?: string[];
}
```

**Example:**
```json
{
    "system_prompt": "You are a helpful assistant for Q1 2024 projects.",
    "files": [
        {
            "type": "file",
            "id": "file-uuid-1",
            "name": "document.pdf",
            "url": "file-uuid-1",
            "status": "uploaded",
            "size": 1024000
        },
        {
            "type": "collection",
            "id": "collection-uuid-1",
            "name": "My Knowledge Base"
        }
    ],
    "model_ids": ["gpt-4", "claude-sonnet-4.5"]
}
```

**Fields:**

- `system_prompt` - System prompt applied to all chats in this folder. Injected into chat requests via middleware.

- `files` - Files and knowledge collections attached to this folder. Automatically included in chat requests for this folder. Array of FolderFileItem objects with the following fields:
  - `type` - Type discriminator: 'file' for uploaded files, 'collection' for knowledge bases
  - `id` - File or collection UUID
  - `name` - Display name
  - `collection_name` - Collection identifier (for files that belong to collections)
  - `url` - Resource URL
  - `status` - Upload status (present during upload operations)
  - `size` - File size in bytes
  - `context` - Context mode ('full' indicates full document context)
  - `error` - Error message if upload/validation failed
  - `itemId` - Temporary ID during upload process

- `model_ids` - Selected model IDs for this folder. Persists model selection when navigating between folders.

---

## Operations

### Core CRUD Operations

#### `createFolder(userId: string, data: FolderForm, parentId?: string | null): Promise<Folder>`

_Transaction:_ No (but should be atomic)

Creates a new folder for a user.

_Required fields:_
- `userId` - User who owns the folder
- `data.name` - Folder display name
- `parentId` (optional) - Parent folder ID (defaults to null for root-level)

_Optional fields:_
- `data.data` - Custom folder data (JSON object)
- `data.meta` - Custom metadata (JSON object)

_Auto-generated fields:_
- `id` - UUID v4
- `createdAt` - Current unix timestamp (in seconds)
- `updatedAt` - Current unix timestamp (in seconds)
- `isExpanded` - Defaults to false

_Validation:_
- Folder name must be unique within same parent for the same user
- Parent folder must exist and belong to user (if specified)
- Name cannot be null/empty

_Notes:_
- When creating a root-level folder, pass parentId as null
- When creating a subfolder, parentId must be a valid folder ID belonging to the user

_Example:_
```typescript
const folder = await createFolder(userId, {
    name: "Q1 2024 Projects",
    meta: { icon: "folder" },
    data: { files: [] }
}, null);  // Root level folder
```

#### `getFolderById(id: string, userId: string): Promise<Folder | null>`

Retrieves a folder by ID with ownership verification.

_Security:_ Filters by userId to prevent cross-user access

_Returns:_ Full folder object or null if not found

#### `getFoldersByUserId(userId: string): Promise<Folder[]>`

_Admin or owner only:_ Retrieves ALL folders for a user (includes all hierarchy levels).

_Returns:_ Array of all folders (no pagination)

#### `getFoldersByParentId(parentId: string | null, userId: string): Promise<Folder[]>`

Retrieves direct children of a folder.

_Parameters:_
- `parentId` - Parent folder ID (or null for root-level folders)
- `userId` - User to filter by

_Returns:_ Array of child folders at this level only (not recursive)

_Use case:_ Building folder tree, navigating hierarchy

#### `getFolderByNameAndParentId(name: string, parentId: string | null, userId: string): Promise<Folder | null>`

Looks up a folder by name within a parent context.

_Security:_ Filters by userId

_Use case:_ Checking for duplicate names before creation/update

#### `getChildrenFolders(folderId: string, userId: string): Promise<Folder[]>`

Recursively retrieves all descendant folders.

_Parameters:_
- `folderId` - Root folder to start from
- `userId` - User filter

_Returns:_ Array of all descendant folders (recursive tree flattened)

_Notes:_
- Includes the folder itself and all descendants at any depth
- Used for cascading deletion logic

#### `updateFolder(id: string, userId: string, data: FolderUpdateForm): Promise<Folder | null>`

Updates folder properties (name, data, meta).

_Auto-updated fields:_
- `updatedAt` - Set to current unix timestamp

_Behavior:_
- Only updates provided fields (partial update)
- Data and meta are merged with existing values (deep merge, not replaced)
- If name is updated, checks for duplicate names within same parent
- Returns null if folder not found or update fails

_Example:_
```typescript
const updated = await updateFolder(folderId, userId, {
    name: "Q1 2024 - Completed Projects",
    meta: { icon: "star" }
});
```

#### `updateFolderParent(id: string, userId: string, parentId: string | null): Promise<Folder | null>`

Moves a folder to a different parent (or to root if parentId is null).

_Behavior:_
- Validates new parent exists (if not null)
- Checks for duplicate folder names in target parent
- Updates parentId and updatedAt timestamp
- Returns null if folder not found

_Validations:_
- Cannot move a folder to itself as parent (circular reference)
- Cannot move a folder to one of its own descendants (circular reference)
- Parent folder must exist and belong to user

_Example:_
```typescript
// Move to root level
await updateFolderParent(folderId, userId, null);

// Move under different parent
await updateFolderParent(folderId, userId, newParentId);
```

#### `updateFolderExpanded(id: string, userId: string, isExpanded: boolean): Promise<Folder | null>`

Updates the UI expansion state of a folder.

_Behavior:_
- Sets isExpanded to boolean value
- Updates updatedAt timestamp
- Returns null if folder not found

_Use case:_ Persisting UI tree view state for user

#### `deleteFolder(id: string, userId: string): Promise<string[]>`

Deletes a folder and all its descendants (recursive deletion).

_Returns:_ Array of deleted folder IDs (for cascading to chats)

_Behavior:_
- Recursively deletes all child folders
- Returns list of all deleted folder IDs
- Related chats are handled separately (see folder deletion in routes)

_Cascade:_
- All descendant folders are deleted
- Chats in deleted folders are moved to root or deleted (based on deleteContents parameter in API)

_Example:_
```typescript
const deletedFolderIds = await deleteFolder(folderId, userId);
// Now handle chats: either delete them or move to root
for (const folderId of deletedFolderIds) {
    if (deleteContents) {
        await deleteChatsInFolder(userId, folderId);
    } else {
        await moveChatsToRoot(userId, folderId);
    }
}
```

---

### Hierarchy & Traversal

#### `countFoldersInHierarchy(rootFolderId: string, userId: string): Promise<number>`

Counts total folders in a hierarchy.

_Returns:_ Total count including root and all descendants

#### `getFolderPath(folderId: string, userId: string): Promise<Folder[]>`

Retrieves the path from root to a folder (inclusive).

_Returns:_ Array of folders from root to target [root, parent, folder]

_Use case:_ Breadcrumb navigation

#### `getFolderHierarchy(userId: string): Promise<FolderTree>`

Builds complete folder tree structure for a user.

_Returns:_ Nested tree structure with children:
```typescript
type FolderTree = {
    id: string;
    name: string;
    parentId: string | null;
    isExpanded: boolean;
    meta: object | null;
    children: FolderTree[];
};
```

_Use case:_ UI rendering of complete folder tree

---

### Validation & Search

#### `validateFolderHierarchy(userId: string): Promise<ValidationResult>`

Validates folder hierarchy integrity (OWUI operation).

_Checks:_
- All parentId references point to existing folders
- No circular references
- All folders belong to user
- Removes orphaned parentId references

_Returns:_ Summary of issues found and fixed

#### `searchFoldersByName(query: string, userId: string): Promise<Folder[]>`

Searches folders by partial name match (case-insensitive).

_Parameters:_
- `query` - Search string (treated as substring)
- `userId` - User to filter by

_Returns:_ Array of matching folders

_OWUI Behavior:_ Normalizes names (replaces _ and spaces, lowercase) for matching

#### `searchFoldersByExactName(names: string[], userId: string): Promise<Folder[]>`

Searches for folders matching exact names (with normalization).

_Parameters:_
- `names` - Array of folder names to search for
- `userId` - User to filter by

_Returns:_ Array of matching folders including all descendants of matched folders

_Use case:_ Feature like "folder:name" in search queries (OWUI implementation)

---

## Special Logic & Considerations

### Timestamp Handling

- All timestamps are **unix seconds** (NOT milliseconds)
- Timestamps stored in `created_at`, `updated_at`
- When comparing: `new Date().getTime() / 1000` to convert

### Naming & Uniqueness

- Folder names are **case-sensitive** (OWUI stores as-is)
- Names are unique **within a parent context** (same parent can't have two folders with same name)
- Root-level folders are unique at parentId=NULL
- OWUI also implements normalization: replaces _ and spaces, lowercases for certain operations

### Circular Reference Prevention

When updating parentId, must prevent:
1. Folder becoming its own parent
2. Folder becoming child of its own descendant

_Implementation:_
```typescript
// Before updating parentId:
if (parentId === folderId) {
    throw new Error("Folder cannot be its own parent");
}

const descendants = await getChildrenFolders(folderId, userId);
if (descendants.some(d => d.id === parentId)) {
    throw new Error("Cannot move folder to its own descendant");
}
```

### Hierarchy Depth

- No explicit limit in schema (parentId is nullable, allowing any depth)
- Application should validate reasonable depth limits (e.g., max 10 levels)
- Can implement depth check before creating subfolder:

```typescript
const depth = await calculateFolderDepth(parentId, userId);
if (depth > MAX_FOLDER_DEPTH) {
    throw new Error("Folder hierarchy too deep");
}
```

### Folder Deletion Strategy

Two modes when deleting folder:

1. **deleteContents=true** (default):
   - Delete folder and all descendants
   - Delete all chats in folder and subfolders
   - Permanent operation

2. **deleteContents=false**:
   - Delete folder and all descendants
   - Move all chats to root level (folderId = NULL)
   - Chats preserved

_Implementation:_
```typescript
const deletedFolderIds = await deleteFolder(folderId, userId);

if (deleteContents) {
    for (const fId of deletedFolderIds) {
        await deleteChatsInFolder(userId, fId);
    }
} else {
    for (const fId of deletedFolderIds) {
        await moveChatsToRoot(userId, fId);
    }
}
```

### Folder-Chat Relationships

- Chats have optional `folderId` field (nullable)
- When chat is created, can specify folder
- Chat cannot be in multiple folders (1-to-many relationship)
- When folder is deleted, chats' folderId is either cleared or chats are deleted
- When chat is archived, it's removed from folder (folderId set to NULL)
- When chat is moved to folder, it's unpinned (pinned status cleared)

### Data Integrity in OWUI

OWUI performs validation on retrieval (`get_folders` endpoint):
- Validates parentId references (removes orphaned parents)
- Validates file/collection references in folder.data
- Removes access to files/collections user can't access
- Updates folder if changes found

This is a **read-side validation** pattern that should be considered for critical integrity checks.

---

## Transaction Examples

### Folder Creation (with Hierarchy)

```typescript
await db.transaction(async (tx) => {
    // Create root folder
    const rootFolder = await createFolder(userId, {
        name: "2024 Projects",
        meta: { icon: "folder" }
    }, null, tx);

    // Create subfolders
    const q1Folder = await createFolder(userId, {
        name: "Q1",
        meta: { icon: "star" }
    }, rootFolder.id, tx);

    const q2Folder = await createFolder(userId, {
        name: "Q2"
    }, rootFolder.id, tx);

    return { rootFolder, q1Folder, q2Folder };
});
```

### Folder Reorganization (Moving Multiple)

```typescript
await db.transaction(async (tx) => {
    // Get all folders to be moved
    const oldParentFolders = await getFoldersByParentId(
        oldParentId, userId, tx
    );

    // Move each to new parent
    for (const folder of oldParentFolders) {
        // Check for duplicate names in new parent
        const existing = await getFolderByNameAndParentId(
            folder.name, newParentId, userId, tx
        );

        if (!existing) {
            await updateFolderParent(
                folder.id, userId, newParentId, tx
            );
        }
    }
});
```

### Folder Deletion with Chat Handling

```typescript
await db.transaction(async (tx) => {
    // Get folder to delete
    const folder = await getFolderById(folderId, userId, tx);
    if (!folder) throw new Error('Folder not found');

    // Get all descendant folders
    const allFolders = [folder];
    allFolders.push(...await getChildrenFolders(folderId, userId, tx));

    // Delete all folders (cascades automatically)
    const deletedIds = await deleteFolder(folderId, userId, tx);

    // Handle chats based on deleteContents parameter
    for (const fId of deletedIds) {
        if (deleteContents) {
            await deleteChatsInFolder(userId, fId, tx);
        } else {
            await moveChatsToRoot(userId, fId, tx);
        }
    }

    return deletedIds;
});
```

### Folder Hierarchy Validation (OWUI Pattern)

```typescript
await db.transaction(async (tx) => {
    // Get all folders
    const folders = await getFoldersByUserId(userId, tx);
    const updates: Array<{ id: string, parentId: null }> = [];

    // Validate each folder's parent
    for (const folder of folders) {
        if (folder.parentId) {
            const parent = await getFolderById(
                folder.parentId, userId, tx
            );
            if (!parent) {
                // Parent doesn't exist - orphaned folder
                updates.push({ id: folder.id, parentId: null });
            }
        }
    }

    // Fix orphaned folders
    for (const update of updates) {
        await updateFolderParent(
            update.id, userId, update.parentId, tx
        );
    }

    return updates.length;
});
```

---

## Special Fields & Extensions

### Data Field Structure

The `data` field stores structured folder functionality settings:
- `system_prompt` - System prompt for folder chats
- `files` - Array of file/collection references with type discrimination
- `model_ids` - Selected model IDs for this folder

---

## Migration from Mock Data

When implementing database operations:

1. _GET `/api/v1/folders/`_ → Use `getFoldersByUserId()` with validation
2. _POST `/api/v1/folders/`_ → Use `createFolder()` with duplicate checking
3. _GET `/api/v1/folders/{folder_id}`_ → Use `getFolderById()` with ownership check
4. _POST `/api/v1/folders/{folder_id}/update`_ → Use `updateFolder()` with validation
5. _POST `/api/v1/folders/{folder_id}/update/parent`_ → Use `updateFolderParent()` with circular reference checks
6. _POST `/api/v1/folders/{folder_id}/update/expanded`_ → Use `updateFolderExpanded()`
7. _DELETE `/api/v1/folders/{folder_id}`_ → Use `deleteFolder()` + chat migration

---

## Summary

The folder model is a **self-referential hierarchical structure** with:
- **Parent-child relationships** via optional `parentId` foreign key
- **User scoping** for multi-tenant isolation
- **Unique naming** within parent context
- **Recursive deletion** of all descendants
- **UI persistence** via `isExpanded` field
- **Flexible metadata** via JSON columns for extensibility
- **Chat integration** via folderId on chat records

Key implementation considerations:
- Prevent circular references when updating parent
- Validate parent existence before creating subfolders
- Check name uniqueness within parent context
- Handle cascading folder deletion with chat migration
- Implement hierarchy depth limits in application logic
- Consider lazy-loading for deep hierarchies
- Perform integrity validation on folder list retrieval (OWUI pattern)
