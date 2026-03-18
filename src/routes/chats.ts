import { Router, type Response, type NextFunction } from 'express';

import * as Types from './types.js';
import { requireAuth, validateChatId, validateShareId, validateFolderId } from './middleware.js';
import { db } from '../db/client.js';
import * as Chats from '../db/operations/chats.js';
import * as Folders from '../db/operations/folders.js';
import { HttpError, NotFoundError, BadRequestError } from './errors.js';

const router = Router();

/* -------------------- CHAT LIST & RETRIEVAL -------------------- */

/**
 * GET /api/v1/chats/ (also /list)
 * Access Control: Any authenticated user can access their own chats
 *
 * List current user's chats with pagination. Returns minimal chat info.
 *
 * @query {Types.ChatListQuery} - pagination and filter parameters
 * @returns {Types.ChatTitleIdResponse[]} - minimal chat info (ID, title, timestamps)
 */
router.get(['/', '/list'], requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.ChatListQuery>,
    res: Response<Types.ChatTitleIdResponse[] | Types.ErrorResponse>
) => {
    const query = Types.ChatListQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const userId = req.user!.id;
    const { page, include_folders: includeFolders } = query.data;

    try {
        const options: Chats.ListOptions = {
            includeFolders: includeFolders,
        };

        // Apply pagination if page is provided
        if (page !== undefined) {
            const pageSize = 60;
            options.skip = (page - 1) * pageSize;
            options.limit = pageSize;
        }

        const chats = await Chats.getChatTitleListByUserId(userId, options, db);

        // Map to response format
        const response: Types.ChatTitleIdResponse[] = chats.map(chat => ({
            ...chat,
            updated_at: chat.updatedAt,
            created_at: chat.createdAt,
        }));

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get chat list error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/chats/all
 * Access Control: Any authenticated user can access their own chats
 *
 * Get all chats for the current user with full chat data including messages.
 *
 * @returns {Types.ChatResponse[]} - full chat objects (no pagination)
 */
router.get('/all', requireAuth, async (
    req: Types.TypedRequest,
    res: Response<Types.ChatResponse[] | Types.ErrorResponse>
) => {
    const userId = req.user!.id;

    try {
        const chats = await Chats.getChatsByUserId(userId, db);

        // Map to response format
        const response: Types.ChatResponse[] = chats.map(chat => ({
            id: chat.id,
            user_id: chat.userId,
            title: chat.title,
            chat: chat.chat,
            updated_at: chat.updatedAt,
            created_at: chat.createdAt,
            share_id: chat.shareId || undefined,
            meta: chat.meta || {},
            folder_id: chat.folderId || undefined,
        }));

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get all chats error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/chats/:id
 * Access Control: User can only access their own chats
 *
 * Get a specific chat by ID including full messages and metadata.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {Types.ChatResponse} - full chat object or null if not found
 */
router.get('/:id', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<Types.ChatResponse | Types.ErrorResponse>
) => {
    const chatId = req.params.id;
    const userId = req.user!.id;

    try {
        const chat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!chat) throw NotFoundError('Chat not found');

        const response: Types.ChatResponse = {
            id: chat.id,
            user_id: chat.userId,
            title: chat.title,
            chat: chat.chat,
            updated_at: chat.updatedAt,
            created_at: chat.createdAt,
            share_id: chat.shareId || undefined,
            meta: chat.meta || {},
            folder_id: chat.folderId || undefined,
        };

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get chat by id error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- CHAT CREATION & MODIFICATION -------------------- */

/**
 * POST /api/v1/chats/new
 * Access Control: Any authenticated user can create chats
 *
 * Create a new chat conversation.
 *
 * @body {Types.NewChatForm} - chat data and optional folder ID
 * @returns {Types.ChatResponse} - created chat object
 */
router.post('/new', requireAuth, async (
    req: Types.TypedRequest<{}, Types.NewChatForm>,
    res: Response<Types.ChatResponse | Types.ErrorResponse>
) => {
    const body = Types.NewChatFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const userId = req.user!.id;

    try {
        const newChat = await Chats.createChat(userId, {
            title: body.data.chat.title,
            chat: body.data.chat,
            folderId: body.data.folder_id,
        }, db);
        // console.log(`POST chats/new:\n${JSON.stringify(newChat, null, 2)}`);

        const response: Types.ChatResponse = {
            id: newChat.id,
            user_id: newChat.userId,
            title: newChat.title,
            chat: newChat.chat,
            updated_at: newChat.updatedAt,
            created_at: newChat.createdAt,
            share_id: newChat.shareId || undefined,
            meta: newChat.meta || {},
            folder_id: newChat.folderId || undefined,
        };

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Create chat error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/chats/:id
 * Access Control: User can only update their own chats
 *
 * Update an existing chat by ID.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @body {Types.ChatForm} - updated chat data and optional folder ID
 * @returns {Types.ChatResponse} - updated chat object
 */
router.post('/:id', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams, Types.ChatForm>,
    res: Response<Types.ChatResponse | Types.ErrorResponse>
) => {
    const body = Types.ChatFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const chatId = req.params.id;
    const userId = req.user!.id;

    try {
        // Verify ownership
        const existingChat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!existingChat) throw NotFoundError('Chat not found');

        // Update chat
        const updatedChat = await Chats.updateChat(chatId, body.data, db);
        // console.log(`POST chats/${chatId}:\n${JSON.stringify(updatedChat, null, 2)}`);

        const response: Types.ChatResponse = {
            id: updatedChat.id,
            user_id: updatedChat.userId,
            title: updatedChat.title,
            chat: updatedChat.chat,
            updated_at: updatedChat.updatedAt,
            created_at: updatedChat.createdAt,
            share_id: updatedChat.shareId || undefined,
            meta: updatedChat.meta || {},
            folder_id: updatedChat.folderId || undefined,
        };

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Update chat error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * DELETE /api/v1/chats/:id
 * Access Control: Any authenticated user can delete their own chats
 *
 * Delete a specific chat by ID. Users can only delete chats they own.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {boolean} - true if deletion successful, 404 if chat not found or not owned by user
 */
router.delete('/:id', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const chatId = req.params.id;
    const userId = req.user!.id;

    try {
        await Chats.deleteChat(chatId, userId, db);
        return res.json(true);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Delete chat error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * DELETE /api/v1/chats/
 * Access Control: Any authenticated user can delete their own chats
 *
 * Delete all chats for the current user (cannot be undone).
 *
 * @returns {boolean} - true if db call does not fail (even if nothing was deleted)
 */
router.delete('/', requireAuth, async (
    req: Types.TypedRequest,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const userId = req.user!.id;

    try {
        await Chats.deleteAllChatsByUserId(userId, db);
        return res.json(true);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Delete all chats error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- IMPORT -------------------- */

/**
 * POST /api/v1/chats/import
 * Access Control: Any authenticated user
 *
 * Bulk import chats, preserving original timestamps and metadata.
 *
 * @body {Types.ChatImportForm[]} - array of chats to import
 * @returns {Types.ChatResponse[]} - the newly created chats
 */
router.post('/import', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ChatImportForm[]>,
    res: Response<Types.ChatResponse[] | Types.ErrorResponse>
) => {
    const userId = req.user!.id;
    const body = req.body;

    if (!Array.isArray(body)) {
        return res.status(400).json({ detail: 'Request body must be an array of chats' });
    }

    const chatsData: Types.ChatImportForm[] = [];
    for (let i = 0; i < body.length; i++) {
        const result = Types.ChatImportFormSchema.safeParse(body[i]);
        if (!result.success) {
            return res.status(400).json({ 
                detail: `Invalid chat at index ${i}`, errors: result.error.issues 
            });
        }
        
        chatsData.push(result.data);
    }

    try {
        const imported = await Chats.importChats(userId, chatsData, db);

        const response: Types.ChatResponse[] = imported.map(chat => ({
            id: chat.id,
            user_id: chat.userId,
            title: chat.title,
            chat: chat.chat,
            updated_at: chat.updatedAt,
            created_at: chat.createdAt,
            share_id: chat.shareId || undefined,
            meta: chat.meta || {},
            folder_id: chat.folderId || undefined,
        }));

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Import chats error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- SHARING & CLONING -------------------- */

/**
 * POST /api/v1/chats/:id/share
 * Access Control: User must own the chat
 *
 * Share a chat by generating a public share link.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {Types.ChatResponse} - chat with share_id populated
 */
router.post('/:id/share', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<Types.ChatResponse | Types.ErrorResponse>
) => {
    const chatId = req.params.id;
    const userId = req.user!.id;

    try {
        // Fetch chat. If already shared, throw
        const chat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!chat) throw NotFoundError('Chat not found');
        if (chat.shareId) throw BadRequestError('Chat already shared');

        // Update the existing chat's shareId
        const updatedChat = await Chats.shareChat(chatId, db);

        const response: Types.ChatResponse = {
            id: updatedChat.id,
            user_id: updatedChat.userId,
            title: updatedChat.title,
            chat: updatedChat.chat,
            updated_at: updatedChat.updatedAt,
            created_at: updatedChat.createdAt,
            share_id: updatedChat.shareId || undefined,
            meta: updatedChat.meta || {},
            folder_id: updatedChat.folderId || undefined,
        };

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Share chat error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/chats/share/:share_id
 * Access Control: Any authenticated user can view shared chats
 *
 * Get a shared chat by its public share ID (read-only access).
 *
 * @param {Types.ShareIdParams} - path parameters with share ID
 * @returns {Types.ChatResponse} - full chat data
 */
router.get('/share/:share_id', validateShareId, requireAuth, async (
    req: Types.TypedRequest<Types.ShareIdParams>,
    res: Response<Types.ChatResponse | Types.ErrorResponse>
) => {
    const shareId = req.params.share_id;

    try {
        const chat = await Chats.getChatByShareId(shareId, db);
        if (!chat) throw NotFoundError('Chat not found');

        const response: Types.ChatResponse = {
            id: chat.id,
            user_id: chat.userId,
            title: chat.title,
            chat: chat.chat,
            updated_at: chat.updatedAt,
            created_at: chat.createdAt,
            share_id: chat.shareId || undefined,
            meta: chat.meta || {},
            folder_id: chat.folderId || undefined,
        };

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get shared chat error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * DELETE /api/v1/chats/:id/share
 * Access Control: User must own the chat
 *
 * Unshare a chat by removing its public share link.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {boolean} - true if successful, false if not currently shared
 */
router.delete('/:id/share', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const chatId = req.params.id;
    const userId = req.user!.id;

    try {
        const chat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!chat) throw NotFoundError('Chat not found');

        // Chat isn't shared - return false
        if (!chat.shareId) return res.json(false);

        // Un-share chat
        await Chats.unshareChat(chatId, db);
        return res.json(true);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Unshare chat error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/chats/:share_id/clone/shared
 * Access Control: Any authenticated user can clone publicly shared chats
 *
 * Clone a shared chat to the current user's account.
 *
 * @param {Types.ShareIdParams} - path parameters with share id
 * @returns {Types.ChatResponse} - cloned chat owned by current user
 */
router.post('/:share_id/clone/shared', validateShareId, requireAuth, async (
    req: Types.TypedRequest<Types.ShareIdParams>,
    res: Response<Types.ChatResponse | Types.ErrorResponse>
) => {
    const shareId = req.params.share_id;
    const userId = req.user!.id;

    try {
        const chat = await Chats.getChatByShareId(shareId, db);
        if (!chat) throw NotFoundError('Chat not found');

        // Create new chat owned by current user with copied data
        const clonedChat = await Chats.createChat(userId, {
            title: chat.title,
            chat: chat.chat,
            folderId: null,  // Don't copy folder assignment
        }, db);

        const response: Types.ChatResponse = {
            id: clonedChat.id,
            user_id: clonedChat.userId,
            title: clonedChat.title,
            chat: clonedChat.chat,
            updated_at: clonedChat.updatedAt,
            created_at: clonedChat.createdAt,
            share_id: undefined,  // Clone is not shared
            meta: clonedChat.meta || {},
            folder_id: undefined,  // Clone is not in folder
        };

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Clone shared chat error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/chats/:id/clone
 * Access Control: User must own the original chat
 *
 * Clone one of your own chats.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @body {Types.CloneForm} - optional new title for cloned chat
 * @returns {Types.ChatResponse} - cloned chat with new ID
 */
router.post('/:id/clone', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams, Types.CloneForm>,
    res: Response<Types.ChatResponse | Types.ErrorResponse>
) => {
    const body = Types.CloneFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { title } = body.data;
    const chatId = req.params.id;
    const userId = req.user!.id;

    try {
        const originalChat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!originalChat) throw NotFoundError('Chat not found');

        // Create cloned chat data with optional new title
        const chatData = {
            ...originalChat.chat,
            title: title ?? originalChat.title,
        };

        const clonedChat = await Chats.createChat(userId, {
            title: chatData.title,
            chat: chatData,
            folderId: null,  // Don't copy folder assignment
        }, db);

        const response: Types.ChatResponse = {
            id: clonedChat.id,
            user_id: clonedChat.userId,
            title: clonedChat.title,
            chat: clonedChat.chat,
            updated_at: clonedChat.updatedAt,
            created_at: clonedChat.createdAt,
            share_id: undefined,
            meta: clonedChat.meta || {},
            folder_id: undefined,
        };

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Clone chat error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- FOLDER ORGANIZATION -------------------- */

/**
 * POST /api/v1/chats/:id/folder
 * Access Control: User must own the chat
 *
 * Move a chat to a folder (or remove from folder by setting to null).
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @body {Types.ChatFolderIdForm} - folder ID or null to remove from folder
 * @returns {Types.ChatResponse} - updated chat object
 */
router.post('/:id/folder', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams, Types.ChatFolderIdForm>,
    res: Response<Types.ChatResponse | Types.ErrorResponse>
) => {
    const body = Types.ChatFolderIdFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const chatId = req.params.id;
    const folderId = body.data.folder_id;
    const userId = req.user!.id;

    try {
        // Verify ownership
        // TODO - not really necessary since we're updating by userId?
        const chat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!chat) throw NotFoundError('Chat not found');

        // Update chat folder
        const updatedChat = await Chats.updateChatFolder(
            chatId,
            userId,
            folderId ?? null,
            db
        );

        const response: Types.ChatResponse = {
            id: updatedChat.id,
            user_id: updatedChat.userId,
            title: updatedChat.title,
            chat: updatedChat.chat,
            updated_at: updatedChat.updatedAt,
            created_at: updatedChat.createdAt,
            share_id: updatedChat.shareId || undefined,
            meta: updatedChat.meta || {},
            folder_id: updatedChat.folderId || undefined,
        };

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Update chat folder error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/chats/folder/:folder_id
 * Access Control: User can only access their own folders/chats
 *
 * Get all chats in a specific folder and any subfolders.
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @returns {Types.ChatResponse[]} - full chat objects in folder
 */
router.get('/folder/:folder_id', validateFolderId, requireAuth, async (
    req: Types.TypedRequest<Types.FolderIdParams>,
    res: Response<Types.ChatResponse[] | Types.ErrorResponse>
) => {
    const folderId = req.params.folder_id;
    const userId = req.user!.id;

    try {
        const subfolders = await Folders.getChildrenFolders(folderId, userId, db);
        const folderIds = [folderId, ...subfolders.map(sf => sf.id)];

        const chats = await Chats.getChatsByFolderIdAndUserId(folderIds, userId, {}, db);

        const response: Types.ChatResponse[] = chats.map(chat => ({
            id: chat.id,
            user_id: chat.userId,
            title: chat.title,
            chat: chat.chat,
            updated_at: chat.updatedAt,
            created_at: chat.createdAt,
            share_id: chat.shareId || undefined,
            meta: chat.meta || {},
            folder_id: chat.folderId || undefined,
        }));

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get folder chats error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/chats/folder/:folder_id/list
 * Access Control: User can only access their own folders/chats
 *
 * Get chat list for a specific folder with pagination (minimal data).
 * Does NOT return chats in subfolders.
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @query {Types.FolderChatListQuery} - pagination parameters (10 items per page)
 * @returns {Types.FolderChatListItemResponse[]} - minimal chat info
 */
router.get('/folder/:folder_id/list', validateFolderId, requireAuth, async (
    req: Types.TypedRequest<Types.FolderIdParams, any, Types.FolderChatListQuery>,
    res: Response<Types.FolderChatListItemResponse[] | Types.ErrorResponse>
) => {
    const query = Types.FolderChatListQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { page } = query.data;
    const folderId = req.params.folder_id;
    const userId = req.user!.id;

    try {
        const pageSize = 10;
        const skip = (page - 1) * pageSize;

        const chats = await Chats.getChatsByFolderIdAndUserId(
            [folderId],
            userId,
            { skip, limit: pageSize },
            db
        );

        // Return minimal info (title, id, updated_at only)
        const response: Types.FolderChatListItemResponse[] = chats.map(chat => ({
            id: chat.id,
            title: chat.title,
            updated_at: chat.updatedAt,
        }));

        return res.json(response);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get folder chat list error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

export default router;
