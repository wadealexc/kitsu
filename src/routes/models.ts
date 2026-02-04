/**
 * Models API Router
 *
 * Provides model registry management endpoints for AI models.
 * Supports hybrid architecture: base models from LlamaManager + custom models from database.
 */

import { Router, type Response, type NextFunction } from 'express';
import type { LlamaManager } from '../llama/llamaManager.js';
import * as Types from './types.js';
import { requireAuth, requireAdmin } from './middleware.js';
import { db } from '../db/client.js';
import * as Models from '../db/operations/models.js';
import * as Users from '../db/operations/users.js';
import type { Model } from '../db/schema.js';
import { currentUnixTimestamp } from '../db/utils.js';
import { HttpError, NotFoundError, ForbiddenError, BadRequestError, UnauthorizedError } from './errors.js';

const router = Router();

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/v1/models/
 * Access Control: Any authenticated user
 *
 * Get all accessible models for current user (OpenAI-compatible format).
 * Returns base models from LlamaManager + custom models from database.
 *
 * @query {Types.ModelsQuery} - query parameters for optional refresh
 * @returns {{"data": Types.ModelResponse[]}} - OpenAI-compatible format with model array
 */
router.get('/', requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.ModelsQuery>,
    res: Response<{ data: Types.ModelResponse[] } | Types.ErrorResponse>,
    next: NextFunction
) => {
    const query = Types.ModelsQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: query.error.issues });
    }

    const userId = req.user!.id;

    try {
        // Get base models from LlamaManager
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();

        const adminUserId = (await Users.getFirstUser(db))?.id;
        if (!adminUserId) throw new Error(`unable to fetch first user id from db`);

        const baseModels: Types.ModelResponse[] = baseModelNames.map(name => ({
            id: name,
            user_id: adminUserId,
            base_model_id: null,
            name: name,
            params: {},
            meta: {
                profile_image_url: '/static/favicon.png',
                description: null,
                capabilities: null,
            },
            access_control: null,
            is_active: true,
            updated_at: 0,
            created_at: 0,
        }));

        // Get custom models from database
        const customModelsWithUser = await Models.getCustomModels(db);

        // Filter custom models by access control
        const accessibleCustomModels = customModelsWithUser.filter(model => {
            // Owner access
            if (model.userId === userId) return true;

            // Access control check
            return Models.hasAccess(userId, 'read', model.accessControl);
        });

        // Convert to response format
        const customModels: Types.ModelResponse[] = accessibleCustomModels.map(model => ({
            id: model.id,
            user_id: model.userId,
            base_model_id: model.baseModelId,
            name: model.name,
            params: model.params,
            meta: model.meta,
            access_control: model.accessControl,
            is_active: model.isActive,
            updated_at: model.updatedAt,
            created_at: model.createdAt,
        }));

        // Merge and return
        const allModels = [...baseModels, ...customModels];

        res.status(200).json({ data: allModels });
    } catch (err) {
        return next(new Error(`Failed to list models: ${err}`));
    }
});

/**
 * GET /api/v1/models/list
 * Access Control: Any authenticated user (filtered by access)
 *
 * Get paginated list of custom models only (from database) with filtering and sorting.
 * Base models are NOT included in this endpoint.
 *
 * @query {Types.ModelListQuery} - query parameters for search, filtering, and pagination
 * @returns {Types.ModelAccessListResponse} - paginated model list with access info
 */
router.get('/list', requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.ModelListQuery>,
    res: Response<Types.ModelAccessListResponse | Types.ErrorResponse>
) => {
    const query = Types.ModelListQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: query.error.issues });
    }

    const userId = req.user!.id;
    const { page, query: searchQuery, view_option: viewOption, order_by: orderBy, direction } = query.data;

    try {
        // Build filter
        const filter: Models.SearchFilter = {
            query: searchQuery,
            viewOption,
            orderBy,
            direction,
        };

        // Calculate pagination
        const pageSize = 30;
        const skip = (page - 1) * pageSize;

        // Search models
        const result = await Models.searchModels(userId, filter, skip, pageSize, db);

        // Convert to response format with write_access flag
        const items: Types.ModelAccessResponse[] = result.items.map(model => {
            const canWrite =
                model.userId === userId ||
                Models.hasAccess(userId, 'write', model.accessControl);

            return {
                id: model.id,
                user_id: model.userId,
                base_model_id: model.baseModelId,
                name: model.name,
                params: model.params,
                meta: model.meta,
                access_control: model.accessControl,
                is_active: model.isActive,
                updated_at: model.updatedAt,
                created_at: model.createdAt,
                user: {
                    id: model.user.id,
                    name: model.user.username,
                    email: model.user.username,  // Using username as email
                    role: model.user.role,
                    profile_image_url: model.user.profileImageUrl,
                },
                write_access: canWrite,
            };
        });

        res.status(200).json({ items, total: result.total });
    } catch (err) {
        return res.status(500).json({ detail: `Failed to list models: ${err}` });
    }
});

