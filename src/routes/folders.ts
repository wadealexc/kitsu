/**
 * Folder routes - hierarchical folder organization for chats.
 *
 * Handles folder creation, retrieval, updates, deletion, and organization.
 * Folders support hierarchical structures (parent-child relationships) and are user-scoped.
 */

import { Router, type Response } from 'express';
import * as Types from './types.js';
import * as MockData from './mock-data.js';
import { requireAuth, validateFolderId } from './middleware.js';

const router = Router();

/* -------------------- FOLDER LIST & RETRIEVAL -------------------- */

/**
 * GET /api/v1/folders/
 * Access Control: User can only access their own folders
 *
 * Get all folders for the current user.
 *
 * @returns {Types.FolderNameIdResponse[]} - array of folder name/ID responses
 */
router.get('/', requireAuth, (
    req: Types.TypedRequest,
    res: Response<Types.FolderNameIdResponse[] | Types.ErrorResponse>
) => {
    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query folders from database filtered by user_id
    const folders = MockData.mockFolders.filter(folder => folder.user_id === userId);

    // Map to FolderNameIdResponse (lightweight response)
    const response: Types.FolderNameIdResponse[] = folders.map(folder => ({
        id: folder.id,
        name: folder.name,
        meta: folder.meta ? folder.meta as Types.FolderMetadataResponse : null,
        parent_id: folder.parent_id ?? null,
        is_expanded: folder.is_expanded,
        created_at: folder.created_at,
        updated_at: folder.updated_at,
    }));

    res.json(response);
});

/**
 * GET /api/v1/folders/:folder_id
 * Access Control: User can only access their own folders
 *
 * Get a specific folder by ID with all details.
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @returns {Types.FolderModel | null} - full folder object or null
 */
router.get('/:folder_id', validateFolderId, requireAuth, (
    req: Types.TypedRequest<Types.FolderIdParams>,
    res: Response<Types.FolderModel | null | Types.ErrorResponse>
) => {
    const { folder_id } = req.params;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query folder from database with id and user_id filter
    const folder = MockData.mockFolders.find(f =>
        f.id === folder_id && f.user_id === userId
    );

    if (!folder) {
        return res.status(404).json({
            detail: 'Folder not found'
        });
    }

    res.json(folder);
});

/* -------------------- FOLDER CREATION & MODIFICATION -------------------- */

/**
 * POST /api/v1/folders/
 * Access Control: Any verified user can create folders
 *
 * Create a new root-level folder for the user.
 *
 * @body {Types.FolderForm} - folder creation data
 * @returns {Types.FolderModel} - created folder object
 */
router.post('/', requireAuth, (
    req: Types.TypedRequest<{}, Types.FolderForm>,
    res: Response<Types.FolderModel | Types.ErrorResponse>
) => {
    const bodyValidation = Types.FolderFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { name, data, meta } = bodyValidation.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Check for duplicate folder names at root level
    const existingFolder = MockData.mockFolders.find(f =>
        f.user_id === userId && f.parent_id === null && f.name === name
    );

    if (existingFolder) {
        return res.status(400).json({
            detail: 'Folder already exists'
        });
    }

    // TODO: Insert new folder into database
    const now = Math.floor(Date.now() / 1000);
    const newFolder: Types.FolderModel = {
        id: crypto.randomUUID(),
        parent_id: null,
        user_id: userId,
        name,
        items: null,
        meta: meta ?? null,
        data: data ?? null,
        is_expanded: false,
        created_at: now,
        updated_at: now,
    };

    res.json(newFolder);
});

/**
 * POST /api/v1/folders/:folder_id/update
 * Access Control: User can only update their own folders
 *
 * Update folder properties (name, data, meta).
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @body {Types.FolderUpdateForm} - folder update data
 * @returns {Types.FolderModel} - updated folder object
 */
router.post('/:folder_id/update', validateFolderId, requireAuth, (
    req: Types.TypedRequest<Types.FolderIdParams, Types.FolderUpdateForm>,
    res: Response<Types.FolderModel | Types.ErrorResponse>
) => {
    const { folder_id } = req.params;

    const bodyValidation = Types.FolderUpdateFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { name, data, meta } = bodyValidation.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query folder from database
    const folder = MockData.mockFolders.find(f =>
        f.id === folder_id && f.user_id === userId
    );

    if (!folder) {
        return res.status(404).json({
            detail: 'Folder not found'
        });
    }

    // TODO: If name is updated, check for duplicates within same parent
    if (name !== undefined && name !== null) {
        const existingFolder = MockData.mockFolders.find(f =>
            f.user_id === userId && f.parent_id === folder.parent_id && f.name === name && f.id !== folder_id
        );

        if (existingFolder) {
            return res.status(400).json({
                detail: 'Folder already exists'
            });
        }
    }

    // TODO: Update folder in database (merge data and meta)
    const now = Math.floor(Date.now() / 1000);
    const updatedFolder: Types.FolderModel = {
        ...folder,
        name: name !== undefined && name !== null ? name : folder.name,
        data: data ? { ...folder.data, ...data } : folder.data,
        meta: meta ? { ...folder.meta, ...meta } : folder.meta,
        updated_at: now,
    };

    res.json(updatedFolder);
});

