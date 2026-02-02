import { eq, ne, desc, asc, or, and, like, sql, inArray, isNotNull } from 'drizzle-orm';
import { db, type DbOrTx } from '../client.js';
import { chats, chatFiles, type Chat, type ChatFile, type NewChat, type NewChatFile } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { ChatForm, ChatImportForm } from '../../routes/types.js';

/* -------------------- CORE CRUD OPERATIONS -------------------- */

/**
 * Creates a new chat for a user.
 *
 * Required fields: userId, data.chat
 * Auto-generated: id (UUID v4), createdAt, updatedAt, title (from chat.title)
 * Defaults: archived=false, pinned=false, meta={}, shareId=null
 */
export async function createChat(
    userId: string,
    data: ChatForm,
    txOrDb: DbOrTx = db
): Promise<Chat> {
    const now = currentUnixTimestamp();
    const chatId = crypto.randomUUID();

    const [chat] = await txOrDb
        .insert(chats)
        .values({
            id: chatId,
            userId: userId,
            title: data.chat.title,
            chat: data.chat,
            folderId: data.folder_id,
            archived: false,
            pinned: false,
            meta: {},
            shareId: null,
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    if (!chat) throw new Error('Error creating chat record');
    return chat;
}

/**
 * Retrieves full chat by ID, including all messages.
 */
export async function getChatById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const [chat] = await txOrDb
        .select()
        .from(chats)
        .where(eq(chats.id, id))
        .limit(1);

    return chat || null;
}

/**
 * Retrieves chat by ID, verifying ownership.
 * Used for ownership verification before operations like update/delete.
 */
export async function getChatByIdAndUserId(
    id: string,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const [chat] = await txOrDb
        .select()
        .from(chats)
        .where(and(
            eq(chats.id, id),
            eq(chats.userId, userId)
        ))
        .limit(1);

    return chat || null;
}

/**
 * Retrieves chat by its public share ID (for shared chat viewing).
 * No user verification - allows public access to shared chats.
 */
export async function getChatByShareId(
    shareId: string,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const [chat] = await txOrDb
        .select()
        .from(chats)
        .where(eq(chats.shareId, shareId))
        .limit(1);

    return chat || null;
}

/**
 * Admin only: Retrieves ALL chats from ALL users (no filtering).
 * Used for admin data export/backup.
 */
export async function getChats(
    options?: { skip?: number; limit?: number },
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    const { skip = 0, limit } = options || {};

    return await txOrDb
        .select()
        .from(chats)
        .orderBy(desc(chats.createdAt))
        .limit(limit ?? 999999)
        .offset(skip);
}

/**
 * Options for querying chats with filtering and pagination.
 */
export type QueryOptions = {
    skip?: number;
    limit?: number;
    filter?: {
        query?: string;
        updatedAt?: number;
        orderBy?: 'updatedAt' | 'createdAt' | 'title';
        direction?: 'asc' | 'desc';
    };
};

/**
 * Retrieves all chats for a specific user with pagination and filtering.
 * Default sort: updatedAt DESC (most recent first).
 */
export async function getChatsByUserId(
    userId: string,
    options: QueryOptions = {},
    txOrDb: DbOrTx = db
): Promise<{ items: Chat[]; total: number }> {
    const {
        skip = 0,
        limit,
        filter = {},
    } = options;

    const {
        query: searchQuery,
        updatedAt: updatedAtFilter,
        orderBy = 'updatedAt',
        direction = 'desc',
    } = filter;

    // Build where conditions
    const conditions = [eq(chats.userId, userId)];

    if (searchQuery) {
        conditions.push(like(chats.title, `%${searchQuery}%`));
    }

    if (updatedAtFilter !== undefined) {
        conditions.push(sql`${chats.updatedAt} > ${updatedAtFilter}`);
    }

    const whereClause = and(...conditions);

    // Determine sort column
    const sortColumn =
        orderBy === 'title' ? chats.title :
        orderBy === 'createdAt' ? chats.createdAt :
        chats.updatedAt;

    const sortFn = direction === 'asc' ? asc : desc;

    // Execute query
    const items = await txOrDb
        .select()
        .from(chats)
        .where(whereClause)
        .orderBy(sortFn(sortColumn))
        .limit(limit ?? 999999)
        .offset(skip);

    // Get total count
    const countResult = await txOrDb
        .select({ count: sql<number>`count(*)` })
        .from(chats)
        .where(whereClause);

    const total = countResult[0]?.count ?? 0;
    return { items, total };
}

/**
 * Options for listing chats with minimal data.
 */
export type ListOptions = {
    includeArchived?: boolean;
    includeFolders?: boolean;
    includePinned?: boolean;
    skip?: number;
    limit?: number;
};

/**
 * Response type for chat title/ID lists (minimal chat info).
 */
export type ChatTitleIdResponse = {
    id: string;
    title: string;
    updatedAt: number;
    createdAt: number;
};

/**
 * Retrieves minimal chat info (title, id, timestamps) without message history.
 * Default pagination: 60 items per page.
 * Used for chat list views (sidebar, etc.).
 */
export async function getChatTitleIdListByUserId(
    userId: string,
    options: ListOptions = {},
    txOrDb: DbOrTx = db
): Promise<ChatTitleIdResponse[]> {
    const {
        includeArchived = false,
        includeFolders = false,
        includePinned = false,
        skip = 0,
        limit,
    } = options;

    // Build where conditions
    const conditions = [eq(chats.userId, userId)];

    if (!includeArchived) {
        conditions.push(eq(chats.archived, false));
    }

    if (!includeFolders) {
        conditions.push(sql`${chats.folderId} IS NULL`);
    }

    if (!includePinned) {
        const pinnedCondition = or(
            eq(chats.pinned, false),
            sql`${chats.pinned} IS NULL`
        );
        if (pinnedCondition) conditions.push(pinnedCondition);
    }

    const whereClause = and(...conditions);

    // Query with only needed fields
    const result = await txOrDb
        .select({
            id: chats.id,
            title: chats.title,
            updatedAt: chats.updatedAt,
            createdAt: chats.createdAt,
        })
        .from(chats)
        .where(whereClause)
        .orderBy(desc(chats.updatedAt))
        .limit(limit ?? 999999)
        .offset(skip);

    return result;
}

/**
 * Options for pagination.
 */
export type PaginationOptions = {
    skip?: number;
    limit?: number;
};

/**
 * Retrieves chats in a specific folder or folders
 * Filters by userId to prevent cross-user access.
 * Excludes pinned and archived chats.
 * Default sort: updatedAt DESC.
 */
export async function getChatsByFolderIdAndUserId(
    folderIds: string[],
    userId: string,
    options: PaginationOptions = {},
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    const { skip = 0, limit } = options;

    return await txOrDb
        .select()
        .from(chats)
        .where(and(
            inArray(chats.folderId, folderIds),
            eq(chats.userId, userId),
            eq(chats.archived, false),
            or(
                eq(chats.pinned, false),
                sql`${chats.pinned} IS NULL`
            )
        ))
        .orderBy(desc(chats.updatedAt))
        .limit(limit ?? 999999)
        .offset(skip);
}

/**
 * Updates chat data and title.
 * Auto-updates: updatedAt timestamp.
 * Merges provided chat data with existing chat.
 * Extracts new title from data.chat.title if provided.
 */
export async function updateChat(
    id: string,
    data: ChatForm,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const existing = await getChatById(id, txOrDb);
    if (!existing) return null;

    const now = currentUnixTimestamp();

    // Merge chat data
    const mergedChat = { ...existing.chat, ...data.chat };

    const [updated] = await txOrDb
        .update(chats)
        .set({
            chat: mergedChat,
            title: mergedChat.title,
            folderId: data.folder_id !== undefined ? data.folder_id : existing.folderId,
            updatedAt: now,
        })
        .where(eq(chats.id, id))
        .returning();

    return updated || null;
}

/**
 * Moves chat to a folder (or removes from folder if folderId is null).
 * Side effects: Sets pinned = false when moving to folder (can't be pinned in folder).
 * Updates updatedAt timestamp.
 */
export async function updateChatFolderIdByIdAndUserId(
    id: string,
    userId: string,
    folderId: string | null,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const now = currentUnixTimestamp();

    const [updated] = await txOrDb
        .update(chats)
        .set({
            folderId: folderId,
            pinned: false,  // Can't be pinned in folder
            updatedAt: now,
        })
        .where(and(
            eq(chats.id, id),
            eq(chats.userId, userId)
        ))
        .returning();

    return updated || null;
}

/**
 * Updates the share_id for a chat.
 * Pass null to unshare.
 */
export async function updateChatShareIdById(
    id: string,
    shareId: string | null,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const [updated] = await txOrDb
        .update(chats)
        .set({
            shareId: shareId,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, id))
        .returning();

    return updated || null;
}

/**
 * Toggles pinned status.
 * Converts pinned: null to pinned: false before toggling.
 * Automatically updates updatedAt.
 */
export async function updateChatPinnedById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const existing = await getChatById(id, txOrDb);
    if (!existing) return null;

    const currentPinned = existing.pinned ?? false;

    const [updated] = await txOrDb
        .update(chats)
        .set({
            pinned: !currentPinned,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, id))
        .returning();

    return updated || null;
}

