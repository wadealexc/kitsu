import { Router, type Response, type NextFunction } from 'express';

import type { LlamaManager } from '../llama/llamaManager.js';
import * as Types from './types.js';
import { requireAuth, requireAdmin } from './middleware.js';
import { db } from '../db/client.js';
import * as Models from '../db/operations/models.js';
import { type Model } from '../db/operations/models.js';
import * as Users from '../db/operations/users.js';
import { currentUnixTimestamp } from '../db/utils.js';
import { HttpError, NotFoundError, ForbiddenError, BadRequestError, UnauthorizedError } from './errors.js';

const router = Router();

// TODO - bad distinction between "base model" and "custom model" at the moment.
// Revisit.

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/v1/models/ - Fetch models the user has access to.
 * Access Control: Any authenticated user. Admins also fetch base models.
 * 
 * @note this method only returns custom models in the DB that have baseModelIds matching
 * models currently served by LlamaManager. i.e. if you remove a base model from
 * LlamaManager, any custom models in the DB using it as the base will not be
 * returned here.
 * 
 * @note is caller is admin, this method also returns base models. the intent is
 * to make base models available to the server admin through the UI, at which point
 * the server admin can test the base models and make them available to users as
 * a custom model.
 *
 * TODO - implement memory cache and use query.refresh to fetch from DB
 * 
 * @query {Types.ModelsQuery}
 * @returns {{Types.ModelResponse[]}}
 */
