/**
 * Folder routes - hierarchical folder organization for chats.
 *
 * Handles folder creation, retrieval, updates, deletion, and organization.
 * Folders support hierarchical structures (parent-child relationships) and are user-scoped.
 */

import { Router, type Response } from 'express';
import * as Types from './types/index.js';
import { requireAuth, validateFolderId } from './middleware.js';
import { db } from '../db/client.js';
import * as Folders from '../db/operations/folders.js';
import * as Chats from '../db/operations/chats.js';
import { HttpError, NotFoundError, UnauthorizedError } from './errors.js';

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
router.get('/', requireAuth, async (
    req: Types.TypedRequest,
    res: Response<Types.FolderNameIdResponse[] | Types.ErrorResponse>
) => {
    const userId = req.user!.id;

    try {
        const folders = await Folders.getFoldersByUserId(userId, db);

        return res.json(folders.map(toFolderNameIdResponse));
    } catch (error) {
        console.error('Get folders error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/folders/:folder_id
 * Access Control: User can only access their own folders
 *
 * Get a specific folder by ID with all details.
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @returns {Types.Folder} - full folder object
 */
router.get('/:folderId', validateFolderId, requireAuth, async (
    req: Types.TypedRequest<Types.FolderIdParams>,
    res: Response<Types.Folder | Types.ErrorResponse>
) => {
    const { folderId } = req.params;
    const userId = req.user!.id;

    try {
        const folder = await Folders.getFolderById(folderId, userId, db);
        if (!folder) throw NotFoundError('Folder not found');

        return res.json(folder);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Get folder by id error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- FOLDER CREATION & MODIFICATION -------------------- */

/**
 * POST /api/v1/folders/
 * Access Control: Any verified user can create folders
 *
 * Create a new root-level folder for the user.
 *
 * @body {Types.FolderForm} - folder creation data
 * @returns {Types.Folder} - created folder object
 */
router.post('/', requireAuth, async (
    req: Types.TypedRequest<{}, Types.FolderForm>,
    res: Response<Types.Folder | Types.ErrorResponse>
) => {
    const body = Types.FolderFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const userId = req.user!.id;

    try {
        // Create folder at root level
        const folder = await Folders.createFolder({ ...body.data, userId }, db);

        return res.json(folder);
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Create folder error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/folders/:folder_id/update
 * Access Control: User can only update their own folders
 *
 * Update folder properties (name, data, meta).
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @body {Types.FolderUpdateForm} - folder update data
 * @returns {Types.Folder} - updated folder object
 */
router.post('/:folderId/update', validateFolderId, requireAuth, async (
    req: Types.TypedRequest<Types.FolderIdParams, Types.FolderUpdateForm>,
    res: Response<Types.Folder | Types.ErrorResponse>
) => {
    const body = Types.FolderUpdateFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { folderId } = req.params;
    const userId = req.user!.id;
    const { name, data, meta } = body.data;

    try {
        // Update folder
        const folder = await Folders.updateFolder(
            folderId,
            userId,
            { name: name || undefined, data, meta },
            db
        );

        return res.json(folder);
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Update folder error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/folders/:folder_id/update/parent
 * Access Control: User can only update their own folders
 *
 * Move a folder to a different parent folder or root level.
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @body {Types.FolderParentIdForm} - new parent ID
 * @returns {Types.Folder} - updated folder object
 */
router.post('/:folderId/update/parent', validateFolderId, requireAuth, async (
    req: Types.TypedRequest<Types.FolderIdParams, Types.FolderParentIdForm>,
    res: Response<Types.Folder | Types.ErrorResponse>
) => {
    const body = Types.FolderParentIdFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { parentId } = body.data;
    const { folderId } = req.params;
    const userId = req.user!.id;

    try {
        const folder = await Folders.updateFolderParent(
            folderId,
            userId,
            parentId ?? null,
            db
        );

        return res.json(folder);
    } catch (error: any) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Update folder parent error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/folders/:folder_id/update/expanded
 * Access Control: User can only update their own folders
 *
 * Update the UI expansion state of a folder (for tree view persistence).
 *
 * @param {Types.FolderIdParams} - path parameters with folder ID
 * @body {Types.FolderIsExpandedForm} - expansion state
 * @returns {Types.Folder} - updated folder object
 */
router.post('/:folderId/update/expanded', validateFolderId, requireAuth, async (
    req: Types.TypedRequest<Types.FolderIdParams, Types.FolderIsExpandedForm>,
    res: Response<Types.Folder | Types.ErrorResponse>
) => {
    const body = Types.FolderIsExpandedFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { folderId } = req.params;
    const userId = req.user!.id;
    const { isExpanded } = body.data;

    try {
        const folder = await Folders.updateFolderExpanded(
            folderId,
            userId,
            isExpanded,
            db
        );

        return res.json(folder);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Update folder expanded error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
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
router.delete('/:folderId', validateFolderId, requireAuth, async (
    req: Types.TypedRequest<Types.FolderIdParams, any, Types.FolderDeleteQuery>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const query = Types.FolderDeleteQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { folderId } = req.params;
    const userId = req.user!.id;
    const { deleteContents } = query.data;

    try {
        // Check if folder exists
        const folder = await Folders.getFolderById(folderId, userId, db);
        if (!folder) throw NotFoundError('Folder not found');

        // Perform deletion in transaction
        await db.transaction(async (tx) => {
            const foldersToDelete = await Folders.getChildrenFolders(folderId, userId, tx);
            const idsToDelete = [...(foldersToDelete.map(f => f.id)), folderId];

            // Handle chats based on delete_contents parameter
            //
            // Note: If delete_contents is false, chats are automatically moved to root
            // by the database's ON DELETE SET NULL foreign key constraint on folderId
            if (deleteContents) {
                // Delete all chats in deleted folders
                for (const folderId of idsToDelete) {
                    await Chats.deleteChatsInFolder(userId, folderId, tx);
                }
            }

            // Delete folder (automatically deletes children)
            await Folders.deleteFolder(folderId, userId, tx);
        });

        return res.json(true);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Delete folder error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Convert Folder to FolderNameIdResponse format (lightweight list response)
 * Handles field translation from DB schema to API schema
 */
function toFolderNameIdResponse(folder: Types.Folder): Types.FolderNameIdResponse {
    const { userId: _, data: __, ...response } = folder;
    return response;
}

export default router;