/**
 * Toggles archived status.
 * Side effects: Clears folderId when archiving (archived chats can't be in folders).
 * Automatically updates updatedAt.
 */
export async function updateChatArchivedById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const existing = await getChatById(id, txOrDb);
    if (!existing) return null;

    const currentArchived = existing.archived;

    const [updated] = await txOrDb
        .update(chats)
        .set({
            archived: !currentArchived,
            folderId: !currentArchived ? null : existing.folderId,  // Clear folder if archiving
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, id))
        .returning();

    return updated || null;
}

/**
 * Deletes a chat by ID (hard delete).
 * Cascade: chat_file records with this chatId are automatically deleted (FK ON DELETE CASCADE).
 */
export async function deleteChat(
    id: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(chats)
        .where(eq(chats.id, id));

    return result.rowsAffected > 0;
}

/**
 * Deletes a chat with ownership verification.
 * Ensures user owns the chat before deletion.
 */
export async function deleteChatByIdAndUserId(
    id: string,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(chats)
        .where(and(
            eq(chats.id, id),
            eq(chats.userId, userId)
        ));

    return result.rowsAffected > 0;
}

/**
 * Deletes all chats for a user (cannot be undone).
 * Used for account deletion or user requested deletion.
 */
export async function deleteAllChatsByUserId(
    userId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(chats)
        .where(eq(chats.userId, userId));

    return result.rowsAffected > 0;
}

