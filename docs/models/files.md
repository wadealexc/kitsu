# File Database Model

## Overview

The File model stores uploaded file metadata with processing status and content extraction results. **File content is stored on the local filesystem** (not in the database), while the database contains metadata, paths, and processing state. Files are user-scoped with granular access control and integrate with a vector database for semantic search. Files relate to chats through the `chat_file` junction table.

References:
- _OWUI Implementation:_ `open-webui/backend/open_webui/models/files.py`
- _OWUI Routes:_ `open-webui/backend/open_webui/routers/files.py`
- _Our Route Spec:_ `/docs/routes/files.md`

---

## Table Schema

### Table Name: `file`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY, UNIQUE | File ID (UUID v4) |
| `user_id` | TEXT | NOT NULL, INDEX, FK → user(id) ON DELETE CASCADE | Owner's user ID (UUID v4) |
| `hash` | TEXT | NULLABLE | File content hash (for deduplication; set after upload) |
| `filename` | TEXT | NOT NULL | Original filename (user-friendly name, e.g., "document.pdf") |
| `path` | TEXT | NULLABLE | Internal storage path (backend reference, not exposed to API) |
| `data` | JSON | NULLABLE, DEFAULT: `null` | Processing metadata: `{ status, error, content }` |
| `meta` | JSON | NULLABLE, DEFAULT: `null` | File metadata: `{ name, content_type, size, data }` |
| `access_control` | JSON | NULLABLE, DEFAULT: `null` | Granular access control: `{ read: { group_ids, user_ids }, write: { ... } }` |
| `created_at` | BIGINT | NOT NULL, INDEX | Upload timestamp (unix seconds) |
| `updated_at` | BIGINT | NOT NULL, INDEX | Last update timestamp (unix seconds) |

### Indexes

```sql
-- Performance indexes for common queries
CREATE UNIQUE INDEX idx_file_id ON file(id);
CREATE INDEX idx_file_user_id ON file(user_id);
CREATE INDEX idx_file_created_at ON file(created_at);
CREATE INDEX idx_file_updated_at ON file(updated_at);
CREATE INDEX idx_file_hash ON file(hash);
```

**Notes on Indexes:**
- `user_id` index enables efficient filtering of files by owner
- `created_at` and `updated_at` enable efficient sorting
- `hash` index speeds up deduplication checks

### Constraints

```sql
-- Foreign keys
FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
```

**Cascade Behavior:**
- When a user is deleted, all their file DB records are automatically deleted (CASCADE)
- When a file is deleted, all associated `chat_file` records are automatically deleted (FK ON DELETE CASCADE)
- **Note:** Physical files on disk are NOT automatically deleted by CASCADE - application code must explicitly delete them

### Data JSON Structure

The `data` column stores processing metadata. **Example structure:**

```json
{
    "status": "completed",
    "error": null,
    "content": "Extracted text content from the file..."
}
```

**Key Fields in `data` JSON:**
- `status` - Processing status: "pending" (queued), "completed" (success), "failed" (error)
- `error` - Error message if status is "failed"; null otherwise
- `content` - Extracted text content after processing completes; null or empty if not processed

**Processing Lifecycle:**
1. Upload with `process=true` → status set to "pending"
2. Background processing starts → status remains "pending"
3. Processing completes → status set to "completed", content extracted
4. Processing error → status set to "failed", error message recorded

### Meta JSON Structure

The `meta` column stores file metadata. **Example:**

```json
{
    "name": "project-report.pdf",
    "content_type": "application/pdf",
    "size": 1048576,
    "data": {
        "custom_field": "custom_value"
    }
}
```

**Key Fields in `meta` JSON:**
- `name` - Display filename (duplicated from `filename` column for convenience)
- `content_type` - MIME type (e.g., "application/pdf", "image/jpeg", "text/plain")
- `size` - File size in bytes
- `data` - Custom user-provided metadata (flexible structure)

**Common content types:**
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Documents: `application/pdf`, `application/msword`, `text/plain`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Audio: `audio/mpeg`, `audio/wav`, `audio/ogg`
- Video: `video/mp4`, `video/webm`

### Access Control JSON Structure

The `access_control` column stores granular permissions. **Example:**

