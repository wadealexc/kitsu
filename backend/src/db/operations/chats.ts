import { eq, desc, asc, and, like, inArray, isNull, isNotNull, SQL } from 'drizzle-orm';

import { db, type DbOrTx } from '../client.js';
import { chats, chatFiles } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { ChatImportForm, ChatObject } from '../../routes/types/index.js';
import { DatabaseError, RecordCreationError, RecordNotFoundError, ValidationError } from '../errors.js';
import * as Files from './files.js';

const TABLE = 'chat';

/* -------------------- CREATE -------------------- */

export type Chat = typeof chats.$inferSelect;
export type NewChat = Omit<
    typeof chats.$inferInsert,
    'id' | 'userId' | 'updatedAt' | 'createdAt' | 'meta' | 'shareId'
>;

/**
 * Creates a new chat for a user.
 *
 * Required fields: userId, data.chat
 * Auto-generated: id (UUID v4 unless provided), createdAt, updatedAt, title (from chat.title)
 * Defaults: meta={}, shareId=null
 */
export async function createChat(
    userId: string,
    data: NewChat & { id?: string },
    txOrDb: DbOrTx = db
): Promise<Chat> {
    const now = currentUnixTimestamp();
    const chatId = data.id ?? crypto.randomUUID();

    const [chat] = await txOrDb
        .insert(chats)
        .values({
            id: chatId,
            userId: userId,
            title: data.title,
            chat: data.chat,
            folderId: data.folderId,
            meta: {},
            shareId: null,
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    if (!chat) throw new RecordCreationError(TABLE);
    return chat;
}

/* -------------------- UPDATE -------------------- */

export type UpdateChatObject = Partial<ChatObject>;
export type UpdateChat = Omit<Partial<NewChat>, 'chat'> & { chat: UpdateChatObject };

/**
 * Updates chat data (history, messages, models, params, ...), title, and folderId.
 * @note Updates properties via shallow copy
 * 
 * @param id - Chat id
 * @param {UpdateChat} params - A new chat object, which is shallow-copied over the existing one
 * @param txOrDb
 * 
 * @returns the updated Chat record
 * 
 * @throws if chat could not be found
 * @throws if record update fails
 */
export async function updateChat(
    id: string,
    params: UpdateChat,
    txOrDb: DbOrTx = db
): Promise<Chat> {
    const existing = await getChatById(id, txOrDb);
    if (!existing) throw new RecordNotFoundError(TABLE, id);

    // Merge chat data
    // TODO - storing title both inside and outside ChatObject seems redundant
    const mergedChat = { ...existing.chat, ...params.chat };
    const mergedTitle = mergedChat.title;
    const mergedFolderId = params.folderId !== undefined ? params.folderId : existing.folderId;

    const [updated] = await txOrDb
        .update(chats)
        .set({
            chat: mergedChat,
            title: mergedTitle,
            folderId: mergedFolderId,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, id))
        .returning();

    if (!updated) throw new DatabaseError('Chat update failed');
    return updated;
}

/* -------------------- DELETE -------------------- */

/**
 * Deletes a user's chat, automatically cascading deletion to any chat files.
 * 
 * @param id - Chat id
 * @param userId
 * @param txOrDb
 * 
 * @throws if deletion fails
 */
export async function deleteChat(
    id: string,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    const result = await txOrDb
        .delete(chats)
        .where(and(
            eq(chats.id, id),
            eq(chats.userId, userId)
        ));

    if (result.rowsAffected === 0) throw new RecordNotFoundError(TABLE, id);
}

/**
 * Deletes all chats for a user.
 * 
 * @param userId
 * @param txOrDb
 */
export async function deleteAllChatsByUserId(
    userId: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    await txOrDb
        .delete(chats)
        .where(eq(chats.userId, userId));
}

/* -------------------- READ -------------------- */

/**
 * Retrieves full chat by ID, including all messages.
 * 
 * @param id - Chat id
 * @param txOrDb
 * 
 * @returns the chat record (or null, if not found)
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
 * Retrieves chat by ID and user id
 * 
 * @param id - Chat id
 * @param userId
 * @param txOrDb
 * 
 * @returns the chat record (or null, if not found)
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
 * Retrieves all chats for a specific user
 * 
 * @param userId
 * @param txOrDb
 * 
 * @returns a list of the user's chats
 */
export async function getChatsByUserId(
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    return await txOrDb
        .select()
        .from(chats)
        .where(eq(chats.userId, userId))
        .orderBy(desc(chats.updatedAt));
}

/**
 * Options for listing chats with minimal data.
 * @field skip - bingus
 */
export type ListOptions = {
    includeFolders?: boolean;
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
 * Used for chat list views (sidebar, etc.).
 * 
 * @param userId
 * @param {ListOptions} opts - options for filters/pagination
 * @param txOrDb
 * 
 * @returns a list of chats that belong to the user
 */
export async function getChatTitleListByUserId(
    userId: string,
    options: ListOptions = {},
    txOrDb: DbOrTx = db
): Promise<ChatTitleIdResponse[]> {
    const {
        includeFolders = false,
        skip,
        limit,
    } = options;

    // Build where conditions
    const conditions: (SQL<unknown> | undefined)[] = [eq(chats.userId, userId)];

    if (!includeFolders) conditions.push(isNull(chats.folderId));

    const whereClause = and(...conditions);

    // TODO - typically pagination methods also return total items for followup queries?
    return await txOrDb
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
        .offset(skip ?? 0);
}

/**
 * Options for searching chats.
 */
export type SearchOptions = {
    skip?: number;
    limit?: number;
};

/**
 * Searches chats by title.
 * 
 * TODO: Currently unused and underwhelming implementation. Revisit when
 * supporting search feature.
 * 
 * @param userId
 * @param searchText - search for titles containing the searchText
 * @param opts
 * @param txOrDb
 * 
 * @returns a list of chats matching the search
 */
export async function getChatsByUserIdAndSearchText(
    userId: string,
    searchText: string,
    opts: SearchOptions = {},
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    const {
        skip,
        limit,
    } = opts;

    // Build where conditions
    const conditions = [
        eq(chats.userId, userId),
        like(chats.title, `%${searchText}%`),
    ];

    const whereClause = and(...conditions);

    // TODO - typically pagination methods also return total items for followup queries?
    return await txOrDb
        .select()
        .from(chats)
        .where(whereClause)
        .orderBy(desc(chats.updatedAt))
        .limit(limit ?? 999999)
        .offset(skip ?? 0);
}

/* -------------------- CRUD - CHAT FILES -------------------- */

export type ChatFile = typeof chatFiles.$inferSelect;

/**
 * Associate files with a chat (or a message within a chat).
 * Creates chatFiles records for each association.
 * @note Users can only associate files with a chat if they own the file.
 * 
 * @param chatId
 * @param messageId
 * @param fileIds
 * @param userId
 * @param txOrDb
 * 
 * @returns a list of all the files associated with `chatId`
 * 
 * @throws if the user does not have ownership a file
 */
export async function insertChatFiles(
    chatId: string,
    messageId: string | null,
    fileIds: string[],
    userId: string,
    txOrDb: DbOrTx = db
): Promise<ChatFile[]> {
    const now = currentUnixTimestamp();

    // Verify the user owns each file
    const files = await Files.getFilesByIds(fileIds, txOrDb);
    if (files.some(f => f.userId !== userId)) 
        throw new ValidationError(`user does not own requested files`);

    // Check if the chat is already associated with any of the provided files
    const existing = await txOrDb
        .select()
        .from(chatFiles)
        .where(and(
            eq(chatFiles.chatId, chatId),
            inArray(chatFiles.fileId, fileIds)
        ));

    // Filter out existing associations
    const existingFileIds = new Set(existing.map((cf: ChatFile) => cf.fileId));
    const newFileIds = fileIds.filter(id => !existingFileIds.has(id));

    if (newFileIds.length === 0) return existing;

    // Insert new associations
    const inserted = await txOrDb
        .insert(chatFiles)
        .values(newFileIds.map(fileId => ({
            id: crypto.randomUUID(),
            userId: userId,
            chatId: chatId,
            messageId: messageId,
            fileId: fileId,
            createdAt: now,
            updatedAt: now,
        })))
        .returning();

    return [...existing, ...inserted];
}

/**
 * Retrieves files associated with a specific message in a chat.
 * Results are returned, sorted by createdAt ascending.
 * 
 * @param chatId
 * @param messageId
 * @param txOrDb
 * 
 * @returns the files associated with the chat message, sorted by createdAt ascending.
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
 * Retrieves all shared chats that are associated with a specific file
 * 
 * @param fileId
 * @param txOrDb
 * 
 * @returns A list of shared chats that have a given file id attached
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

    const chatIds = chatFileRecords.map(cf => cf.chatId);
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

/* -------------------- CRUD - SHARING -------------------- */

/**
 * Designate a chat as publicly shared, giving chat.shareId a new, unique id.
 * @note sharing a chat allows anyone to use the shareId to read all prior messages
 * as well as future messages sent to the chat.
 * 
 * @param chatId
 * @param txOrDb
 * 
 * @returns the updated chat record (with shareId set)
 * 
 * @throws if the chat record was not found
 */
export async function shareChat(
    chatId: string,
    txOrDb: DbOrTx = db
): Promise<Chat> {
    const shareId = crypto.randomUUID();

    const [updated] = await txOrDb
        .update(chats)
        .set({
            shareId: shareId,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, chatId))
        .returning();

    if (!updated) throw new RecordNotFoundError(TABLE, chatId);
    return updated;
}

/**
 * Set a chat's shareId to null, "un-sharing" it.
 * @note if a user has already cloned the chat, the cloned chats are not deleted.
 * 
 * @param chatId
 * @param txOrDb
 * 
 * @throws if the chat record was not found
 */
export async function unshareChat(
    chatId: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    const result = await txOrDb
        .update(chats)
        .set({
            shareId: null,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(chats.id, chatId));

    if (result.rowsAffected === 0) throw new RecordNotFoundError(TABLE, chatId);
}

/**
 * Retrieves chat by its share ID.
 * @note no user verification - allows public read access to shared chats.
 * 
 * @param shareId
 * @param txOrDb
 * 
 * @returns the Chat record (or null if it does not exist)
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

/* -------------------- FOLDER OPERATIONS -------------------- */

/**
 * Move a chat into a folder (by setting its folderId), or remove it from a folder by
 * setting folderId to null.
 * 
 * @param chatId
 * @param userId
 * @param folderId - if null, chat is removed from all folders
 * @param txOrDb
 * 
 * @returns the updated Chat record
 * 
 * @throws if the chat record was not found
 */
export async function updateChatFolder(
    chatId: string,
    userId: string,
    folderId: string | null,
    txOrDb: DbOrTx = db
): Promise<Chat> {
    const [updated] = await txOrDb
        .update(chats)
        .set({
            folderId: folderId,
            updatedAt: currentUnixTimestamp(),
        })
        .where(and(
            eq(chats.id, chatId),
            eq(chats.userId, userId)
        ))
        .returning();

    if (!updated) throw new RecordNotFoundError(TABLE, chatId);
    return updated;
}

/**
 * Delete all chats in a specified folder.
 * @note that chats in subfolders are NOT deleted; that is the caller's responsibility.
 * 
 * @param userId
 * @param folderId
 * @param txOrDb
 */
export async function deleteChatsInFolder(
    userId: string,
    folderId: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    await txOrDb
        .delete(chats)
        .where(and(
            eq(chats.userId, userId),
            eq(chats.folderId, folderId)
        ));
}

/**
 * Options for pagination.
 */
export type PaginationOptions = {
    skip?: number;
    limit?: number;
};

/**
 * Retrieves all chats belonging to a user in a folder or folders, with
 * optional pagination
 * @note does not query subfolders
 * 
 * @param folderIds
 * @param userId
 * @param opts
 * 
 * @returns a list of chats in the provided folders
 */
export async function getChatsByFolderIdAndUserId(
    folderIds: string[],
    userId: string,
    opts: PaginationOptions = {},
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    return await txOrDb
        .select()
        .from(chats)
        .where(and(
            inArray(chats.folderId, folderIds),
            eq(chats.userId, userId)
        ))
        .orderBy(desc(chats.updatedAt))
        .limit(opts.limit ?? 999999)
        .offset(opts.skip ?? 0);
}

/* -------------------- IMPORT/EXPORT -------------------- */

/**
 * Bulk imports chats and creates records owned by the specified user
 * 
 * @param userId
 * @param chatsData
 * @param txOrDb
 * 
 * @returns the newly-created chat records
 */
export async function importChats(
    userId: string,
    chatsData: ChatImportForm[],
    txOrDb: DbOrTx = db
): Promise<Chat[]> {
    if (chatsData.length === 0) return [];

    const now = currentUnixTimestamp();

    const values = chatsData.map(data => {
        const chat = data.chat;

        return {
            id: crypto.randomUUID(),
            userId: userId,
            title: chat.title,
            chat: chat,
            meta: data.meta ?? {},
            shareId: null,
            folderId: null,
            createdAt: data.createdAt ?? now,
            updatedAt: data.updatedAt ?? now,
        };
    });

    const imported = await txOrDb
        .insert(chats)
        .values(values)
        .returning();

    return imported;
}