/**
 * GET /api/v1/models/model
 * Access Control: Any authenticated user (if they have read access)
 *
 * Get a specific model by ID with access validation.
 * Checks both base models (LlamaManager) and custom models (database).
 *
 * @query {Types.ModelIdQuery} - model ID to retrieve
 * @returns {Types.ModelAccessResponse | null} - model with access info, or null if not found/no access
 */
router.get('/model', requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.ModelIdQuery>,
    res: Response<Types.ModelAccessResponse | null | Types.ErrorResponse>
) => {
    const query = Types.ModelIdQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: query.error.issues });
    }

    const { id: modelId } = query.data;
    const userId = req.user!.id;

    try {
        // First check if ID exists in LlamaManager (base model)
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();

        const admin = (await Users.getFirstUser(db));
        if (!admin) throw new Error(`unable to fetch first user id from db`);

        if (baseModelNames.includes(modelId)) {
            // This is a base model - always accessible, no access control
            const response: Types.ModelAccessResponse = {
                id: modelId,
                user_id: admin.id,
                base_model_id: null,
                name: modelId,
                params: {},
                meta: {
                    profile_image_url: '/static/favicon.png',
                    description: null,
                    capabilities: null,
                },
                access_control: null,
                is_active: true,
                updated_at: 0,
                created_at: 0,
                user: {
                    id: admin.id,
                    name: admin.username,
                    email: admin.username,
                    role: admin.role,
                    profile_image_url: admin.profileImageUrl,
                },
                write_access: false,  // Base models cannot be modified via API
            };

            return res.status(200).json(response);
        }

        // Check database for custom model
        const model = await Models.getModelById(modelId, db);
        if (!model) throw NotFoundError('Model not found');

        // Check read access
        const canRead =
            model.userId === userId ||
            Models.hasAccess(userId, 'read', model.accessControl);

        if (!canRead) throw UnauthorizedError('User does not have access to model');

        // Check write access
        const canWrite =
            model.userId === userId ||
            Models.hasAccess(userId, 'write', model.accessControl);

        // Build response (need to get user info)
        const customModelsWithUser = await Models.getCustomModels(db);
        const modelWithUser = customModelsWithUser.find(m => m.id === modelId);

        const response: Types.ModelAccessResponse = {
            id: model.id,
            user_id: model.userId,
            base_model_id: model.baseModelId,
            name: model.name,
            params: model.params,
            meta: model.meta,
            access_control: model.accessControl,
            is_active: model.isActive,
            updated_at: model.updatedAt,
            created_at: model.createdAt,
            user: modelWithUser ? {
                id: modelWithUser.user.id,
                name: modelWithUser.user.username,
                email: modelWithUser.user.username,
                role: modelWithUser.user.role,
                profile_image_url: modelWithUser.user.profileImageUrl,
            } : null,
            write_access: canWrite,
        };

        res.status(200).json(response);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        return res.status(500).json({ detail: `Failed to get model: ${error}` });
    }
});

/**
 * POST /api/v1/models/create
 * Access Control: Any authenticated user
 *
 * Create a new custom model (stored in database).
 * Cannot create base models via API - those are configured in config.json.
 *
 * @param {Types.ModelForm} - Model creation data
 * @returns {Types.ModelModel} - Created model or null on failure
 */
router.post('/create', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ModelForm>,
    res: Response<Types.ModelModel | null | Types.ErrorResponse>
) => {
    const body = Types.ModelFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    const formData = body.data;
    const userId = req.user!.id;

    try {
        // Validate ID length
        if (formData.id.length > 256) throw BadRequestError('Model ID must be 256 characters or less');
            
        // Check if model ID already exists in database
        const existing = await Models.getModelById(formData.id, db);
        if (existing) throw BadRequestError('model id already taken');

        // Validate base_model_id is required
        if (!formData.base_model_id) throw BadRequestError('must specify base model id');

        // Validate base_model_id exists in LlamaManager
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();
        if (!baseModelNames.includes(formData.base_model_id)) throw BadRequestError('base model not found');

        // Create model in database
        const newModel = await Models.insertNewModel(formData, userId, db);
        if (!newModel) throw new Error('failed to create model');

        // Convert to response format
        const response: Types.ModelModel = {
            id: newModel.id,
            user_id: newModel.userId,
            base_model_id: newModel.baseModelId,
            name: newModel.name,
            params: newModel.params,
            meta: newModel.meta,
            access_control: newModel.accessControl,
            is_active: newModel.isActive,
            updated_at: newModel.updatedAt,
            created_at: newModel.createdAt,
        };

        res.status(200).json(response);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        return res.status(500).json({ detail: `Failed to create model: ${error}` });
    }
});