router.get('/', requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.ModelsQuery>,
    res: Response<Types.ModelResponse[] | Types.ErrorResponse>,
    next: NextFunction
) => {
    const query = Types.ModelsQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: query.error.issues });
    }

    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';

    try {
        // Get base models from LlamaManager
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();

        console.log(`base model names: ${JSON.stringify(baseModelNames, null, 2)}`)

        // Fetch custom models:
        // - where the user has read access
        // - that have available base models
        //
        // (TODO - maybe keep these in here, but toggle isActive to false?)
        const allCustomModels = await Models.getCustomModels(db);
        const availableCustomModels = allCustomModels
            .filter(model => baseModelNames.some(base => base === model.baseModelId))
            .filter(model => Models.hasAccess(model, userId, 'read'));

        const availableModels: Types.ModelResponse[] = availableCustomModels.map(toModelResponse);

        // Add base models for admin
        // TODO: temporarily allowing all models
        if (isAdmin || !isAdmin) {
            const baseModels: Types.ModelResponse[] = baseModelNames.map(name => (toModelResponse({
                id: name,
                userId: userId,
                baseModelId: null,
                name: name,
                params: {},
                meta: {
                    profile_image_url: '/static/favicon.png',
                },
                accessControl: null,
                isActive: true,
                updatedAt: 0,
                createdAt: 0,
            })));

            availableModels.push(...baseModels);
        }

        res.status(200).json(availableModels);
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
            const canWrite = Models.hasAccess(model, userId, 'write');
            return toModelAccessResponse(model, canWrite);
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
 * Get a custom model by ID
 *
 * @query {Types.ModelIdQuery} - model ID to retrieve
 * @returns {Types.ModelAccessResponse} - model with access info
 */
router.get('/model', requireAuth, async (
    req: Types.TypedRequest<{}, any, Types.ModelIdQuery>,
    res: Response<Types.ModelAccessResponse | Types.ErrorResponse>
) => {
    const query = Types.ModelIdQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: query.error.issues });
    }

    const { id: modelId } = query.data;
    const userId = req.user!.id;

    try {
        // Check database for custom model
        const model = await Models.getModelById(modelId, db);
        if (!model) throw NotFoundError('Model not found');

        // Check permissions
        const canRead = Models.hasAccess(model, userId, 'read');
        const canWrite = Models.hasAccess(model, userId, 'write');
        if (!canRead) throw UnauthorizedError('User does not have access to model');

        // Get model owner info
        const owner = await Users.getUserById(model.userId, db);
        if (!owner) console.error(`Owner not found for custom model ${model.id}`);

        res.status(200).json(toModelAccessResponse({
            ...model,
            user: owner ? {
                ...owner
            } : null,
        }, canWrite));
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
 * @returns {Types.ModelModel} - Created model
 */
router.post('/create', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ModelForm>,
    res: Response<Types.ModelModel | Types.ErrorResponse>
) => {
    const body = Types.ModelFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    const formData = body.data;
    const userId = req.user!.id;

    try {
        // Validate base model is available in LlamaManager
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();
        if (!baseModelNames.includes(formData.base_model_id)) throw BadRequestError('base model not found');

        // Check if model ID already exists in database
        const existing = await Models.getModelById(formData.id, db);
        if (existing) throw BadRequestError('model id already taken');

        // Create model in database
        const newModel = await Models.insertNewModel({
            id: formData.id,
            userId,
            baseModelId: formData.base_model_id,
            name: formData.name,
            params: formData.params,
            meta: formData.meta,
            accessControl: formData.access_control,
            isActive: formData.is_active,
        }, db);

        res.status(200).json(toModelModelResponse(newModel));
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
        // Get model from database
        const model = await Models.getModelById(modelId, db);
        if (!model) throw NotFoundError('Model not found');

        // Check write access
        const canWrite = Models.hasAccess(model, userId, 'write');
        if (!canWrite) throw UnauthorizedError('write access required');

        // Toggle active status
        const updated = await Models.toggleModelById(modelId, db);
        res.status(200).json(toModelResponse(updated));
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
 * Update a custom model's configuration. Cannot update base models.
 *
 * @param {Types.ModelForm} - Updated model data
 * @returns {Types.ModelModel} - Updated model
 */
router.post('/model/update', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ModelForm>,
    res: Response<Types.ModelModel | Types.ErrorResponse>
) => {
    const body = Types.ModelFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    const formData = body.data;
    const userId = req.user!.id;

    try {
        // Get model from database
        const model = await Models.getModelById(formData.id, db);
        if (!model) throw NotFoundError('Model not found');

        // Check write access
        const canWrite = Models.hasAccess(model, userId, 'write');
        if (!canWrite) throw UnauthorizedError('write access required');

        // If baseModelId is being changed, validate it's available in llamaManager
        if (formData.base_model_id !== model.baseModelId) {
            const llama = req.app.locals.llama as LlamaManager;
            const baseModelNames = llama.getAllModelNames();

            if (!baseModelNames.includes(formData.base_model_id))
                throw BadRequestError(`base model '${formData.base_model_id}' not found`);
        }

        // TODO: yikes!
        const updateModel: Models.UpdateModel = { ...formData };
        if (formData.access_control !== undefined) 
            updateModel.accessControl = formData.access_control;
        if (formData.base_model_id !== undefined) 
            updateModel.baseModelId = formData.base_model_id;
        if (formData.is_active !== undefined) 
            updateModel.isActive = formData.is_active;

        // Update model in database
        const updated = await Models.updateModelById(formData.id, updateModel, db);
        res.status(200).json(toModelModelResponse(updated));
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
        // Get model from database
        const model = await Models.getModelById(modelId, db);
        if (!model) throw NotFoundError('Model not found');

        // Check write access
        const canWrite = Models.hasAccess(model, userId, 'write');
        if (!canWrite) throw UnauthorizedError('write access required');

        // Delete model from database
        await Models.deleteModelById(modelId, db);
        res.status(200).json(true);
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
 * @note Does NOT query database - returns models configured in backend. The idea is that
 * the admin 'runs' the server, and will occasionally add new GGUFs to the config,
 * but these models should not be made generally available until the admin has time
 * to test/parameterize them. At this point, the admin can create a custom model for
 * non-admin users
 *
 * @returns {Types.ModelResponse[]} - Array of base models
 */
router.get('/base', requireAdmin, async (
    req: Types.TypedRequest,
    res: Response<Types.ModelResponse[] | Types.ErrorResponse>
) => {
    const userId = req.user!.id;

    try {
        // Get base models from LlamaManager
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();

        const baseModels: Types.ModelResponse[] = baseModelNames.map(name => (toModelResponse({
            id: name,
            userId: userId,
            baseModelId: null,
            name: name,
            params: {},
            meta: {
                profile_image_url: '/static/favicon.png',
            },
            accessControl: null,
            isActive: true,
            updatedAt: 0,
            createdAt: 0,
        })));

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
        await Models.deleteAllModels(db);
        res.status(200).json(true);
    } catch (err) {
        return res.status(500).json({ detail: `Failed to delete all models: ${err}` });
    }
});

function toModelResponse(model: Model): Types.ModelResponse {
    return {
        id: model.id,
        user_id: model.userId,
        base_model_id: model.baseModelId,
        name: model.name,
        params: model.params,
        meta: model.meta,
        access_control: model.accessControl || undefined,
        is_active: model.isActive,
        updated_at: model.updatedAt,
        created_at: model.createdAt,
    };
}

function toModelModelResponse(model: Model): Types.ModelModel {
    return {
        id: model.id,
        user_id: model.userId,
        base_model_id: model.baseModelId,
        name: model.name,
        params: model.params,
        meta: model.meta,
        access_control: model.accessControl || undefined,
        is_active: model.isActive,
        updated_at: model.updatedAt,
        created_at: model.createdAt,
    }
}

function toModelAccessResponse(
    modelUser: Models.ModelUserResponse,
    canWrite: boolean
): Types.ModelAccessResponse {
    return {
        id: modelUser.id,
        user_id: modelUser.userId,
        base_model_id: modelUser.baseModelId,
        name: modelUser.name,
        params: modelUser.params,
        meta: modelUser.meta,
        access_control: modelUser.accessControl || undefined,
        is_active: modelUser.isActive,
        updated_at: modelUser.updatedAt,
        created_at: modelUser.createdAt,
        user: modelUser.user ? {
            id: modelUser.user.id,
            username: modelUser.user.username,
            role: modelUser.user.role,
            profile_image_url: modelUser.user.profileImageUrl,
        } : null,
        write_access: canWrite,
    }
}

export default router;
