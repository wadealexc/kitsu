# Chat Database Model

## Overview

The Chat model stores conversation data, including message history, metadata, and sharing information. It supports multi-user access with folder organization, pinning, archiving, and public sharing capabilities.

References:
- _OWUI Implementation:_ `open-webui/backend/open_webui/models/chats.py`
- _OWUI Routes:_ `open-webui/backend/open_webui/routers/chats.py`
- _Our Route Spec:_ `/docs/routes/chats.md`

---

## Table Schema

### Table Name: `chat`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY, UNIQUE | Chat ID (UUID v4 or "local:<socket_id>" for temporary chats) |
| `user_id` | TEXT | NOT NULL, INDEX, FK → user(id) ON DELETE CASCADE | Owner's user ID (UUID v4) |
| `title` | TEXT | NOT NULL | Chat title (human-readable conversation name) |
| `chat` | JSON | NOT NULL | Flexible JSON structure containing messages and conversation history |
| `created_at` | BIGINT | NOT NULL, INDEX | Creation timestamp (unix seconds) |
| `updated_at` | BIGINT | NOT NULL, INDEX | Last update timestamp (unix seconds) |
| `share_id` | TEXT | UNIQUE, NULLABLE | Public share ID (UUID v4) for shared chats; null if not shared |
| `archived` | BOOLEAN | NOT NULL, DEFAULT: false | Whether chat is archived (hidden but not deleted) |
| `pinned` | BOOLEAN | NULLABLE, DEFAULT: false | Whether chat is pinned (appears at top of list) |
| `meta` | JSON | NULLABLE, DEFAULT: `{}` | Custom metadata object (flexible JSON; stores custom properties) |
| `folder_id` | TEXT | NULLABLE, INDEX, FK → folder(id) ON DELETE SET NULL | Folder ID if chat is organized in folder; null if at root |

### Indexes

```sql
-- Performance indexes for common queries
CREATE INDEX idx_folder_id ON chat(folder_id);
CREATE INDEX idx_user_id_pinned ON chat(user_id, pinned);
CREATE INDEX idx_user_id_archived ON chat(user_id, archived);
CREATE INDEX idx_updated_at_user_id ON chat(updated_at, user_id);
CREATE INDEX idx_folder_id_user_id ON chat(folder_id, user_id);

-- Unique constraints
CREATE UNIQUE INDEX idx_chat_id ON chat(id);
CREATE UNIQUE INDEX idx_chat_share_id ON chat(share_id);
```

**Notes on Indexes:**
- Composite indexes optimize filtered list queries (user_id + pinned/archived)
- `updated_at` index enables efficient sorting for "recent chats" queries
- `folder_id` index supports folder-based chat organization
- `share_id` is unique because only one chat can be shared under a given share_id

### Constraints

```sql
-- Foreign keys
FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE;
FOREIGN KEY (folder_id) REFERENCES folder(id) ON DELETE SET NULL;
```

**Cascade Behavior:**
- When a user is deleted, all their chats are automatically deleted
- When a folder is deleted, chats in that folder have their `folder_id` set to NULL (moved to root)
- When a chat is deleted, all associated `chat_file` records are automatically deleted (via FK on chat_file table)

### Chat JSON Structure

The `chat` column stores a flexible JSON object with conversation history. **Example structure:**

```json
{
    "title": "Planning Project X",
    "history": {
        "messages": {
            "msg-id-1": {
                "id": "msg-id-1",
                "role": "user",
                "content": "What are your thoughts?",
                "timestamp": 1704067200,
                "parentId": null
            },
            "msg-id-2": {
                "id": "msg-id-2",
                "role": "assistant",
                "content": "I think...",
                "model": "gpt-4",
                "timestamp": 1704067205,
                "parentId": "msg-id-1",
                "statusHistory": [
                    { "status": "pending", "timestamp": 1704067200 },
                    { "status": "completed", "timestamp": 1704067205 }
                ],
                "files": [
                    { "id": "file-id-123", "name": "document.pdf", "type": "application/pdf" }
                ]
            }
        },
        "currentId": "msg-id-2"
    }
}
```

**Key Fields in `chat` JSON:**
- `title` - Conversation title (also duplicated in chat.title column)
- `history` - Message history object
  - `messages` - Map of message_id → message object
    - Message contains: id, role, content, timestamp, parentId, model (optional), statusHistory (optional), files (optional)
  - `currentId` - ID of the last message in conversation thread

### Metadata JSON Structure

The `meta` column stores flexible metadata. **Example:**

```json
{
    "custom_field": "value"
}
```

**Key Fields in `meta` JSON:**
- Flexible structure for application-specific metadata

