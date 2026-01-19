# Files API Specification

**Note:** This implementation differs from OpenWebUI by using `:file_id` instead of `:id` in path parameters for consistency and clarity. This makes the API more explicit and easier to understand when working with file-related routes.

## Endpoints

**Context:** Core file management - upload, download, and process files for multimodal chat and attachments.

These endpoints handle file uploads (images, documents, audio), file retrieval, content extraction, and file lifecycle management. Files are user-scoped with granular access control, support multiple storage backends (local, S3, GCS, Azure), and integrate with vector databases for semantic search. Essential for multimodal models (images) and document chat functionality.

---

### GET `/api/v1/files/`

Get all files accessible to the current user.

#### Inputs

**Query Parameters:** [`FileListQuery`](#filelistquery)

#### Outputs

Response (200): Array of [`FileModelResponse`](#filemodelresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:348`
  - Method: `list_files()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can access their own files
  - Admin users see all files (no user_id filtering)
- _OWUI Implementation Notes:_
  - Admin users: returns all files in database
  - Regular users: returns only files where `user_id` matches current user
  - `content=false` query param excludes file content field to reduce response size
  - Returns `FileModelResponse` array (excludes internal `path` field)

---

### POST `/api/v1/files/`

Upload a new file with optional automatic processing.

#### Inputs

**Query Parameters:** [`UploadFileQuery`](#uploadfilequery)

**Request Body:** Multipart form-data - [`UploadFileForm`](#uploadfileform)

#### Outputs

Response (200): [`FileModelResponse`](#filemodelresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:192`
  - Method: `upload_file()` wraps `upload_file_handler()` (line 215-340)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Any verified user can upload files
- _OWUI Implementation Notes:_
  - Validates file extension against `ALLOWED_FILE_EXTENSIONS` config
  - Generates UUID for file ID
  - Uploads to configured storage provider (local/S3/GCS/Azure)
  - Adds metadata tags: user email, ID, name, file ID
  - **File processing pipeline:**
    - Audio files: Transcribed via speech-to-text
    - Images/Video: Content extraction and OCR
    - Documents: Text extraction via multiple engines (Marker, Tika, Docling, etc.)
    - Creates vector database collection named `file-{id}` for semantic search
  - Processing status stored in `file.data.status`: "pending", "completed", "failed"
  - Returns immediately with file record; processing continues in background if enabled
  - Returns 400 BAD_REQUEST on invalid extension or upload error

---

### GET `/api/v1/files/search`

Search files using glob patterns (wildcards).

#### Inputs

**Query Parameters:** [`FileSearchQuery`](#filesearchquery)

#### Outputs

Response (200): Array of [`FileModelResponse`](#filemodelresponse)
Response (404): If no files match the pattern

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:372`
  - Method: `search_files()`
  - Database: `FilesTable.search_files()` (line 236-257)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Regular users can only search their own files
  - Admin users see all files across all users
- _OWUI Implementation Notes:_
  - Glob pattern conversion: `*` → `%` (any chars), `?` → `_` (single char)
  - Case-insensitive matching via SQL `ILIKE`
  - Examples: `*.pdf`, `report_?.doc`, `image*`
  - Pagination via skip/limit (max 1000 results)
  - `content` parameter defaults to `true` - set to `false` to exclude file content
  - Returns empty array with 404 status if no matches

---

### DELETE `/api/v1/files/all`

**Admin Only:** Delete all files from the system.

#### Inputs

None

#### Outputs

Response (200): `{"message": string}` - Returns success message

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:421`
  - Method: `delete_all_files()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Admin only (`get_admin_user` dependency)
- _OWUI Implementation Notes:_
  - Deletes all file records from database
  - Deletes all physical files from storage provider
  - Resets vector database (deletes all file collections)
  - Destructive operation - no undo
  - Use with extreme caution

---

### GET `/api/v1/files/{file_id}`

Get file metadata by ID.

#### Inputs

**Path Parameters:**
- `file_id` (string, required) - File ID

#### Outputs

Response (200): [`FileModel`](#filemodel)
Response (404): If file not found or user lacks access

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:450`
  - Method: `get_file_by_id()`
  - Access control: `has_access_to_file()` (line 65-110)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Access granted if:
    - User owns the file (file.user_id == user.id), OR
    - User is admin, OR
    - File is in user's accessible knowledge base, OR
    - File is in user's accessible channel, OR
    - File is in user's shared chats
- _OWUI Implementation Notes:_
  - Returns 404 if file doesn't exist or user lacks access
  - Multi-layered access control checks knowledge bases, channels, and chats
  - Returns full `FileModel` with all metadata and internal path

---

### DELETE `/api/v1/files/{file_id}`

Delete a specific file.

#### Inputs

**Path Parameters:**
- `file_id` (string, required) - File ID to delete

#### Outputs

Response (200): `{"message": string}` - Returns success message

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:810`
  - Method: `delete_file_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Write access required (owner, admin, or write access to associated resources)
- _OWUI Implementation Notes:_
  - Deletes file record from database via `Files.delete_file_by_id()`
  - Deletes physical file from storage provider
  - Cleans vector database: deletes collection named `file-{id}`
  - Access control checks same as GET (owner, admin, or associated resource access)
  - Returns 404 if file not found or user lacks write access

---

### GET `/api/v1/files/{file_id}/content`

Download file content directly.

#### Inputs

**Path Parameters:**
- `file_id` (string, required) - File ID

**Query Parameters:** [`FileContentQuery`](#filecontentquery)

#### Outputs

Response (200): File content with appropriate Content-Type and Content-Disposition headers

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:622`
  - Method: `get_file_content_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Read access required (owner, admin, or read access to associated resources)
- _OWUI Implementation Notes:_
  - Returns `FileResponse` with proper content type detection
  - Filename encoding uses RFC5987 for Unicode support
  - PDF files: Content-Disposition defaults to `inline` for browser viewing
  - Other files: Controlled by `attachment` query param
  - Returns 404 if file not found or user lacks access

---

### GET `/api/v1/files/{file_id}/content/{file_name}`

Download file content with specific filename.

#### Inputs

**Path Parameters:**
- `file_id` (string, required) - File ID
- `file_name` (string, required) - Desired filename for download

#### Outputs

Response (200): File content or extracted text content with specified filename

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:746`
  - Method: `get_file_content_by_id()` (duplicate function name)
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Read access required
- _OWUI Implementation Notes:_
  - Unicode filename handling via RFC5987 encoding
  - If physical file path exists: returns `FileResponse` with file content
  - If no physical file: falls back to streaming extracted text from `file.data.content`
  - Returns `StreamingResponse` for text content fallback
  - Returns 404 if file not found or user lacks access

---

### GET `/api/v1/files/{file_id}/content/html`

Get file content as raw HTML (admin-owned files only).

#### Inputs

**Path Parameters:**
- `file_id` (string, required) - File ID

#### Outputs

Response (200): Raw file content

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:695`
  - Method: `get_html_file_content_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - **Restricted to admin-owned files only** (file.user_id must be admin)
  - Access control checks applied
- _OWUI Implementation Notes:_
  - Returns raw file as response
  - Only works for files owned by admin users
  - Security restriction to prevent unauthorized access to sensitive files
  - Returns 404 if file not found, not admin-owned, or user lacks access

---

### GET `/api/v1/files/{file_id}/data/content`

Get extracted text content from processed file.

#### Inputs

**Path Parameters:**
- `file_id` (string, required) - File ID

#### Outputs

Response (200): `{"content": string}` - Extracted text content from file.data.content

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:543`
  - Method: `get_file_data_content_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Read access required
- _OWUI Implementation Notes:_
  - Returns content extracted during file processing
  - Stored in `file.data["content"]` after processing completes
  - Empty if file hasn't been processed yet
  - Returns 404 if file not found or user lacks access

---

### POST `/api/v1/files/{file_id}/data/content/update`

Update file's extracted content and reprocess.

#### Inputs

**Path Parameters:**
- `file_id` (string, required) - File ID

**Request Body:** [`ContentForm`](#contentform)

#### Outputs

Response (200): [`FileModelResponse`](#filemodelresponse)

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:577`
  - Method: `update_file_data_content_by_id()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Write access required (owner, admin, or write access to associated resources)
- _OWUI Implementation Notes:_
  - Updates `file.data["content"]` with provided content
  - Triggers file reprocessing via `process_file()`
  - Updates vector database with new content
  - Returns updated file model
  - Returns 404 if file not found or user lacks write access

---

### GET `/api/v1/files/{file_id}/process/status`

Get file processing status with optional streaming.

#### Inputs

**Path Parameters:**
- `file_id` (string, required) - File ID

**Query Parameters:** [`FileProcessStatusQuery`](#fileprocessstatusquery)

#### Outputs

**Non-streaming mode (stream=false):**
Response (200): `{"status": string}`
- Status values: "pending", "completed", "failed"

**Streaming mode (stream=true):**
Response (200): `text/event-stream` - SSE stream with status updates
- Each event: `data: {"status": string, "error"?: string}\n\n`
- Status values: "pending", "completed", "failed", "not_found"
- Error field present if status is "failed"
- Stream continues until status is "completed" or "failed"

#### Notes

- _Reference Implementation:_
  - File: `/home/fox/open-webui/backend/open_webui/routers/files.py:475`
  - Method: `get_file_process_status()`
- _Security:_
  - Requires `HTTPBearer` authentication (JWT token)
  - Read access required
- _OWUI Implementation Notes:_
  - **Non-streaming mode:** Returns current status immediately
  - **Streaming mode (`stream=true`):**
    - Returns SSE (Server-Sent Events) stream
    - Polls status every 1 second (default)
    - Continues until status is "completed" or "failed"
    - Maximum polling duration: 2 hours
  - Status stored in `file.data["status"]`
  - Error message stored in `file.data["error"]` on failure
  - Returns 404 if file not found or user lacks access

---

## Definitions

### `UploadFileForm`

Multipart form-data for file upload.

```typescript
{
    file: binary;                           // Required - file to upload
    metadata?: object | string | null;      // Optional - custom metadata (JSON or string)
}
```

**Fields:**
- `file` - Binary file data (required)
- `metadata` - Custom metadata, can be:
  - JSON object: `{"channel_id": "...", "custom_field": "..."}`
  - String: Additional information as text
  - Null: No metadata

**Common metadata fields:**
- `channel_id` - Associate file with channel
- Custom user-defined fields

---

### `FileModelResponse`

API response model for file metadata (excludes internal path field).

```typescript
{
    id: string;
    user_id: string;
    hash: string | null;
    filename: string;
    data: FileData | null;      // Processing status, error, content
    meta: FileMeta;             // File metadata
    created_at: number;         // Unix timestamp (seconds)
    updated_at: number;         // Unix timestamp (seconds)
}
```

**Fields:**
- `id` - Unique file identifier (UUID)
- `user_id` - Owner user ID
- `hash` - File content hash (nullable)
- `filename` - Original filename
- `data` - Processing info (see [`FileData`](#filedata))
- `meta` - File metadata (see [`FileMeta`](#filemeta))
- `created_at` - Upload timestamp (Unix seconds)
- `updated_at` - Last update timestamp (Unix seconds)

**Note:** Excludes `path` and `access_control` fields from `FileModel`

---

### `FileModel`

Full file representation with all fields including internal path.

```typescript
{
    id: string;
    user_id: string;
    hash: string | null;
    filename: string;
    path: string | null;           // Internal storage path
    data: FileData | null;         // Processing status, error, content
    meta: FileMeta | null;         // File metadata
    access_control: AccessControl; // Granular access control rules
    created_at: number | null;
    updated_at: number | null;
}
```

**Additional fields vs FileModelResponse:**
- `path` - Internal file storage path (should not be exposed to clients)
- `access_control` - Access control rules for read/write permissions (see [`AccessControl`](#accesscontrol))
- `data` - Can be more flexible/nullable in the full model (see [`FileData`](#filedata))
- `meta` - Can be null in the full model (see [`FileMeta`](#filemeta))

---

### `FileMeta`

File metadata structure.

```typescript
{
    name: string;            // Display name
    content_type: string;    // MIME type
    size: number;            // File size in bytes
    data?: object;           // Custom user metadata
}
```

**Common content types:**
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Documents: `application/pdf`, `application/msword`, `text/plain`
- Audio: `audio/mpeg`, `audio/wav`

---

### `ContentForm`

Request form for updating file content.

```typescript
{
    content: string;  // Required - new text content for file
}
```

**Notes:**
- Used to manually update extracted file content
- Triggers reprocessing and vector database update

---

### `FileData`

Structure of the `data` JSON field in file records.

```typescript
{
    status?: "pending" | "completed" | "failed";
    error?: string;    // Error message if status is "failed"
    content?: string;  // Extracted text content from file
}
```

**Processing status lifecycle:**
1. `pending` - File uploaded, processing queued
2. `completed` - Processing finished successfully, content extracted
3. `failed` - Processing error occurred, see error field

---

### `AccessControl`

Structure of the `access_control` JSON field (same as other resources). Can be null.

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
} | null
```

**Access resolution:**
- User owns file (file.user_id == user.id)
- User is admin
- File in user's accessible knowledge base
- File in user's accessible channel
- File in user's shared chats
- User/group IDs in access_control permissions

---

### `FileListQuery`

Query parameters for listing files.

```typescript
{
    content?: boolean;  // If false, excludes file content from response (default: include)
}
```

**Notes:**
- Use `content=false` to reduce payload size when listing many files
- Omit parameter or use `content=true` to include full file data

---

### `UploadFileQuery`

Query parameters for file upload.

```typescript
{
    process?: boolean;              // Whether to process file for content extraction (default: true)
    process_in_background?: boolean;  // Process asynchronously if true (default: true)
}
```

**Notes:**
- Set `process=false` to skip automatic file processing
- Background processing (`process_in_background=true`) allows immediate response while processing continues

---

### `FileSearchQuery`

Query parameters for file search.

```typescript
{
    filename: string;     // Required - Filename pattern (supports * and ? wildcards)
    content?: boolean;    // Optional - Include file content in response (default: true)
    skip?: number;        // Optional - Pagination offset (default: 0)
    limit?: number;       // Optional - Max results (default: 100, max: 1000)
}
```

**Filename patterns:**
- `*` - Matches any number of characters
- `?` - Matches single character
- Examples: `*.pdf`, `report_?.doc`, `image*`
- Uses SQL ILIKE for case-insensitive matching

---

### `FileContentQuery`

Query parameters for file content download.

```typescript
{
    attachment?: boolean;  // Forces download with Content-Disposition: attachment (default: false)
}
```

**Notes:**
- PDF files default to `inline` disposition (browser viewing)
- Other files controlled by `attachment` parameter
- Set `attachment=true` to force download instead of inline display

---

### `FileProcessStatusQuery`

Query parameters for file processing status.

```typescript
{
    stream?: boolean;  // Enable SSE streaming of status updates (default: false)
}
```

**Streaming mode (`stream=true`):**
- Returns `text/event-stream` with Server-Sent Events
- Polls status every 1 second
- Continues until status is "completed" or "failed"
- Maximum polling duration: 2 hours

**Non-streaming mode (`stream=false`):**
- Returns current status immediately as JSON

---

### Storage Provider Configuration

Files are stored using a pluggable storage provider system:

**Supported backends:**
- **Local**: File system storage in `UPLOAD_DIR`
- **S3**: AWS S3 buckets
- **GCS**: Google Cloud Storage
- **Azure**: Azure Blob Storage

**File tagging:**
All uploaded files are tagged with metadata:
- User email, ID, name
- File ID
- Timestamps

---

### File Processing Pipeline

**Supported file types and processing:**

1. **Audio files** (`.mp3`, `.wav`, etc.)
   - Transcribed via speech-to-text
   - Transcript stored in `data.content`

2. **Images and video**
   - OCR for text extraction
   - Content description generation
   - Image analysis

3. **Documents** (`.pdf`, `.docx`, `.txt`, etc.)
   - Text extraction via multiple engines:
     - Datalab Marker (default)
     - Apache Tika Server
     - Docling
     - Azure Document Intelligence
     - Mistral OCR
     - MinerU
   - Table detection and extraction
   - Layout preservation

**Vector database integration:**
- Each file gets collection named `file-{id}`
- Documents chunked and embedded for semantic search
- Metadata includes: file_id, created_by, source, content_type