/* -------------------- SEARCH & FILTERING -------------------- */

/**
 * Options for searching chats.
 */
export type SearchOptions = {
    includeArchived?: boolean;
    skip?: number;
    limit?: number;
};

/**
 * Searches chats by title and message content.
 * Search syntax:
 * - Plain text: searches chat title and message content
 *
 * Note: Advanced search syntax (folder:, pinned:, etc.) not yet implemented.
 * This basic implementation searches title only.
 */
export async function getChatsByUserIdAndSearchText(
    userId: string,
    searchText: string,
    options: SearchOptions = {},
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    const {
        includeArchived = false,
        skip = 0,
        limit = 50,
    } = options;

    // Build where conditions
    const conditions = [
        eq(chats.userId, userId),
        like(chats.title, `%${searchText}%`),
    ];

    if (!includeArchived) {
        conditions.push(eq(chats.archived, false));
    }

    const whereClause = and(...conditions);

    return await txOrDb
        .select()
        .from(chats)
        .where(whereClause)
        .orderBy(desc(chats.updatedAt))
        .limit(limit)
        .offset(skip);
}

/* -------------------- FILE OPERATIONS -------------------- */

/**
 * Associates files with a chat/message.
 * Creates chat_file records for each file.
 * Prevents duplicate associations.
 * Filters out null/empty fileIds.
 */
export async function insertChatFiles(
    chatId: string,
    messageId: string | null,
    fileIds: string[],
    userId: string,
    txOrDb: DbOrTx = db
): Promise<ChatFile[]> {
    // Filter out null/empty fileIds
    const validFileIds = fileIds.filter(id => id && id.trim().length > 0);
    if (validFileIds.length === 0) return [];

    const now = currentUnixTimestamp();

    // Check for existing associations to prevent duplicates
    const existing = await txOrDb
        .select()
        .from(chatFiles)
        .where(and(
            eq(chatFiles.chatId, chatId),
            inArray(chatFiles.fileId, validFileIds)
        ));

    const existingFileIds = new Set(existing.map((cf: ChatFile) => cf.fileId));
    const newFileIds = validFileIds.filter(id => !existingFileIds.has(id));

    if (newFileIds.length === 0) return existing;

    // Insert new associations
    const values = newFileIds.map(fileId => ({
        id: crypto.randomUUID(),
        userId: userId,
        chatId: chatId,
        messageId: messageId,
        fileId: fileId,
        createdAt: now,
        updatedAt: now,
    }));

    const inserted = await txOrDb
        .insert(chatFiles)
        .values(values)
        .returning();

    return [...existing, ...inserted];
}

/**
 * Retrieves files attached to a specific message in a chat.
 * Returns array sorted by createdAt ascending.
 */