```json
{
    "read": {
        "group_ids": ["group-1", "group-2"],
        "user_ids": ["user-3", "user-4"]
    },
    "write": {
        "group_ids": ["group-1"],
        "user_ids": ["user-3"]
    }
}
```

**Can be null** - Null means only the file owner can access

**Access resolution (in order):**
1. User owns file (`file.user_id == user.id`)
2. User is admin
3. User/group has explicit permission in `access_control`
4. File in user's shared chats

---

## File Storage

### Storage Strategy

Files are stored on the **local filesystem**, not as database BLOBs. This approach:
- Keeps database size manageable
- Enables efficient file serving
- Simplifies backup and migration
- Allows large file uploads without database constraints

### Directory Structure

**Storage Directory:** `{DATA_DIR}/uploads/`
- Default: `./data/uploads/`
- Configurable via `DATA_DIR` environment variable
- **Auto-created on startup:** `mkdir -p {DATA_DIR}/uploads`

**File Naming:** `{uuid}_{original_filename}`
- Example: `550e8400-e29b-41d4-a716-446655440000_document.pdf`
- UUID prefix ensures uniqueness
- Original filename preserved for user-friendly downloads

### Database vs Filesystem

**Database stores (file table):**
- Metadata: filename, path, content_type, size
- Processing state: status, error, extracted content
- Access control and permissions
- Timestamps

**Filesystem stores:**
- Actual file content at: `{DATA_DIR}/uploads/{uuid}_{filename}`

### Path Reference

The `path` column stores the relative path for file retrieval:
- Stored as: `{uuid}_{filename}` (relative to upload directory)
- Full path constructed as: `{DATA_DIR}/uploads/{path}`
- **Not exposed in API responses** (internal use only)

---

## Operations

### Core CRUD Operations

#### `createFile(userId: string, data: FileForm): Promise<File>`

_Transaction:_ No (but can be part of upload transaction)

Creates a new file record after upload.

_Required fields:_
- `userId` - File owner's user ID
- `data.id` - UUID v4 for file
- `data.filename` - Original filename
- `data.path` - Storage path (local filesystem)
- `data.meta.name` - Display name
- `data.meta.contentType` - MIME type
- `data.meta.size` - File size in bytes

_Auto-generated fields:_
- `createdAt` - Current unix timestamp (in seconds)
- `updatedAt` - Current unix timestamp (in seconds)
- `data.status` - "pending" if processing enabled, null otherwise
- `hash` - null (set later after upload completes)

_Optional fields:_
- `data.meta.data` - Custom metadata from upload form
- `accessControl` - null (defaults to owner-only access)

_Example:_
```typescript
const file = await createFile(userId, {
    id: crypto.randomUUID(),
    filename: 'report.pdf',
    path: '/uploads/uuid_report.pdf',
    meta: {
        name: 'report.pdf',
        contentType: 'application/pdf',
        size: 1024000,
        data: { customField: 'custom-value' }
    },
    data: { status: 'pending' }
});
```

#### `getFileById(id: string): Promise<File | null>`

Retrieves full file by ID, including all metadata and internal path.

_Use case:_ File retrieval, ownership verification

_Notes:_
- Returns null if not found
- Includes internal `path` field (should not be exposed to API)
- Includes `accessControl` for permission checks

#### `getFileByIdAndUserId(id: string, userId: string): Promise<File | null>`

Retrieves file by ID, verifying ownership.

_Security:_ Used for ownership verification before operations

#### `getFileMetadataById(id: string): Promise<FileMetadata | null>`

Retrieves lightweight file metadata without full content.

_Use case:_ Faster queries when content not needed (e.g., file listing)

_Returns:_
```typescript
{
    id: string;
    hash?: string;
    meta?: object;
    createdAt: number;
    updatedAt: number;
}
```

#### `getFilesByIds(ids: string[]): Promise<File[]>`

Retrieves multiple files by ID list.

_Use case:_ Batch file retrieval (e.g., files in a chat)

_Returns:_ Array of files ordered by `updatedAt DESC`

#### `getFiles(): Promise<File[]>`

_Admin only:_ Retrieves ALL files from ALL users (no filtering).

_Use case:_ Admin data export/backup

#### `getFilesByUserId(userId: string): Promise<File[]>`

Retrieves all files for a specific user.

_Use case:_ User's file list