---

## Chat File Relationship

### Table Name: `chat_file`

Files attached to chat messages are tracked in a separate junction table for referential integrity.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY, UNIQUE | Record ID (UUID v4) |
| `user_id` | TEXT | NOT NULL, FK → user(id) | User who owns the chat |
| `chat_id` | TEXT | NOT NULL, FK → chat(id) ON DELETE CASCADE | Associated chat ID |
| `message_id` | TEXT | NULLABLE | Associated message ID (null if chat-level file) |
| `file_id` | TEXT | NOT NULL, FK → file(id) ON DELETE CASCADE | Associated file ID |
| `created_at` | BIGINT | NOT NULL | Creation timestamp (unix seconds) |
| `updated_at` | BIGINT | NOT NULL | Last update timestamp (unix seconds) |

### Constraints

```sql
-- Unique constraint to prevent duplicate file-chat associations
CREATE UNIQUE CONSTRAINT uq_chat_file_chat_file
ON chat_file(chat_id, file_id);

-- Foreign keys
FOREIGN KEY (user_id) REFERENCES user(id);
FOREIGN KEY (chat_id) REFERENCES chat(id) ON DELETE CASCADE;
FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE;
```

---

## Operations

### Core CRUD Operations

#### `createChat(userId: string, data: ChatForm): Promise<Chat>`

_Transaction:_ No (but should be atomic)

Creates a new chat for a user.

_Required fields:_
- `userId` - User who owns the chat
- `data.chat` - Chat data object (must contain at least `{title, history}`; can be flexible)
- `data.folderId` (optional) - Folder ID to organize chat

_Auto-generated fields:_
- `id` - UUID v4
- `createdAt` - Current unix timestamp (in seconds)
- `updatedAt` - Current unix timestamp (in seconds)
- `title` - Extracted from `data.chat.title` or default "New Chat"
- `archived` - Defaults to false
- `pinned` - Defaults to false
- `meta` - Defaults to `{}`
- `shareId` - Defaults to null

_Notes:_
- Title is extracted from `chat.title` field and stored in both `chat` JSON and `title` column for indexing
- All null bytes in title and chat JSON must be sanitized before insertion
- Folder ID can be provided to organize the chat immediately

_Example:_
```typescript
const chat = await createChat(userId, {
    chat: {
        title: "My Project Discussion",
        history: { messages: {}, currentId: null }
    },
    folderId: "folder-123"
});
```

#### `getChatById(id: string): Promise<Chat | null>`

Retrieves full chat by ID, including all messages.

_Use case:_ Fetching specific chat for display/editing

_Notes:_
- Returns null if not found
- May need to sanitize null bytes from retrieved data

#### `getChatByIdAndUserId(id: string, userId: string): Promise<Chat | null>`

Retrieves chat by ID, verifying ownership.

_Security:_ Used for ownership verification before operations like update/delete

#### `getChatByShareId(shareId: string): Promise<Chat | null>`

Retrieves chat by its public share ID (for shared chat viewing).

_Security:_ No user verification - allows public access to shared chats

#### `getChats(options?: { skip?: number, limit?: number }): Promise<Chat[]>`

_Admin only:_ Retrieves ALL chats from ALL users (no filtering).

_Use case:_ Admin data export/backup

#### `getChatsByUserId(userId: string, options?: QueryOptions): Promise<{ items: Chat[], total: number }>`

_Pagination:_ Default 50 items per page

Retrieves all chats for a specific user.

_Options:_
```typescript
type QueryOptions = {
    skip?: number;                           // Pagination offset
    limit?: number;                          // Page size
    filter?: {
        query?: string;                      // Search text
        updatedAt?: number;                  // Filter chats updated after this timestamp
        orderBy?: 'updatedAt' | 'createdAt' | 'title';
        direction?: 'asc' | 'desc';
    };
};
```

_Notes:_
- Default sort: `updatedAt DESC` (most recent first)
- Must return total count for pagination

#### `getChatTitleIdListByUserId(userId: string, options?: ListOptions): Promise<ChatTitleIdResponse[]>`

_Pagination:_ Default 60 items per page

Retrieves minimal chat info (title, id, timestamps) without message history.

_Options:_
```typescript
type ListOptions = {
    includeArchived?: boolean;               // Default: false
    includeFolders?: boolean;                // Default: false
    includePinned?: boolean;                 // Default: false
    skip?: number;                           // Pagination offset
    limit?: number;                          // Page size (60 by default if paging)
};
```

_Use case:_ Chat list views (sidebar, etc.) where full message history not needed