export async function getChatFiles(
    chatId: string,
    messageId: string,
    txOrDb: DbOrTx = db
): Promise<ChatFile[]> {
    return await txOrDb
        .select()
        .from(chatFiles)
        .where(and(
            eq(chatFiles.chatId, chatId),
            eq(chatFiles.messageId, messageId)
        ))
        .orderBy(asc(chatFiles.createdAt));
}

/**
 * Removes a file attachment from a chat.
 * Only removes the chat_file association; file itself remains in files table.
 */
export async function deleteChatFile(
    chatId: string,
    fileId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(chatFiles)
        .where(and(
            eq(chatFiles.chatId, chatId),
            eq(chatFiles.fileId, fileId)
        ));

    return result.rowsAffected > 0;
}

/**
 * Retrieves all shared chats that have a specific file attached.
 * Used for file deletion cleanup (find all shared chats using a file).
 */
export async function getSharedChatsByFileId(
    fileId: string,
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    // Get all chatIds that use this file
    const chatFileRecords = await txOrDb
        .select({ chatId: chatFiles.chatId })
        .from(chatFiles)
        .where(eq(chatFiles.fileId, fileId));

    const chatIds = chatFileRecords.map((cf: { chatId: string }) => cf.chatId);
    if (chatIds.length === 0) return [];

    // Get all chats that are shared (have shareId) from those chatIds
    return await txOrDb
        .select()
        .from(chats)
        .where(and(
            inArray(chats.id, chatIds),
            isNotNull(chats.shareId)
        ));
}

/* -------------------- SHARING OPERATIONS -------------------- */

/**
 * Creates a publicly shared version of a chat.
 *
 * Note: OWUI's approach creates a duplicate "shadow" chat record with userId: `shared-{original_chat_id}`.
 * For simplicity, we just set the shareId on the original chat.
 *
 * This implementation generates a share ID and updates the chat.
 */
export async function insertSharedChat(
    chatId: string,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const shareId = crypto.randomUUID();
    return await updateChatShareIdById(chatId, shareId, txOrDb);
}

/**
 * Updates shared chat to reflect original's current state.
 *
 * Note: In OWUI, this syncs a shadow chat. We simply update the share timestamp.
 */
export async function updateSharedChat(
    chatId: string,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const [updated] = await txOrDb
        .update(chats)
        .set({
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, chatId))
        .returning();

    return updated || null;
}

/**
 * Removes share link and associated shared chat record.
 * Clears shareId on original chat.
 */
export async function deleteSharedChat(
    chatId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await updateChatShareIdById(chatId, null, txOrDb);
    return result !== null;
}

/* -------------------- MESSAGE OPERATIONS -------------------- */

/**
 * Adds or updates a message in a chat's message history.
 *
 * Behavior:
 * - Upserts message to chat.history.messages[messageId]
 * - Sets history.currentId to this messageId
 * - Sanitizes null bytes from message content
 * - Updates chat's updatedAt
 */
export async function addMessageToChat(
    chatId: string,
    messageId: string,
    message: Record<string, any>,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const existing = await getChatById(chatId, txOrDb);
    if (!existing) return null;

    const chatData = existing.chat as any;
    const history = chatData.history || { messages: {}, currentId: null };
    const messages = history.messages || {};

    // Add message
    messages[messageId] = message;

    // Update history
    history.messages = messages;
    history.currentId = messageId;

    // Update chat
    const updatedChatData = {
        ...chatData,
        history: history,
    };

    const [updated] = await txOrDb
        .update(chats)
        .set({
            chat: updatedChatData,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, chatId))
        .returning();

    return updated || null;
}

/**
 * Appends a status update to a message's statusHistory.
 *
 * Behavior:
 * - Appends to messages[messageId].statusHistory array
 * - Updates chat's updatedAt
 */
export async function addMessageStatus(
    chatId: string,
    messageId: string,
    status: Record<string, any>,
    txOrDb: DbOrTx = db
): Promise<Chat | null> {
    const existing = await getChatById(chatId, txOrDb);
    if (!existing) return null;

    const chatData = existing.chat as any;
    const messages = chatData.history?.messages || {};
    const message = messages[messageId];

    if (!message) return null;

    // Initialize statusHistory if not exists
    if (!message.statusHistory) {
        message.statusHistory = [];
    }

    // Append status
    message.statusHistory.push(status);

    // Update chat
    const [updated] = await txOrDb
        .update(chats)
        .set({
            chat: chatData,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, chatId))
        .returning();

    return updated || null;
}

/**
 * Appends files to a message.
 *
 * Behavior:
 * - Appends to messages[messageId].files array
 * - Also creates chat_file records via insertChatFiles()
 * - Updates chat's updatedAt
 */
