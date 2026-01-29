/**
 * Chat routes - CRUD operations, sharing, folders, messages, and usage stats.
 *
 * Handles chat conversation management including creation, retrieval, updates,
 * deletion, sharing with public links, folder organization, message editing,
 * cloning, and usage statistics.
 */

import { Router, type Response, type NextFunction } from 'express';
import * as Types from './types.js';
import * as MockData from './mock-data.js';
import { requireAuth, requireAdmin, validateUserId, validateChatId, validateShareId, validateFolderId, validateChatAndMessageId } from './middleware.js';
import { db } from '../db/client.js';
import * as Chats from '../db/operations/chats.js';
import type { Chat } from '../db/schema.js';
import { HttpError, NotFoundError, ForbiddenError, BadRequestError, UnauthorizedError } from './errors.js';

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
    const { page, include_pinned: includePinned, include_folders: includeFolders } = query.data;

    try {
        let options: Chats.ListOptions = {
            includeArchived: false,
            includeFolders: includeFolders,
            includePinned: includePinned,
        };

        // Apply pagination if page is provided
        if (page !== undefined) {
            const pageSize = 60;
            options.skip = (page - 1) * pageSize;
            options.limit = pageSize;
        }

        const chats = await Chats.getChatTitleIdListByUserId(userId, options, db);

        // Map to response format
        const response: Types.ChatTitleIdResponse[] = chats.map(chat => ({
            id: chat.id,
            title: chat.title,
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
        const { items } = await Chats.getChatsByUserId(userId, {}, db);

        // Map to response format
        const response: Types.ChatResponse[] = items.map(chat => ({
            id: chat.id,
            user_id: chat.userId,
            title: chat.title,
            chat: chat.chat,
            updated_at: chat.updatedAt,
            created_at: chat.createdAt,
            share_id: chat.shareId,
            archived: chat.archived,
            pinned: chat.pinned ?? false,
            meta: chat.meta || {},
            folder_id: chat.folderId,
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
 * GET /api/v1/chats/all/db
 * Access Control: Admin only, requires ENABLE_ADMIN_EXPORT config flag
 *
 * Export ALL chats from ALL users in the database (for data export/backup).
 *
 * @returns {Types.ChatResponse[]} - all chats in system
 */
router.get('/all/db', requireAdmin, (
    req: Types.TypedRequest,
    res: Response<Types.ChatResponse[] | Types.ErrorResponse>
) => {
    // TODO: Check ENABLE_ADMIN_EXPORT config flag
    const adminExportEnabled = true;  // Mock value

    if (!adminExportEnabled) {
        return res.status(401).json({
            detail: 'Admin export is disabled'
        });
    }

    // TODO: Query ALL chats from database (no user filter)
    const allChats = MockData.mockChats;

    res.json(allChats);
});

/**
 * GET /api/v1/chats/:id
 * Access Control: User can only access their own chats
 *
 * Get a specific chat by ID including full messages and metadata.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {Types.ChatResponse | null} - full chat object or null if not found
 */
router.get('/:id', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const chatId = req.params.id;
    const userId = req.user!.id;

    try {
        const chat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!chat) throw NotFoundError('Chat not found or unauthorized');

        const response: Types.ChatResponse = {
            id: chat.id,
            user_id: chat.userId,
            title: chat.title,
            chat: chat.chat,
            updated_at: chat.updatedAt,
            created_at: chat.createdAt,
            share_id: chat.shareId || undefined,
            archived: chat.archived,
            pinned: chat.pinned ?? false,
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

/**
 * GET /api/v1/chats/list/user/:user_id
 * Access Control: Admin only, requires ENABLE_ADMIN_CHAT_ACCESS config flag
 *
 * Get chats for a specific user (includes archived chats).
 *
 * @param {Types.UserIdParams} - path parameters with user ID
 * @query {Types.UserChatListQuery} - pagination, search, and sorting parameters
 * @returns {Types.ChatTitleIdResponse[]} - minimal chat info
 */
router.get('/list/user/:user_id', validateUserId, requireAdmin, (
    req: Types.TypedRequest<Types.UserIdParams, any, Types.UserChatListQuery>,
    res: Response<Types.ChatTitleIdResponse[] | Types.ErrorResponse>
) => {
    const query = Types.UserChatListQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const userId = req.params.user_id;
    const { page, query: searchQuery, order_by, direction } = query.data;

    // TODO: Check ENABLE_ADMIN_CHAT_ACCESS config flag
    const adminChatAccessEnabled = true;  // Mock value

    if (!adminChatAccessEnabled) {
        return res.status(401).json({
            detail: 'Admin chat access is disabled'
        });
    }

    // TODO: Query chats from database filtered by user_id (including archived)
    let chats = MockData.mockChats.filter(chat => chat.user_id === userId);

    // Apply filtering by query if provided
    if (searchQuery) {
        chats = chats.filter(chat => chat.title.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    // Apply sorting if provided
    // TODO: Implement proper sorting by order_by and direction

    // Apply pagination
    const skip = (page - 1) * 60;
    const limit = 60;
    chats = chats.slice(skip, skip + limit);

    const response: Types.ChatTitleIdResponse[] = chats.map(chat => ({
        id: chat.id,
        title: chat.title,
        updated_at: chat.updated_at,
        created_at: chat.created_at,
    }));

    res.json(response);
});

/* -------------------- CHAT CREATION & MODIFICATION -------------------- */

/**
 * POST /api/v1/chats/new
 * Access Control: Any authenticated user can create chats
 *
 * Create a new chat conversation.
 *
 * @body {Types.ChatForm} - chat data and optional folder ID
 * @returns {Types.ChatResponse | null} - created chat object
 */
router.post('/new', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ChatForm>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const body = Types.ChatFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const userId = req.user!.id;

    try {
        const newChat = await Chats.createChat(userId, body.data, db);

        const response: Types.ChatResponse = {
            id: newChat.id,
            user_id: newChat.userId,
            title: newChat.title,
            chat: newChat.chat,
            updated_at: newChat.updatedAt,
            created_at: newChat.createdAt,
            share_id: newChat.shareId,
            archived: newChat.archived,
            pinned: newChat.pinned ?? false,
            meta: newChat.meta || {},
            folder_id: newChat.folderId,
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
 * @returns {Types.ChatResponse | null} - updated chat object or null if unauthorized
 */
router.post('/:id', validateChatId, requireAuth, async (
    req: Types.TypedRequest<Types.ChatIdParams, Types.ChatForm>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
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
        if (!existingChat) throw NotFoundError('Chat not found or unauthorized');

        // Update chat
        const updatedChat = await Chats.updateChat(chatId, body.data, db);
        if (!updatedChat) throw NotFoundError('Chat not found');

        const response: Types.ChatResponse = {
            id: updatedChat.id,
            user_id: updatedChat.userId,
            title: updatedChat.title,
            chat: updatedChat.chat,
            updated_at: updatedChat.updatedAt,
            created_at: updatedChat.createdAt,
            share_id: updatedChat.shareId,
            archived: updatedChat.archived,
            pinned: updatedChat.pinned ?? false,
            meta: updatedChat.meta || {},
            folder_id: updatedChat.folderId,
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
        const success = await Chats.deleteChatByIdAndUserId(chatId, userId, db);
        if (!success) throw NotFoundError('Chat not found.');

        return res.json(success);
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

/* -------------------- SHARING & CLONING -------------------- */

/**
 * POST /api/v1/chats/:id/share
 * Access Control: User must own the chat and have chat.share permission
 *
 * Share a chat by generating a public share link.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {Types.ChatResponse | null} - chat with share_id populated
 */
router.post('/:id/share', validateChatId, requireAuth, (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const { id } = req.params;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;
    const isAdmin = true;  // Mock value

    // TODO: Check chat.share permission (unless admin)
    if (!isAdmin) {
        const hasSharePermission = true;  // Mock value
        if (!hasSharePermission) {
            return res.status(401).json({
                detail: 'Missing chat.share permission'
            });
        }
    }

    // TODO: Query chat from database to verify ownership
    const chat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);

    if (!chat) {
        return res.status(401).json({
            detail: 'Chat not found or unauthorized'
        });
    }

    // TODO: If already shared, update share timestamp; otherwise create new share
    const shareId = chat.share_id ?? crypto.randomUUID();

    const sharedChat: Types.ChatResponse = {
        ...chat,
        share_id: shareId,
        updated_at: Math.floor(Date.now() / 1000),
    };

    res.json(sharedChat);
});

/**
 * GET /api/v1/chats/share/:share_id
 * Access Control: Any authenticated user can view shared chats
 *
 * Get a shared chat by its public share ID (read-only access).
 *
 * @param {Types.ShareIdParams} - path parameters with share ID
 * @returns {Types.ChatResponse | null} - full chat data
 */
router.get('/share/:share_id', validateShareId, requireAuth, (
    req: Types.TypedRequest<Types.ShareIdParams>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const { share_id } = req.params;

    // TODO: Query chat from database by share_id
    const chat = MockData.mockChats.find(c => c.share_id === share_id);

    if (!chat) {
        return res.status(404).json({
            detail: 'Shared chat not found'
        });
    }

    res.json(chat);
});

/**
 * DELETE /api/v1/chats/:id/share
 * Access Control: User must own the chat
 *
 * Unshare a chat by removing its public share link.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {boolean | null} - true if successful, false if not currently shared
 */
router.delete('/:id/share', validateChatId, requireAuth, (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<boolean | null | Types.ErrorResponse>
) => {
    const { id } = req.params;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chat from database to verify ownership
    const chat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);

    if (!chat) {
        return res.status(401).json({
            detail: 'Chat not found or unauthorized'
        });
    }

    // Return false if not currently shared
    if (!chat.share_id) {
        return res.json(false);
    }

    // TODO: Delete shared chat entry and update chat to set share_id to null
    res.json(true);
});

/**
 * POST /api/v1/chats/:id/clone/shared
 * Access Control: Any authenticated user can clone publicly shared chats
 *
 * Clone a shared chat to the current user's account.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {Types.ChatResponse | null} - cloned chat owned by current user
 */
router.post('/:id/clone/shared', validateChatId, requireAuth, (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const { id } = req.params;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chat from database and verify it has a share_id
    const originalChat = MockData.mockChats.find(c => c.id === id);

    if (!originalChat || !originalChat.share_id) {
        return res.status(404).json({
            detail: 'Shared chat not found'
        });
    }

    // TODO: Create new chat owned by current user with copied data
    const now = Math.floor(Date.now() / 1000);
    const clonedChat: Types.ChatResponse = {
        ...originalChat,
        id: crypto.randomUUID(),
        user_id: userId,
        share_id: null,
        created_at: now,
        updated_at: now,
    };

    res.json(clonedChat);
});

/**
 * POST /api/v1/chats/:id/clone
 * Access Control: User must own the original chat
 *
 * Clone one of your own chats.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @body {Types.CloneForm} - optional new title for cloned chat
 * @returns {Types.ChatResponse | null} - cloned chat with new ID
 */
router.post('/:id/clone', validateChatId, requireAuth, (
    req: Types.TypedRequest<Types.ChatIdParams, Types.CloneForm>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const { id } = req.params;

    const body = Types.CloneFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { title } = body.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chat from database to verify ownership
    const originalChat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);

    if (!originalChat) {
        return res.status(401).json({
            detail: 'Chat not found or unauthorized'
        });
    }

    // TODO: Create new chat with copied data
    const now = Math.floor(Date.now() / 1000);
    const clonedChat: Types.ChatResponse = {
        ...originalChat,
        id: crypto.randomUUID(),
        title: title ?? originalChat.title,
        share_id: null,
        created_at: now,
        updated_at: now,
    };

    res.json(clonedChat);
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
 * @returns {Types.ChatResponse | null} - updated chat object
 */
router.post('/:id/folder', validateChatId, requireAuth, (
    req: Types.TypedRequest<Types.ChatIdParams, Types.ChatFolderIdForm>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const { id } = req.params;

    const body = Types.ChatFolderIdFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { folder_id } = body.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chat from database to verify ownership
    const chat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);

    if (!chat) {
        return res.status(401).json({
            detail: 'Chat not found or unauthorized'
        });
    }

    // TODO: Update folder_id in database
    const updatedChat: Types.ChatResponse = {
        ...chat,
        folder_id: folder_id ?? null,
        updated_at: Math.floor(Date.now() / 1000),
    };

    res.json(updatedChat);
});

/**
 * GET /api/v1/chats/folder/:folder_id
 * Access Control: User can only access their own folders/chats
 *
 * Get all chats in a specific folder with full chat data.
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @returns {Types.ChatResponse[]} - full chat objects in folder
 */
router.get('/folder/:folder_id', validateFolderId, requireAuth, (
    req: Types.TypedRequest<Types.FolderIdParams>,
    res: Response<Types.ChatResponse[] | Types.ErrorResponse>
) => {
    const { folder_id } = req.params;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chats from database filtered by folder_id and user_id
    const chats = MockData.mockChats.filter(chat =>
        chat.folder_id === folder_id && chat.user_id === userId
    );

    res.json(chats);
});

/**
 * GET /api/v1/chats/folder/:folder_id/list
 * Access Control: User can only access their own folders/chats
 *
 * Get chat list for a specific folder with pagination (minimal data).
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @query {Types.FolderChatListQuery} - pagination parameters (10 items per page)
 * @returns {Types.FolderChatListItemResponse[]} - minimal chat info
 */
router.get('/folder/:folder_id/list', validateFolderId, requireAuth, (
    req: Types.TypedRequest<Types.FolderIdParams, any, Types.FolderChatListQuery>,
    res: Response<Types.FolderChatListItemResponse[] | Types.ErrorResponse>
) => {
    const { folder_id } = req.params;

    const query = Types.FolderChatListQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { page } = query.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chats from database filtered by folder_id and user_id
    let chats = MockData.mockChats.filter(chat =>
        chat.folder_id === folder_id && chat.user_id === userId
    );

    // Apply pagination (10 items per page)
    const skip = (page - 1) * 10;
    const limit = 10;
    chats = chats.slice(skip, skip + limit);

    // Return minimal info (title, id, updated_at only)
    const response: Types.FolderChatListItemResponse[] = chats.map(chat => ({
        title: chat.title,
        id: chat.id,
        updated_at: chat.updated_at,
    }));

    res.json(response);
});

/* -------------------- MESSAGE OPERATIONS -------------------- */

/**
 * POST /api/v1/chats/:id/messages/:message_id
 * Access Control: User must own the chat
 *
 * Update the content of a specific message in a chat.
 *
 * @param {Types.MessageIdParams} - path parameters with chat ID and message ID
 * @body {Types.MessageForm} - new message content
 * @returns {Types.ChatResponse | null} - updated full chat object
 */
router.post('/:id/messages/:message_id', validateChatAndMessageId, requireAuth, (
    req: Types.TypedRequest<Types.MessageIdParams, Types.MessageForm>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const { id, message_id } = req.params;

    const body = Types.MessageFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { content } = body.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chat from database to verify ownership
    const chat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);

    if (!chat) {
        return res.status(401).json({
            detail: 'Chat not found or unauthorized'
        });
    }

    // TODO: Update message content in chat.chat.messages array
    // For now, just return the chat as-is (mock)
    const updatedChat: Types.ChatResponse = {
        ...chat,
        updated_at: Math.floor(Date.now() / 1000),
    };

    res.json(updatedChat);
});

/**
 * POST /api/v1/chats/:id/messages/:message_id/event
 * Access Control: User must have access to the chat
 *
 * Send an event related to a message (e.g., typing indicators, reactions).
 *
 * @param {Types.MessageIdParams} - path parameters with chat ID and message ID
 * @body {Types.EventForm} - event type and data
 * @returns {boolean | null} - true if successful
 */
router.post('/:id/messages/:message_id/event', validateChatAndMessageId, requireAuth, (
    req: Types.TypedRequest<Types.MessageIdParams, Types.EventForm>,
    res: Response<boolean | null | Types.ErrorResponse>
) => {
    const { id, message_id } = req.params;

    const body = Types.EventFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { type, data } = body.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Verify user has access to chat
    const chat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);

    if (!chat) {
        return res.status(401).json({
            detail: 'Chat not found or unauthorized'
        });
    }

    // TODO: Process event (e.g., broadcast to other clients, store in database)
    res.json(true);
});

/* -------------------- STATISTICS -------------------- */

/**
 * GET /api/v1/chats/stats/usage
 * Access Control: User can only access their own stats
 *
 * Get usage statistics for the current user's chats (message counts, models used, response times, etc.).
 * EXPERIMENTAL - may be removed in future releases.
 *
 * @query {Types.ChatUsageStatsQuery} - pagination parameters
 * @returns {Types.ChatUsageStatsListResponse} - paginated chat usage statistics
 */
router.get('/stats/usage', requireAuth, (
    req: Types.TypedRequest<{}, any, Types.ChatUsageStatsQuery>,
    res: Response<Types.ChatUsageStatsListResponse | Types.ErrorResponse>
) => {
    const query = Types.ChatUsageStatsQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { items_per_page, page } = query.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chat statistics from database
    // For now, return mock stats based on user's chats
    const userChats = MockData.mockChats.filter(chat => chat.user_id === userId);

    const stats: Types.ChatUsageStatsResponse[] = userChats.map(chat => ({
        id: chat.id,
        models: {},
        message_count: 2,
        history_models: { 'gpt-4': 1 },
        history_message_count: 2,
        history_user_message_count: 1,
        history_assistant_message_count: 1,
        average_response_time: 1.5,
        average_user_message_content_length: 50,
        average_assistant_message_content_length: 150,
        tags: [],
        last_message_at: chat.updated_at,
        updated_at: chat.updated_at,
        created_at: chat.created_at,
    }));

    // Apply pagination
    const skip = (page - 1) * items_per_page;
    const paginatedStats = stats.slice(skip, skip + items_per_page);

    const response: Types.ChatUsageStatsListResponse = {
        items: paginatedStats,
        total: stats.length,
    };

    res.json(response);
});

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Get computed permissions for a user based on their role
 * TODO: Implement database-backed permissions with user/group overrides
 */
function getPermissions(role: Types.UserRole): Types.UserPermissions {
    const isAdmin = role === 'admin';

    // TODO: Load default permissions from config or database
    const permissions: Types.UserPermissions = {
        workspace: {
            models: isAdmin,
            knowledge: isAdmin,
            prompts: isAdmin,
            tools: isAdmin,
            models_import: isAdmin,
            models_export: isAdmin,
            prompts_import: isAdmin,
            prompts_export: isAdmin,
            tools_import: isAdmin,
            tools_export: isAdmin,
        },
        sharing: {
            models: false,
            public_models: false,
            knowledge: false,
            public_knowledge: false,
            prompts: false,
            public_prompts: false,
            tools: false,
            public_tools: false,
            notes: false,
            public_notes: false,
        },
        chat: {
            controls: true,
            valves: true,
            system_prompt: true,
            params: true,
            file_upload: true,
            delete: true,
            delete_message: true,
            continue_response: true,
            regenerate_response: true,
            rate_response: true,
            edit: true,
            share: true,
            export: true,
            stt: true,
            tts: true,
            call: true,
            multiple_models: true,
            temporary: true,
            temporary_enforced: false,
        },
        features: {
            api_keys: isAdmin,
            notes: false,
            channels: false,
            folders: true,
            direct_tool_servers: isAdmin,
            web_search: true,
            image_generation: false,
            code_interpreter: false,
            memories: false,
        },
        settings: {
            interface: true,
        },
    };

    return permissions;
}

export default router;