#### `getChatsByFolderIdAndUserId(folderId: string, userId: string, options?: PaginationOptions): Promise<Chat[]>`

Retrieves chats in a specific folder.

_Security:_ Filters by userId to prevent cross-user access

_Filtering:_
- Excludes pinned chats
- Excludes archived chats
- Default sort: `updatedAt DESC`

#### `updateChat(id: string, data: ChatForm): Promise<Chat | null>`

Updates chat data and title.

_Auto-updated fields:_
- `updatedAt` - Set to current unix timestamp

_Behavior:_
- Merges provided chat data with existing chat
- Extracts new title from `data.chat.title` if provided
- Sanitizes null bytes from title and chat JSON before saving
- Returns null if chat not found

_Notes:_
- Full merge: `{...existing.chat, ...new_data.chat}`
- Title updated both in `title` column and in `chat.title` JSON field

#### `updateChatFolderIdByIdAndUserId(id: string, userId: string, folderId: string | null): Promise<Chat | null>`

Moves chat to a folder (or removes from folder if folderId is null).

_Side effects:_
- Sets `pinned = false` when moving to folder (can't be pinned in folder)
- Updates `updatedAt` timestamp

#### `updateChatShareIdById(id: string, shareId: string | null): Promise<Chat | null>`

Updates the share_id for a chat.

_Parameters:_
- `shareId` - New share ID (UUID v4), or null to unshare

#### `updateChatPinnedById(id: string): Promise<Chat | null>`

Toggles pinned status.

_Notes:_
- Automatically updates `updatedAt`
- Converts `pinned: null` to `pinned: false` before toggling

#### `updateChatArchivedById(id: string): Promise<Chat | null>`

Toggles archived status.

_Side effects:_
- Clears `folderId` when archiving (archived chats can't be in folders)
- Automatically updates `updatedAt`

#### `deleteChat(id: string): Promise<boolean>`

_Security:_ Should verify ownership (use `deleteChatByIdAndUserId` instead)

Deletes a chat by ID (hard delete).

_Cascade:_
- chat_file records with this chatId are automatically deleted (FK ON DELETE CASCADE)
- Shared chat records are also deleted

#### `deleteChatByIdAndUserId(id: string, userId: string): Promise<boolean>`

Deletes a chat with ownership verification.

_Security:_ Ensures user owns the chat before deletion

#### `deleteAllChatsByUserId(userId: string): Promise<boolean>`

Deletes all chats for a user (cannot be undone).

_Use case:_ Account deletion or user requested deletion

---

### Search & Filtering

#### `getChatsByUserIdAndSearchText(userId: string, searchText: string, options?: SearchOptions): Promise<Chat[]>`

Searches chats by title and message content with advanced filtering.

_Search syntax:_
- Plain text: searches chat title and message content
- `folder:<folder_name>` - Filter by folder
- `pinned:true|false` - Filter by pinned status
- `archived:true|false` - Filter by archived status
- `shared:true|false` - Filter by share status

_Options:_
```typescript
type SearchOptions = {
    includeArchived?: boolean;
    skip?: number;
    limit?: number;
};
```

_Example queries:_
```
"project planning"                    // Search title + content
"folder:Q1 2024 pinned:true"         // Search in folder, pinned only
```

_Implementation:_
- Database-specific: Uses SQLite JSON1 or PostgreSQL JSON operators
- Client should sanitize search text for database safety

---

### File Operations

#### `insertChatFiles(chatId: string, messageId: string | null, fileIds: string[], userId: string): Promise<ChatFileModel[] | null>`

Associates files with a chat/message.

_Parameters:_
- `chatId` - Chat to associate files with
- `messageId` - Optional: specific message the files relate to
- `fileIds` - Array of file IDs to attach
- `userId` - User who owns the chat

_Behavior:_
- Creates chat_file records for each file
- Prevents duplicate associations (checks existing records)
- Filters out null/empty fileIds

_Example:_
```typescript
// Attach files to a specific message
await insertChatFiles(chatId, messageId, ['file-1', 'file-2'], userId);

// Attach files at chat level
await insertChatFiles(chatId, null, ['file-1'], userId);
```

#### `getChatFiles(chatId: string, messageId: string): Promise<ChatFileModel[]>`

Retrieves files attached to a specific message in a chat.

_Returns:_ Array of chat_file records (sorted by createdAt ascending)

#### `deleteChatFile(chatId: string, fileId: string): Promise<boolean>`

Removes a file attachment from a chat.

_Note:_ Only removes the chat_file association; file itself remains in files table

#### `getSharedChatsByFileId(fileId: string): Promise<Chat[]>`

Retrieves all shared chats that have a specific file attached.

_Use case:_ File deletion cleanup (find all shared chats using a file)

---

### Sharing Operations

#### `insertSharedChat(chatId: string): Promise<Chat | null>`

Creates a publicly shared version of a chat.

_Behavior in OWUI:_
- Creates new "shadow" chat record with special userId: `shared-{original_chat_id}`
- Original chat's `shareId` set to the new chat's id
- Shared chat inherits all data from original

_Returns:_ The shared chat record

_Security Note:_
- OWUI's approach creates a duplicate chat record, which is unusual
- Consider simpler approach: just store share_id on original chat and check it for public access

#### `updateSharedChat(chatId: string): Promise<Chat | null>`

Updates shared chat to reflect original's current state.

_Behavior:_
- Syncs title, chat data, meta, pinned, folderId from original to shared
- Original chat's `shareId` is cleared (set to null)

#### `deleteSharedChat(chatId: string): Promise<boolean>`

Removes share link and associated shared chat record.

_Behavior:_
- Deletes the shared chat record
- Original chat's `shareId` is cleared (set to null)

---

### Message Operations

#### `addMessageToChat(chatId: string, messageId: string, message: object): Promise<Chat | null>`

Adds or updates a message in a chat's message history.

_Parameters:_
- `message` - Message object with: id, role, content, timestamp, parentId, etc.

_Behavior:_
- Upserts message to `chat.history.messages[messageId]`
- Sets `history.currentId` to this messageId
- Sanitizes null bytes from message content
- Updates chat's `updatedAt`

_Example:_
```typescript
const message = {
    id: 'msg-123',
    role: 'user',
    content: 'Hello!',
    timestamp: 1704067200,
    parentId: null
};
await addMessageToChat(chatId, 'msg-123', message);
```

#### `addMessageStatus(chatId: string, messageId: string, status: object): Promise<Chat | null>`

Appends a status update to a message's statusHistory.

_Parameters:_
- `status` - Status object: `{ status: "pending"|"completed"|"error", timestamp, ... }`

_Behavior:_
- Appends to `messages[messageId].statusHistory` array
- Updates chat's `updatedAt`

#### `addMessageFiles(chatId: string, messageId: string, files: object[]): Promise<object[]>`

Appends files to a message.

_Parameters:_
- `files` - Array of file objects: `{ id, name, type, ... }`

_Behavior:_
- Appends to `messages[messageId].files` array
- Also creates chat_file records via `insertChatFiles()`
- Updates chat's `updatedAt`

---

### Archiving & Pinning

#### `archiveAllChatsByUserId(userId: string): Promise<boolean>`

Archives all chats for a user.

_Security:_ Requires userId verification

#### `unarchiveAllChatsByUserId(userId: string): Promise<boolean>`

Unarchives all chats for a user.

#### `getArchivedChats(userId: string, options?: ListOptions): Promise<Chat[]>`

Retrieves archived chats for a user.

_Includes:_
- Pagination support
- Filtering and sorting
- Search text matching

#### `getPinnedChats(userId: string): Promise<Chat[]>`

Retrieves pinned chats for a user.

_Filtering:_
- pinned = true
- archived = false
- Sort by updatedAt DESC

---

### Folder Operations

#### `moveChatsToFolder(userId: string, fromFolderId: string, toFolderId: string | null): Promise<boolean>`

Moves all chats from one folder to another.

_Parameters:_
- `fromFolderId` - Source folder
- `toFolderId` - Destination folder (or null for root)

_Behavior:_
- Updates folderId for all matching chats
- Sets pinned = false for moved chats

#### `deleteChatsInFolder(userId: string, folderId: string): Promise<boolean>`

Deletes all chats in a folder.

_Use case:_ When folder is deleted and user chooses "delete contents"

#### `countChatsInFolder(userId: string, folderId: string): Promise<number>`

Counts chats in a folder.

---

### Import/Export

#### `importChats(userId: string, chats: ChatImportForm[]): Promise<Chat[]>`

Bulk imports chats for a user (for backup restoration).

_Parameters:_
- `chats` - Array of chat objects with optional: meta, pinned, createdAt, updatedAt

_Behavior:_
- Each chat gets new UUID if not provided
- Timestamps can be preserved or set to current time
- All chats assigned to provided userId

_Example:_
```typescript
await importChats(userId, [
    {
        chat: { title: "Old Chat", history: {...} },
        meta: {},
        pinned: false,
        createdAt: 1700000000,
        updatedAt: 1700100000
    }
]);
```

---

## Special Logic & Considerations

### Timestamp Handling

- All timestamps are **unix seconds** (NOT milliseconds)
- Timestamps stored in `created_at`, `updated_at`, and message timestamps
- When comparing: `new Date().getTime() / 1000` to convert

### Title Management

- Chat title stored in TWO places:
  1. `chat.title` column (for efficient indexing/sorting)
  2. `chat.chat.title` JSON field (part of conversation data)
- Keep both in sync on updates

### Null Byte Sanitization

- CRITICAL: SQLAlchemy/Python can corrupt data with null bytes
- Must sanitize BEFORE inserting to database:
  - `title` field
  - `chat` JSON structure
  - Message content
- Use utility function: `sanitize_text_for_db()` / `sanitize_data_for_db()`

### Share ID Generation

- Share ID is a UUID v4 (different from chat ID)
- Unique constraint on shareId ensures only one chat per share link
- When unsharing, set shareId back to null

### Folder Constraints

- Chat can be in at most one folder (folderId can be null or one folderId)
- When archiving a chat in a folder, folderId is cleared
- When moving to folder, pinned is set to false
- Archived chats cannot be in folders

### Pinned Chats

- Visible in `includePinned` mode (defaults to false in list endpoints)
- Not counted in normal chat lists unless explicitly requested
- Pinned status cleared when moving to folder
- Sorting: pinned chats appear first, then sorted by updatedAt

### Archive

- Soft delete pattern (data retained, just hidden)
- Archived chats can be unarchived
- Not included in default list endpoints unless includeArchived=true
- Cannot be in folders

---

## Transaction Examples

### Chat Creation (with Files)

```typescript
await db.transaction(async (tx) => {
    // Create chat
    const chat = await createChat(userId, {
        chat: {
            title: "New Discussion",
            history: { messages: {}, currentId: null }
        }
    }, tx);

    // Add initial message
    const message = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello!',
        timestamp: currentUnixTimestamp(),
        parentId: null,
        files: ['file-1', 'file-2']
    };
    await addMessageToChat(chat.id, 'msg-1', message, tx);

    // Create file associations
    await insertChatFiles(chat.id, 'msg-1', ['file-1', 'file-2'], userId, tx);

    return chat;
});
```

### Chat Sharing

```typescript
await db.transaction(async (tx) => {
    // Generate share ID
    const shareId = crypto.randomUUID();

    // Update chat with shareId
    const sharedChat = await updateChatShareIdById(chatId, shareId, tx);

    return sharedChat;
});
```

### Chat Deletion with Cleanup

```typescript
await db.transaction(async (tx) => {
    // Verify ownership
    const chat = await getChatByIdAndUserId(chatId, userId, tx);
    if (!chat) throw new Error('Chat not found');

    // Delete chat (cascades to chat_file via FK)
    await deleteChat(chatId, tx);

    return true;
});
```

---

## Migration from Mock Data

When implementing database operations:

1. _GET `/api/v1/chats/`_ → Use `getChatTitleIdListByUserId()` with pagination
2. _GET `/api/v1/chats/all`_ → Use `getChatsByUserId()` without pagination
3. _GET `/api/v1/chats/all/db`_ → Use `getChats()` (admin only)
4. _GET `/api/v1/chats/{id}`_ → Use `getChatByIdAndUserId()` with ownership check
5. _POST `/api/v1/chats/new`_ → Use `createChat()`
6. _POST `/api/v1/chats/{id}`_ → Use `updateChat()` with ownership verification
7. _DELETE `/api/v1/chats/{id}`_ → Use `deleteChatByIdAndUserId()` for users, `deleteChat()` for admins
8. _DELETE `/api/v1/chats/`_ → Use `deleteAllChatsByUserId()`
9. _POST `/api/v1/chats/{id}/share`_ → Use `insertSharedChat()` or `updateSharedChat()`
10. _GET `/api/v1/chats/share/{share_id}`_ → Use `getChatByShareId()`
11. _DELETE `/api/v1/chats/{id}/share`_ → Use `deleteSharedChat()`
12. _POST `/api/v1/chats/{id}/clone`_ → Create new chat with copied `chat` JSON
13. _POST `/api/v1/chats/{id}/folder`_ → Use `updateChatFolderIdByIdAndUserId()`
14. _GET `/api/v1/chats/folder/{folder_id}`_ → Use `getChatsByFolderIdAndUserId()`
15. _POST `/api/v1/chats/{id}/messages/{message_id}`_ → Use `addMessageToChat()`
16. _POST `/api/v1/chats/{id}/messages/{message_id}/event`_ → Implement event broadcast logic
17. _GET `/api/v1/chats/stats/usage`_ → Compute stats from message history (experimental)