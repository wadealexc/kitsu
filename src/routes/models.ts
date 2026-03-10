import { Router, type Response, type NextFunction } from 'express';

import type { LlamaManager } from '../llama/llamaManager.js';
import * as Types from './types.js';
import { requireAuth, requireAdmin } from './middleware.js';
import { db } from '../db/client.js';
import * as Models from '../db/operations/models.js';
import { type Model } from '../db/operations/models.js';
import * as Users from '../db/operations/users.js';
import { HttpError, NotFoundError, BadRequestError, UnauthorizedError } from './errors.js';

const router = Router();

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/v1/models/ - Fetch models the user has access to.
 * Access Control: Any authenticated user.
 * 
 * @note this method only returns custom models in the DB that have baseModelIds matching
 * models currently served by LlamaManager. i.e. if you remove a base model from
 * LlamaManager, any custom models in the DB using it as the base will not be
 * returned here.
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

    try {
        // Get base models from LlamaManager to validate availability
        const llama = req.app.locals.llama as LlamaManager;
        const baseModelNames = llama.getAllModelNames();

        // Fetch custom models accessible to this user, filtered to those with available base models
        const allCustomModels = await Models.getCustomModels(db);
        const availableModels: Types.ModelResponse[] = allCustomModels
            .filter(model => baseModelNames.some(base => base === model.baseModelId))
            .filter(model => Models.hasAccess(model, userId, 'read'))
            .map(model => toModelResponse(model, llama.getModelInfo(model.baseModelId)?.contextLength));

        res.status(200).json(availableModels);
    } catch (err) {
        return next(new Error(`Failed to list models: ${err}`));
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
 * @returns {Types.ModelResponse} - Created model
 */
router.post('/create', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ModelForm>,
    res: Response<Types.ModelResponse | Types.ErrorResponse>
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
            isPublic: formData.isPublic,
            isActive: formData.is_active,
        }, db);

        res.status(200).json(toModelResponse(newModel));
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
 * @returns {Types.ModelResponse} - Updated model
 */
router.post('/model/update', requireAuth, async (
    req: Types.TypedRequest<{}, Types.ModelForm>,
    res: Response<Types.ModelResponse | Types.ErrorResponse>
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

        // Update model in database
        const updated = await Models.updateModelById(formData.id, {
            baseModelId: formData.base_model_id,
            name: formData.name,
            params: formData.params,
            meta: formData.meta,
            isPublic: formData.isPublic,
            isActive: formData.is_active,
        }, db);
        res.status(200).json(toModelResponse(updated));
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

        const baseModels: Types.ModelResponse[] = baseModelNames.map(name => {
            const modelInfo = llama.getModelInfo(name);
            return toModelResponse({
                id: name,
                userId: userId,
                baseModelId: name,
                name: name,
                params: modelInfo?.params ?? {},
                meta: {
                    profile_image_url: '/static/favicon.png',
                },
                isPublic: false,
                isActive: true,
                updatedAt: 0,
                createdAt: 0,
            }, modelInfo?.contextLength);
        });

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

function toModelResponse(model: Model, contextLength?: number): Types.ModelResponse {
    return {
        id: model.id,
        user_id: model.userId,
        base_model_id: model.baseModelId,
        name: model.name,
        params: model.params,
        meta: model.meta,
        isPublic: model.isPublic,
        is_active: model.isActive,
        updated_at: model.updatedAt,
        created_at: model.createdAt,
        ...(contextLength !== undefined ? { context_length: contextLength } : {}),
    };
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
        isPublic: modelUser.isPublic,
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
    };
}

export default router;