_Notes:_
- No pagination (returns all results)
- Ordered by `updatedAt DESC` by default

#### `getFilesByUserId(userId: string, options?: PaginationOptions): Promise<{ items: File[], total: number }>`

Retrieves files with pagination and optional sorting.

_Options:_
```typescript
type PaginationOptions = {
    skip?: number;                           // Pagination offset
    limit?: number;                          // Page size
    orderBy?: 'createdAt' | 'updatedAt';     // Sort field
    direction?: 'asc' | 'desc';              // Sort direction
};
```

#### `updateFile(id: string, updates: FileUpdateForm): Promise<File | null>`

Updates file metadata and data fields.

_Auto-updated fields:_
- `updatedAt` - Set to current unix timestamp

_Fields that can be updated:_
- `hash` - File content hash
- `data` - Processing status, error, content (merges with existing)
- `meta` - File metadata (merges with existing)

_Behavior:_
- Performs merge on JSON fields (doesn't overwrite entirely)
- Returns null if file not found
- Updates `updatedAt` timestamp

_Example:_
```typescript
const updated = await updateFile(fileId, {
    hash: 'sha256-...',
    data: { status: 'completed', content: 'extracted text' },
    meta: { size: 1024 }
});
```

#### `updateFileData(id: string, data: Partial<FileData>): Promise<File | null>`

Updates only the `data` field (processing status, content, errors).

_Use case:_ Setting processing status during file processing pipeline

_Example:_
```typescript
// Mark as processing
await updateFileData(fileId, { status: 'pending' });

// Mark as completed with content
await updateFileData(fileId, {
    status: 'completed',
    content: 'extracted text content'
});

// Mark as failed with error
await updateFileData(fileId, {
    status: 'failed',
    error: 'Processing timed out'
});
```

#### `updateFileMetadata(id: string, meta: Partial<FileMeta>): Promise<File | null>`

Updates only the `meta` field (name, contentType, size, custom data).

_Use case:_ Updating file metadata after processing or user edits

#### `deleteFile(id: string): Promise<boolean>`

Hard deletes a file record.

_Cascade:_
- `chat_file` records with this fileId are automatically deleted (FK ON DELETE CASCADE)

_Manual cleanup required in application code:_
- Physical file at `{DATA_DIR}/uploads/{path}` (use `fs.unlink()` or equivalent)
- Vector database collection named `file-{id}` (use `VECTOR_DB_CLIENT.delete()`)

_Note:_ Database CASCADE only removes DB records, not filesystem files. The application must explicitly delete the physical file.

_Use case:_ File deletion endpoint

#### `deleteAllFiles(): Promise<boolean>`

_Admin only:_ Deletes all file records from the database.

_Cascade:_
- All junction table records are automatically deleted (FK ON DELETE CASCADE)

_Manual cleanup required in application code:_
- All physical files in `{DATA_DIR}/uploads/` (iterate and delete, or remove directory)
- All vector database collections (use `VECTOR_DB_CLIENT.reset()`)

_Note:_ This is a destructive operation. Consider backing up files before deletion.

---

### Search & Filtering

#### `searchFiles(userId?: string, filename: string, skip?: number, limit?: number): Promise<File[]>`

Searches files by filename with glob pattern matching.

_Parameters:_
- `userId` - Optional: filter by owner. If null, searches all files (admin)
- `filename` - Glob pattern: `*` matches any, `?` matches single char
- `skip` - Pagination offset (default: 0)
- `limit` - Page size (default: 100, max: 1000)

_Behavior:_
- Case-insensitive SQL ILIKE matching
- Converts glob patterns: `*` → `%`, `?` → `_`
- Returns empty array if no matches (caller should check for 404)
- Ordered by `updatedAt DESC`

_Examples:_
- `*.pdf` - All PDF files
- `report_?.doc` - Files like report_1.doc, report_2.doc
- `image*` - Files starting with "image"

_Returns:_ Array of matching files

---

### File-Chat Operations

#### `insertChatFiles(chatId: string, messageId: string | null, fileIds: string[], userId: string): Promise<ChatFile[] | null>`

Associates files with a chat/message.

_Parameters:_
- `chatId` - Chat to associate files with
- `messageId` - Optional: specific message the files relate to
- `fileIds` - Array of file IDs to attach
- `userId` - User who owns the chat

_Behavior:_
- Creates `chat_file` records for each file
- Prevents duplicate associations (checks existing records)
- Filters out null/empty fileIds
- Returns null on error

_Example:_
```typescript
// Attach files to a specific message
await insertChatFiles(chatId, 'msg-123', ['file-1', 'file-2'], userId);

// Attach files at chat level (for later messages)
await insertChatFiles(chatId, null, ['file-1'], userId);
```

#### `getChatFiles(chatId: string, messageId?: string): Promise<ChatFile[]>`

Retrieves files associated with a chat/message.

_Parameters:_
- `chatId` - Chat ID
- `messageId` - Optional: specific message. If null, returns chat-level files

_Returns:_ Array of `chat_file` records (sorted by createdAt ascending)

#### `deleteChatFile(chatId: string, fileId: string): Promise<boolean>`

Removes a file association from a chat.

_Note:_ Only removes the `chat_file` association; file itself remains in `file` table

#### `getSharedChatsByFileId(fileId: string): Promise<Chat[]>`

Retrieves all chats (shared or otherwise) that have a specific file attached.

_Use case:_ File deletion cleanup (find all chats using a file before deletion)

_Returns:_ Array of chat records

---

### Access Control

#### `hasFileAccess(fileId: string, userId: string, accessType: 'read' | 'write'): Promise<boolean>`

Checks if user has access to a file.

_Access checks (in order)_ - returns true if ANY is satisfied:
1. User owns file (`file.user_id == userId`)
2. User is admin
3. User/group has explicit permission in `accessControl`
4. File is in user's shared chats

_Use case:_ Authorization before file operations

#### `updateFileAccessControl(id: string, accessControl: AccessControl): Promise<File | null>`

Updates file's granular access control permissions.

_Example:_
```typescript
const updated = await updateFileAccessControl(fileId, {
    read: {
        groupIds: ['group-1'],
        userIds: ['user-2']
    },
    write: {
        groupIds: ['group-1']
    }
});
```

---

## Special Logic & Considerations

### Timestamp Handling

- All timestamps are **unix seconds** (NOT milliseconds)
- Timestamps stored in `created_at`, `updated_at`
- When setting: `Math.floor(Date.now() / 1000)`

### File Upload Flow

1. **Receive upload** → Validate extension, get file size
2. **Generate UUID** → For file ID
3. **Write to filesystem** → Save to `{DATA_DIR}/uploads/{uuid}_{filename}` using `fs.writeFile()` or stream
4. **Create file record** → Insert to `file` table with:
   - `path`: `{uuid}_{filename}` (relative path)
   - `filename`: Original filename
   - `meta.size`: File size in bytes
   - `data.status`: `'pending'` if processing enabled
5. **Background processing** → If `processInBackground=true`, queue async job
6. **Extract content** → Varies by file type:
   - **Audio**: Transcribe via speech-to-text → store in `data.content`
   - **Images/Video**: OCR and content extraction → store in `data.content`
   - **Documents**: Text extraction → store in `data.content`
7. **Update status** → Set `status: completed` and store extracted `content`
8. **Create vector collection** → Named `file-{id}` for semantic search

### File Hash Calculation

- Hash computed after successful upload
- Used for deduplication checks
- Typically SHA256
- Set via `updateFileHash()` operation

### File Storage Paths

- Filesystem location: `{DATA_DIR}/uploads/{uuid}_{filename}`
- Database `path` column stores: `{uuid}_{filename}` (relative to uploads directory)
- Full path constructed as: `path.join(DATA_DIR, 'uploads', file.path)`
- **NOT exposed to API** - Only returned in full `FileModel` for internal use
- API responses should exclude `path` field (use `FileModelResponse` instead)
- File serving: Read from filesystem and stream to client

### File Processing Status States

```
pending → Processing queued or in progress
  ↓
completed → Processing finished, content extracted

pending or any state → failed → Error during processing
```

**State transitions:**
- Upload with `process=false` → No `data.status` field
- Upload with `process=true` → `data.status = 'pending'`
- Background processing → Status remains "pending" until completion
- Completion → `data.status = 'completed'`, `data.content` populated
- Error → `data.status = 'failed'`, `data.error` populated

### Vector Database Integration

- Each file gets vector collection named `file-{id}`
- Documents chunked and embedded for semantic search
- Collection metadata includes: fileId, createdBy, source, contentType
- On file deletion: Collection `file-{id}` must be deleted from vector DB
- On content update: Collection must be re-indexed with new content
- Admin "delete all files" → Vector DB must be completely reset

---

## Transaction Examples

### File Upload (Complete Flow)

```typescript
import fs from 'fs/promises';
import path from 'path';

// 1. Write file to filesystem (BEFORE transaction)
const fileId = crypto.randomUUID();
const filename = `${fileId}_${originalFilename}`;
const uploadDir = path.join(DATA_DIR, 'uploads');
const filePath = path.join(uploadDir, filename);

// Ensure upload directory exists
await fs.mkdir(uploadDir, { recursive: true });

// Write file content
await fs.writeFile(filePath, fileBuffer);
const stats = await fs.stat(filePath);

// 2. Create database record (in transaction)
await db.transaction(async (tx) => {
    const fileRecord = await createFile(userId, {
        id: fileId,
        filename: originalFilename,
        path: filename,  // Store relative path only
        meta: {
            name: originalFilename,
            contentType: mimeType,
            size: stats.size,
            data: userMetadata
        },
        data: {
            status: 'pending'  // Processing will continue in background
        }
    }, tx);

    return fileRecord;
});

// 3. Queue background processing (outside transaction)
if (processInBackground) {
    backgroundTasks.add(
        processUploadedFile,
        fileId, filePath, userMetadata, user
    );
}
```

### File Deletion with Cleanup

```typescript
import fs from 'fs/promises';
import path from 'path';

// 1. Delete database record in transaction
let file;
await db.transaction(async (tx) => {
    // Verify ownership
    file = await getFileByIdAndUserId(fileId, userId, tx);
    if (!file) throw new Error('File not found');

    // Find all chats using this file
    const affectedChats = await getSharedChatsByFileId(fileId, tx);

    // Delete file record (cascades to chat_file via FK)
    const deleted = await deleteFile(fileId, tx);
    if (!deleted) throw new Error('Failed to delete file');

    return { file, affectedChats };
});

// 2. After successful DB deletion, delete physical file
const filePath = path.join(DATA_DIR, 'uploads', file.path);
try {
    await fs.unlink(filePath);
} catch (err) {
    // Log warning if file doesn't exist (already deleted or never created)
    console.warn(`File not found on disk: ${filePath}`);
}

// 3. Delete vector database collection
await VECTOR_DB_CLIENT.deleteCollection(`file-${fileId}`);
```

### Content Update and Reprocessing

```typescript
await db.transaction(async (tx) => {
    // 1. Get current file
    const file = await getFileById(fileId, tx);
    if (!file) throw new Error('File not found');

    // 2. Update content
    const updated = await updateFileData(fileId, {
        content: newContent,
        status: 'pending'  // Mark for reprocessing
    }, tx);

    return updated;
});

// 3. After transaction, trigger reprocessing
await processFile(fileId, newContent, user);
```

---

## Migration from Mock Data

When implementing database operations:

1. _GET `/api/v1/files/`_ → Use `getFilesByUserId()` or `getFiles()` for admins
2. _POST `/api/v1/files/`_ → Write file to filesystem, then use `createFile()` to create DB record
3. _GET `/api/v1/files/search`_ → Use `searchFiles()` with glob pattern
4. _DELETE `/api/v1/files/all`_ → Use `deleteAllFiles()` (admin only)
5. _GET `/api/v1/files/{file_id}`_ → Use `getFileById()` with access check
6. _DELETE `/api/v1/files/{file_id}`_ → Use `deleteFile()` with ownership check
7. _GET `/api/v1/files/{file_id}/content`_ → Retrieve from `file.path` on local filesystem
8. _GET `/api/v1/files/{file_id}/content/{file_name}`_ → Same as above, with filename override
9. _GET `/api/v1/files/{file_id}/content/html`_ → Return raw file, admin-owned only
10. _GET `/api/v1/files/{file_id}/data/content`_ → Return `file.data.content` field
11. _POST `/api/v1/files/{file_id}/data/content/update`_ → Use `updateFileData()` with reprocessing
12. _GET `/api/v1/files/{file_id}/process/status`_ → Return `file.data.status` field (with SSE if streaming)