/**
 * POST /api/v1/folders/:folder_id/update/parent
 * Access Control: User can only update their own folders
 *
 * Move a folder to a different parent folder or root level.
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @body {Types.FolderParentIdForm} - new parent ID
 * @returns {Types.FolderModel} - updated folder object
 */
router.post('/:folder_id/update/parent', validateFolderId, requireAuth, (
    req: Types.TypedRequest<Types.FolderIdParams, Types.FolderParentIdForm>,
    res: Response<Types.FolderModel | Types.ErrorResponse>
) => {
    const { folder_id } = req.params;

    const bodyValidation = Types.FolderParentIdFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { parent_id } = bodyValidation.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query folder from database
    const folder = MockData.mockFolders.find(f =>
        f.id === folder_id && f.user_id === userId
    );

    if (!folder) {
        return res.status(404).json({
            detail: 'Folder not found'
        });
    }

    // TODO: Check for duplicate names in target parent
    const existingFolder = MockData.mockFolders.find(f =>
        f.user_id === userId && f.parent_id === (parent_id ?? null) && f.name === folder.name
    );

    if (existingFolder) {
        return res.status(400).json({
            detail: 'Folder already exists'
        });
    }

    // TODO: Update folder parent_id in database
    const now = Math.floor(Date.now() / 1000);
    const updatedFolder: Types.FolderModel = {
        ...folder,
        parent_id: parent_id ?? null,
        updated_at: now,
    };

    res.json(updatedFolder);
});

/**
 * POST /api/v1/folders/:folder_id/update/expanded
 * Access Control: User can only update their own folders
 *
 * Update the UI expansion state of a folder (for tree view persistence).
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @body {Types.FolderIsExpandedForm} - expansion state
 * @returns {Types.FolderModel} - updated folder object
 */
router.post('/:folder_id/update/expanded', validateFolderId, requireAuth, (
    req: Types.TypedRequest<Types.FolderIdParams, Types.FolderIsExpandedForm>,
    res: Response<Types.FolderModel | Types.ErrorResponse>
) => {
    const { folder_id } = req.params;

    const bodyValidation = Types.FolderIsExpandedFormSchema.safeParse(req.body);
    if (!bodyValidation.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: bodyValidation.error.issues
        });
    }

    const { is_expanded } = bodyValidation.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query folder from database
    const folder = MockData.mockFolders.find(f =>
        f.id === folder_id && f.user_id === userId
    );

    if (!folder) {
        return res.status(404).json({
            detail: 'Folder not found'
        });
    }

    // TODO: Update folder is_expanded in database
    const now = Math.floor(Date.now() / 1000);
    const updatedFolder: Types.FolderModel = {
        ...folder,
        is_expanded,
        updated_at: now,
    };

    res.json(updatedFolder);
});

/**
 * DELETE /api/v1/folders/:folder_id
 * Access Control: User can only delete their own folders
 *
 * Delete a folder and optionally its contents.
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @query {Types.FolderDeleteQuery} - deletion options
 * @returns {boolean} - true on success
 */
router.delete('/:folder_id', validateFolderId, requireAuth, (
    req: Types.TypedRequest<Types.FolderIdParams, any, Types.FolderDeleteQuery>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const { folder_id } = req.params;

    const queryValidation = Types.FolderDeleteQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: queryValidation.error.issues
        });
    }

    const { delete_contents } = queryValidation.data;

    // TODO: Get user ID from JWT token
    const userId = MockData.MOCK_ADMIN_USER_ID;

    // TODO: Query folder from database
    const folder = MockData.mockFolders.find(f =>
        f.id === folder_id && f.user_id === userId
    );

    if (!folder) {
        return res.status(404).json({
            detail: 'Folder not found'
        });
    }

    // TODO: Recursively delete subfolders
    // TODO: Delete or move chats based on delete_contents parameter
    // If delete_contents=true: delete all chats in folder and subfolders
    // If delete_contents=false: move chats to root level (folder_id = null)

    res.json(true);
});

export default router;
