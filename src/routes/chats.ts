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
router.get(['/', '/list'], requireAuth, (
    req: Types.TypedRequest<{}, any, Types.ChatListQuery>,
    res: Response<Types.ChatTitleIdResponse[] | Types.ErrorResponse>
) => {
    const queryValidation = Types.ChatListQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: queryValidation.error.issues
        });
    }

    const { page, include_pinned, include_folders } = queryValidation.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chats from database filtered by user_id
    // Filter chats by user
    let chats = MockData.mockChats.filter(chat => chat.user_id === userId);

    // Filter by pinned/folders flags
    if (!include_pinned) {
        chats = chats.filter(chat => !chat.pinned);
    }
    if (!include_folders) {
        chats = chats.filter(chat => !chat.folder_id);
    }

    // Filter out archived chats
    chats = chats.filter(chat => !chat.archived);

    // Apply pagination if page is provided
    if (page !== undefined) {
        const skip = (page - 1) * 60;
        const limit = 60;
        chats = chats.slice(skip, skip + limit);
    }

    // Map to minimal response
    const response: Types.ChatTitleIdResponse[] = chats.map(chat => ({
        id: chat.id,
        title: chat.title,
        updated_at: chat.updated_at,
        created_at: chat.created_at,
    }));

    res.json(response);
});

/**
 * GET /api/v1/chats/all
 * Access Control: Any authenticated user can access their own chats
 *
 * Get all chats for the current user with full chat data including messages.
 *
 * @returns {Types.ChatResponse[]} - full chat objects (no pagination)
 */
router.get('/all', requireAuth, (
    req: Types.TypedRequest,
    res: Response<Types.ChatResponse[] | Types.ErrorResponse>
) => {
    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query all chats from database filtered by user_id
    const chats = MockData.mockChats.filter(chat => chat.user_id === userId);

    res.json(chats);
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
router.get('/:id', validateChatId, requireAuth, (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const { id } = req.params;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chat from database by id and user_id
    const chat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);

    if (!chat) {
        return res.status(401).json({
            detail: 'Chat not found or unauthorized'
        });
    }

    res.json(chat);
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
    const { user_id } = req.params;

    const queryValidation = Types.UserChatListQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: queryValidation.error.issues
        });
    }

    const { page, query, order_by, direction } = queryValidation.data;

    // TODO: Check ENABLE_ADMIN_CHAT_ACCESS config flag
    const adminChatAccessEnabled = true;  // Mock value

    if (!adminChatAccessEnabled) {
        return res.status(401).json({
            detail: 'Admin chat access is disabled'
        });
    }

    // TODO: Query chats from database filtered by user_id (including archived)
    let chats = MockData.mockChats.filter(chat => chat.user_id === user_id);

    // Apply filtering by query if provided
    if (query) {
        chats = chats.filter(chat => chat.title.toLowerCase().includes(query.toLowerCase()));
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
router.post('/new', requireAuth, (
    req: Types.TypedRequest<{}, Types.ChatForm>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const bodyValidation = Types.ChatFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { chat, folder_id } = bodyValidation.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Insert new chat into database
    const now = Math.floor(Date.now() / 1000);
    const newChat: Types.ChatResponse = {
        id: crypto.randomUUID(),
        user_id: userId,
        title: 'New Chat',
        chat: chat,
        updated_at: now,
        created_at: now,
        share_id: null,
        archived: false,
        pinned: false,
        meta: {},
        folder_id: folder_id ?? null,
    };

    res.json(newChat);
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
router.post('/:id', validateChatId, requireAuth, (
    req: Types.TypedRequest<Types.ChatIdParams, Types.ChatForm>,
    res: Response<Types.ChatResponse | null | Types.ErrorResponse>
) => {
    const { id } = req.params;

    const bodyValidation = Types.ChatFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { chat, folder_id } = bodyValidation.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query chat from database to verify ownership
    let existingChat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);

    if (!existingChat) {
        existingChat = MockData.mockChats.at(0)!;
        // return res.status(401).json({
        //     detail: 'Chat not found or unauthorized'
        // });
    }

    // TODO: Update chat in database
    const updatedChat: Types.ChatResponse = {
        ...existingChat,
        chat: { ...existingChat.chat, ...chat },
        folder_id: folder_id ?? existingChat.folder_id,
        updated_at: Math.floor(Date.now() / 1000),
    };

    res.json(updatedChat);
});

/**
 * DELETE /api/v1/chats/:id
 * Access Control: User can delete own chats (requires chat.delete permission); Admin can delete any chat
 *
 * Delete a specific chat by ID. Admins can delete ANY chat; regular users can only delete their own chats.
 *
 * @param {Types.ChatIdParams} - path parameters with chat ID
 * @returns {boolean} - true if deletion successful
 */
router.delete('/:id', validateChatId, requireAuth, (
    req: Types.TypedRequest<Types.ChatIdParams>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const { id } = req.params;

    // TODO: Get user ID and role from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;
    const isAdmin = true;  // Mock value

    if (isAdmin) {
        // TODO: Admin path - delete chat by ID without user filter
        const chatExists = MockData.mockChats.some(c => c.id === id);
        if (!chatExists) {
            return res.status(404).json({
                detail: 'Chat not found'
            });
        }

        // TODO: Clean up tags if this was the last chat using specific tags
        res.json(true);
    } else {
        // TODO: Check user has chat.delete permission
        const hasDeletePermission = true;  // Mock value

        if (!hasDeletePermission) {
            return res.status(401).json({
                detail: 'Missing chat.delete permission'
            });
        }

        // TODO: User path - delete chat by ID and user_id
        const chat = MockData.mockChats.find(c => c.id === id && c.user_id === userId);
        if (!chat) {
            return res.status(404).json({
                detail: 'Chat not found'
            });
        }

        // TODO: Clean up tags
        res.json(true);
    }
});

/**
 * DELETE /api/v1/chats/
 * Access Control: Any authenticated user can delete their own chats
 *
 * Delete all chats for the current user (cannot be undone).
 *
 * @returns {boolean} - true if deletion successful
 */
router.delete('/', requireAuth, (
    req: Types.TypedRequest,
    res: Response<boolean | Types.ErrorResponse>
) => {
    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Delete all chats for user from database
    // This cannot be undone
    res.json(true);
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

    const bodyValidation = Types.CloneFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { title } = bodyValidation.data;

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

    const bodyValidation = Types.ChatFolderIdFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { folder_id } = bodyValidation.data;

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

    const queryValidation = Types.FolderChatListQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: queryValidation.error.issues
        });
    }

    const { page } = queryValidation.data;

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

    const bodyValidation = Types.MessageFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { content } = bodyValidation.data;

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

    const bodyValidation = Types.EventFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { type, data } = bodyValidation.data;

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
    const queryValidation = Types.ChatUsageStatsQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: queryValidation.error.issues
        });
    }

    const { items_per_page, page } = queryValidation.data;

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

export default router;