export async function addMessageFiles(
    chatId: string,
    messageId: string,
    files: Record<string, any>[],
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Record<string, any>[]> {
    const existing = await getChatById(chatId, txOrDb);
    if (!existing) return [];

    const chatData = existing.chat as any;
    const messages = chatData.history?.messages || {};
    const message = messages[messageId];

    if (!message) return [];

    // Initialize files array if not exists
    if (!message.files) {
        message.files = [];
    }

    // Append files
    message.files.push(...files);

    // Update chat
    await txOrDb
        .update(chats)
        .set({
            chat: chatData,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, chatId));

    // Create chat_file records
    const fileIds = files.map(f => f.id).filter(Boolean);
    if (fileIds.length > 0) {
        await insertChatFiles(chatId, messageId, fileIds, userId, txOrDb);
    }

    return files;
}

/* -------------------- ARCHIVING & PINNING -------------------- */

/**
 * Archives all chats for a user.
 */
export async function archiveAllChatsByUserId(
    userId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .update(chats)
        .set({
            archived: true,
            folderId: null,  // Archived chats can't be in folders
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.userId, userId));

    return result.rowsAffected > 0;
}

/**
 * Unarchives all chats for a user.
 */
export async function unarchiveAllChatsByUserId(
    userId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .update(chats)
        .set({
            archived: false,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.userId, userId));

    return result.rowsAffected > 0;
}

/**
 * Retrieves archived chats for a user.
 * Supports pagination, filtering, and sorting.
 */
export async function getArchivedChats(
    userId: string,
    options: ListOptions = {},
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    const { skip = 0, limit = 50 } = options;

    return await txOrDb
        .select()
        .from(chats)
        .where(and(
            eq(chats.userId, userId),
            eq(chats.archived, true)
        ))
        .orderBy(desc(chats.updatedAt))
        .limit(limit)
        .offset(skip);
}

/**
 * Retrieves pinned chats for a user.
 * Filters: pinned = true, archived = false.
 * Sort by updatedAt DESC.
 */
export async function getPinnedChats(
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    return await txOrDb
        .select()
        .from(chats)
        .where(and(
            eq(chats.userId, userId),
            eq(chats.pinned, true),
            eq(chats.archived, false)
        ))
        .orderBy(desc(chats.updatedAt));
}

/* -------------------- FOLDER OPERATIONS -------------------- */

/**
 * Moves all chats from one folder to another.
 * Sets pinned = false for moved chats.
 */
export async function moveChatsToFolder(
    userId: string,
    fromFolderId: string,
    toFolderId: string | null,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .update(chats)
        .set({
            folderId: toFolderId,
            pinned: false,
            updatedAt: currentUnixTimestamp(),
        })
        .where(and(
            eq(chats.userId, userId),
            eq(chats.folderId, fromFolderId)
        ));

    return result.rowsAffected > 0;
}

/**
 * Deletes all chats in a folder.
 * Used when folder is deleted and user chooses "delete contents".
 */
export async function deleteChatsInFolder(
    userId: string,
    folderId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(chats)
        .where(and(
            eq(chats.userId, userId),
            eq(chats.folderId, folderId)
        ));

    return result.rowsAffected > 0;
}

/**
 * Counts chats in a folder.
 */
export async function countChatsInFolder(
    userId: string,
    folderId: string,
    txOrDb: DbOrTx = db
): Promise<number> {
    const result = await txOrDb
        .select({ count: sql<number>`count(*)` })
        .from(chats)
        .where(and(
            eq(chats.userId, userId),
            eq(chats.folderId, folderId)
        ));

    return result[0]?.count ?? 0;
}

/* -------------------- IMPORT/EXPORT -------------------- */

/**
 * Bulk imports chats for a user (for backup restoration).
 *
 * Behavior:
 * - Each chat gets new UUID if not provided
 * - Timestamps can be preserved or set to current time
 * - All chats assigned to provided userId
 */
export async function importChats(
    userId: string,
    chatsData: ChatImportForm[],
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    if (chatsData.length === 0) return [];

    const now = currentUnixTimestamp();

    const values = chatsData.map(data => {
        return {
            id: crypto.randomUUID(),
            userId: userId,
            title: data.chat.title,
            chat: data.chat,
            meta: data.meta ?? {},
            pinned: data.pinned ?? false,
            archived: false,
            shareId: null,
            folderId: null,
            createdAt: data.created_at ?? now,
            updatedAt: data.updated_at ?? now,
        };
    });

    const imported = await txOrDb
        .insert(chats)
        .values(values)
        .returning();

    return imported;
}