/**
 * POST /api/v1/models/model/toggle
 * Access Control: Requires write access (owner or write permission)
 *
 * Toggle a custom model's active status (enable/disable).
 * Cannot toggle base models - returns 400.
 *
 * @query {Types.ModelIdQuery} - model ID to toggle
 * @returns {Types.ModelResponse | null} - updated model or null on failure
 */
router.post('/model/toggle', requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.ModelIdQuery>,
    res: Response<Types.ModelResponse | null | Types.ErrorResponse>
) => {
    const query = Types.ModelIdQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: query.error.issues });
    }

    const { id: modelId } = query.data;
    const userId = req.user!.id;

    try {
        // Check if this is a base model (cannot toggle base models)
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();
        if (baseModelNames.includes(modelId)) throw BadRequestError('Cannot toggle base models');

        // Get model from database
        const model = await Models.getModelById(modelId, db);
        if (!model) throw NotFoundError('Model not found');

        // Check write access
        const canWrite =
            model.userId === userId ||
            Models.hasAccess(userId, 'write', model.accessControl);

        if (!canWrite) throw UnauthorizedError('write access required');

        // Toggle active status
        const updated = await Models.toggleModelById(modelId, db);
        if (!updated) throw new Error('failed to toggle model');

        // Convert to response format
        const response: Types.ModelResponse = {
            id: updated.id,
            user_id: updated.userId,
            base_model_id: updated.baseModelId,
            name: updated.name,
            params: updated.params,
            meta: updated.meta,
            access_control: updated.accessControl,
            is_active: updated.isActive,
            updated_at: updated.updatedAt,
            created_at: updated.createdAt,
        };

        res.status(200).json(response);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        return res.status(500).json({ detail: `Failed to toggle model: ${error}` });
    }
});

/**
 * POST /api/v1/models/model/update
 * Access Control: Requires write access (owner or write permission)
 *
 * Update a custom model's configuration.
 * Cannot update base models - returns 400.
 *
 * @param {Types.ModelForm} - Updated model data
 * @returns {Types.ModelModel} - Updated model or null on failure
 */
router.post('/model/update', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ModelForm>,
    res: Response<Types.ModelModel | null | Types.ErrorResponse>
) => {
    const body = Types.ModelFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    const formData = body.data;
    const userId = req.user!.id;

    try {
        // Check if this is a base model (cannot update base models)
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();
        if (baseModelNames.includes(formData.id)) throw BadRequestError('Cannot update base models');

        // Get model from database
        const model = await Models.getModelById(formData.id, db);
        if (!model) throw NotFoundError('Model not found');

        // Check write access
        const canWrite =
            model.userId === userId ||
            Models.hasAccess(userId, 'write', model.accessControl);

        if (!canWrite) throw UnauthorizedError('write access required');

        // If base_model_id is being changed, validate it exists
        if (formData.base_model_id && formData.base_model_id !== model.baseModelId) {
            if (!baseModelNames.includes(formData.base_model_id)) {
                return res.status(400).json({ detail: `Base model '${formData.base_model_id}' not found` });
            }
        }

        // Update model in database
        const updated = await Models.updateModelById(formData.id, formData, db);
        if (!updated) throw new Error('failed to update model');

        // Convert to response format
        const response: Types.ModelModel = {
            id: updated.id,
            user_id: updated.userId,
            base_model_id: updated.baseModelId,
            name: updated.name,
            params: updated.params,
            meta: updated.meta,
            access_control: updated.accessControl,
            is_active: updated.isActive,
            updated_at: updated.updatedAt,
            created_at: updated.createdAt,
        };

        res.status(200).json(response);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        return res.status(500).json({ detail: `Failed to update model: ${error}` });
    }
});

/**
 * POST /api/v1/models/model/delete
 * Access Control: Requires write access (owner or write permission)
 *
 * Delete a custom model from the database.
 * Cannot delete base models - returns 400.
 *
 * @param {Types.ModelIdForm} - Model ID to delete
 * @returns {boolean} - true if deleted, false otherwise
 */
router.post('/model/delete', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ModelIdForm>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const body = Types.ModelIdFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    const { id: modelId } = body.data;
    const userId = req.user!.id;

    try {
        // Check if this is a base model (cannot delete base models)
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();
        if (baseModelNames.includes(modelId)) throw BadRequestError('Cannot delete base models');

        // Get model from database
        const model = await Models.getModelById(modelId, db);
        if (!model) throw NotFoundError('Model not found');

        // Check write access
        const canWrite =
            model.userId === userId ||
            Models.hasAccess(userId, 'write', model.accessControl);

        if (!canWrite) throw UnauthorizedError('write access required');

        // Delete model from database
        const deleted = await Models.deleteModelById(modelId, db);
        res.status(200).json(deleted);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        return res.status(500).json({ detail: `Failed to delete model: ${error}` });
    }
});

/* -------------------- ADMIN ENDPOINTS -------------------- */

/**
 * GET /api/v1/models/base
 * Access Control: Admin only
 *
 * Get all base models from LlamaManager (backend-configured models from config.json).
 * Does NOT query database - returns models configured in backend.
 *
 * @returns {Types.ModelResponse[]} - Array of base models
 */
router.get('/base', requireAdmin, async (
    req: Types.TypedRequest,
    res: Response<Types.ModelResponse[] | Types.ErrorResponse>
) => {
    try {
        // Get base models from LlamaManager
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();

        const adminUserId = (await Users.getFirstUser(db))?.id;
        if (!adminUserId) throw new Error(`unable to fetch first user id from db`);

        const baseModels: Types.ModelResponse[] = baseModelNames.map(name => ({
            id: name,
            user_id: adminUserId,
            base_model_id: null,
            name: name,
            params: {},
            meta: {
                profile_image_url: '/static/favicon.png',
                description: null,
                capabilities: null,
            },
            access_control: null,
            is_active: true,
            updated_at: 0,
            created_at: 0,
        }));

        res.status(200).json(baseModels);
    } catch (err) {
        return res.status(500).json({ detail: `Failed to get base models: ${err}` });
    }
});

/**
 * DELETE /api/v1/models/delete/all
 * Access Control: Admin only
 *
 * Delete all custom models from the database.
 * Base models (from config.json) are NOT affected.
 * WARNING: Destructive operation - no undo.
 *
 * @returns {boolean} - true on success
 */
router.delete('/delete/all', requireAdmin, async (
    req: Types.TypedRequest,
    res: Response<boolean | Types.ErrorResponse>
) => {
    try {
        // Delete all custom models from database
        const deleted = await Models.deleteAllModels(db);

        res.status(200).json(deleted);
    } catch (err) {
        return res.status(500).json({ detail: `Failed to delete all models: ${err}` });
    }
});

/**
 * POST /api/v1/models/sync
 * Access Control: Admin only
 *
 * Sync custom models in database with incoming list.
 * Updates existing models, inserts new models, deletes removed models.
 * Base models (from config.json) are NOT affected.
 *
 * @param {Types.SyncModelsForm} - Array of models to sync
 * @returns {Types.ModelModel[]} - Synced models list
 */
router.post('/sync', requireAdmin, async (
    req: Types.TypedRequest<{}, Types.SyncModelsForm>,
    res: Response<Types.ModelModel[] | Types.ErrorResponse>
) => {
    const body = Types.SyncModelsFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    const { models: incomingModels } = body.data;
    const userId = req.user!.id;

    try {
        // Validate all models have base_model_id set
        for (const model of incomingModels) {
            if (!model.base_model_id) {
                throw BadRequestError(`model ${model.id} is missing a base model id`);
            }
        }

        // Validate all base_model_id references exist in LlamaManager
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();

        for (const model of incomingModels) {
            if (model.base_model_id && !baseModelNames.includes(model.base_model_id)) {
                throw NotFoundError(`model ${model.id} references nonexistent base model ${model.base_model_id}`);
            }
        }

        // Convert from API format to database format
        const modelsForSync: Model[] = incomingModels.map(m => ({
            id: m.id,
            userId: m.user_id,
            baseModelId: m.base_model_id,
            name: m.name,
            params: m.params,
            meta: m.meta,
            accessControl: m.access_control,
            isActive: m.is_active,
            createdAt: m.created_at,
            updatedAt: m.updated_at,
        }));

        // Sync models
        const synced = await Models.syncModels(userId, modelsForSync, db);

        // Convert back to response format
        const response: Types.ModelModel[] = synced.map(model => ({
            id: model.id,
            user_id: model.userId,
            base_model_id: model.baseModelId,
            name: model.name,
            params: model.params,
            meta: model.meta,
            access_control: model.accessControl,
            is_active: model.isActive,
            updated_at: model.updatedAt,
            created_at: model.createdAt,
        }));

        res.status(200).json(response);
    } catch (err) {
        return res.status(500).json({ detail: `Failed to sync models: ${err}` });
    }
});

export default router;
