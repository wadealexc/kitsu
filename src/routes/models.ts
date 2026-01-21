/**
 * Models API Router
 *
 * Provides model registry management endpoints for AI models.
 */

import { Router, type Response, type NextFunction } from 'express';
import type { LlamaManager } from '../llama/llamaManager.js';
import * as Types from './types.js';
import * as MockData from './mock-data.js';
import { requireAuth, requireAdmin } from './middleware.js';

const router = Router();

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/v1/models/
 * Access Control: Any authenticated user
 *
 * Get all accessible models for current user (OpenAI-compatible format).
 *
 * @query {Types.ModelsQuery} - query parameters for optional refresh
 * @returns {{"data": Types.ModelResponse[]}} - OpenAI-compatible format with model array
 */
router.get('/', requireAuth, (
    req: Types.TypedRequest<{}, any, Types.ModelsQuery>,
    res: Response<{ data: Types.ModelResponse[] } | Types.ErrorResponse>,
    next: NextFunction
) => {
    const queryValidation = Types.ModelsQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: queryValidation.error.issues });
    }

    try {
        const llama = req.app.locals.llama as LlamaManager;
        const data = llama.getAllModelNames().map(name => ({
            id: name,
            user_id: MockData.MOCK_ADMIN_USER_ID,
            base_model_id: null,
            name: name,
            params: {},
            meta: {
                profile_image_url: "/static/favicon.png",
                description: null,
                capabilities: null,
                tags: [],
            },
            access_control: null,
            is_active: true,
            updated_at: 1764621939,
            created_at: 1764621939,
        }));

        res.status(200).json({ data });
    } catch (err) {
        return next(new Error(`failed to list models: ${err}`));
    }
});

/**
 * GET /api/v1/models/list
 * Access Control: Any authenticated user (filtered by access)
 *
 * Get paginated list of custom models with filtering and sorting.
 *
 * @query {Types.ModelListQuery} - query parameters for search, filtering, and pagination
 * @returns {Types.ModelAccessListResponse} - paginated model list with access info
 */
router.get('/list', requireAuth, (
    req: Types.TypedRequest<{}, any, Types.ModelListQuery>,
    res: Response<Types.ModelAccessListResponse | Types.ErrorResponse>
) => {
    const queryValidation = Types.ModelListQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: queryValidation.error.issues });
    }

    // TODO: Implement search, tag filtering, sorting, pagination
    // TODO: Filter by user access control
    // TODO: Return only custom models (base_model_id !== null)

    // Return mock custom models with access info
    const customModels = MockData.mockModels.filter(m => m.base_model_id !== null);
    const items: Types.ModelAccessResponse[] = customModels.map(model => ({
        ...model,
        user: {
            id: model.user_id,
            name: 'Mock User',
            email: 'user@example.com',
            role: 'user',
            profile_image_url: '/user.png',
        },
        write_access: true,
    }));

    res.status(200).json({ items, total: items.length });
});

/**
 * Get all unique model tags from accessible models.
 * Access Control: Any authenticated user
 *
 * @returns {string[]} - Array of tag strings
 */
router.get('/tags', requireAuth, (
    req: Types.TypedRequest,
    res: Response<string[] | Types.ErrorResponse>
) => {
    // TODO: Filter by user access control
    // Extract unique tags from all accessible models
    const allTags = new Set<string>();
    for (const model of MockData.mockModels) {
        if (model.meta.tags) {
            model.meta.tags.forEach(tag => allTags.add(tag));
        }
    }

    const tags = Array.from(allTags).sort();
    res.status(200).json(tags);
});

/**
 * GET /api/v1/models/model
 * Access Control: Any authenticated user (if they have read access)
 *
 * Get a specific model by ID with access validation.
 *
 * @query {Types.ModelIdQuery} - model ID to retrieve
 * @returns {Types.ModelAccessResponse | null} - model with access info, or null if not found/no access
 */
router.get('/model', requireAuth, (
    req: Types.TypedRequest<{}, any, Types.ModelIdQuery>,
    res: Response<Types.ModelAccessResponse | null | Types.ErrorResponse>
) => {
    const queryValidation = Types.ModelIdQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: queryValidation.error.issues });
    }

    const { id } = queryValidation.data;

    // Find model
    const model = MockData.mockModels.find(m => m.id === id);
    if (!model) {
        return res.status(200).json(null);
    }

    // TODO: Check user has read access

    // Convert to ModelAccessResponse
    const response: Types.ModelAccessResponse = {
        ...model,
        user: {
            id: model.user_id,
            name: 'Mock User',
            email: 'user@example.com',
            role: 'user',
            profile_image_url: '/user.png',
        },
        write_access: true,  // TODO: Check actual write access
    };

    res.status(200).json(response);
});

/**
 * Create a new custom model entry.
 * Access Control: Requires workspace.models permission
 *
 * @param {Types.ModelForm} - Model creation data
 * @returns {Types.ModelModel} - Created model or null on failure
 */
router.post('/create', requireAuth, (
    req: Types.TypedRequest<{}, Types.ModelForm>,
    res: Response<Types.ModelModel | null | Types.ErrorResponse>
) => {
    // TODO: Check workspace.models permission

    const parsed = Types.ModelFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    const formData = parsed.data;

    // Check if model ID already exists
    if (MockData.mockModels.find(m => m.id === formData.id)) {
        return res.status(401).json({ detail: 'MODEL_ID_TAKEN' });
    }

    // TODO: Create new model in database
    // For now, return mock model
    const now = Math.floor(Date.now() / 1000);
    const newModel: Types.ModelModel = {
        id: formData.id,
        user_id: MockData.MOCK_ADMIN_USER_ID,  // TODO: Get from JWT
        base_model_id: formData.base_model_id ?? null,
        name: formData.name,
        params: formData.params,
        meta: formData.meta,
        access_control: formData.access_control ?? null,
        is_active: formData.is_active ?? true,
        updated_at: now,
        created_at: now,
    };

    res.status(200).json(newModel);
});

/**
 * POST /api/v1/models/model/toggle
 * Access Control: Requires write access (owner, write permission, or admin)
 *
 * Toggle a model's active status.
 *
 * @query {Types.ModelIdQuery} - model ID to toggle
 * @returns {Types.ModelResponse | null} - updated model or null on failure
 */
router.post('/model/toggle', requireAuth, (
    req: Types.TypedRequest<{}, any, Types.ModelIdQuery>,
    res: Response<Types.ModelResponse | null | Types.ErrorResponse>
) => {
    const queryValidation = Types.ModelIdQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: queryValidation.error.issues });
    }

    const { id } = queryValidation.data;

    // Find model
    const model = MockData.mockModels.find(m => m.id === id);
    if (!model) {
        return res.status(200).json(null);
    }

    // TODO: Check user has write access
    // TODO: Return 401 if no write access
    // TODO: Toggle active status in database

    // Return model with toggled status
    res.status(200).json({
        ...model,
        is_active: !model.is_active,
        updated_at: Math.floor(Date.now() / 1000),
    });
});

/**
 * Update a model's configuration.
 * Access Control: Requires write access (owner, write permission, or admin)
 *
 * @param {Types.ModelForm} - Updated model data
 * @returns {Types.ModelModel} - Updated model or null on failure
 */
router.post('/model/update', requireAuth, (
    req: Types.TypedRequest<{}, Types.ModelForm>,
    res: Response<Types.ModelModel | null | Types.ErrorResponse>
) => {
    const parsed = Types.ModelFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    const formData = parsed.data;

    // Find model
    const model = MockData.mockModels.find(m => m.id === formData.id);
    if (!model) {
        return res.status(400).json({ detail: 'Model not found' });
    }

    // TODO: Check user has write access
    // TODO: Return 401 if no write access
    // TODO: Update model in database

    // Return updated model
    res.status(200).json({
        ...model,
        name: formData.name,
        base_model_id: formData.base_model_id ?? null,
        params: formData.params,
        meta: formData.meta,
        access_control: formData.access_control ?? null,
        is_active: formData.is_active ?? model.is_active,
        updated_at: Math.floor(Date.now() / 1000),
    });
});

/**
 * Delete a specific model.
 * Access Control: Requires write access (owner, write permission, or admin)
 *
 * @param {Types.ModelIdForm} - Model ID to delete
 * @returns {boolean} - true if deleted, false otherwise
 */
router.post('/model/delete', requireAuth, (
    req: Types.TypedRequest<{}, Types.ModelIdForm>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const parsed = Types.ModelIdFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    const { id } = parsed.data;

    // Find model index
    const modelIndex = MockData.mockModels.findIndex(m => m.id === id);
    if (modelIndex === -1) {
        return res.status(200).json(false);
    }

    // TODO: Check user has write access
    // TODO: Return 401 if no write access
    // TODO: Delete model from database

    // Return success
    res.status(200).json(true);
});

/* -------------------- ADMIN ENDPOINTS -------------------- */

/**
 * Get all base models (models with base_model_id = null).
 * Access Control: Admin only
 *
 * @returns {Types.ModelResponse[]} - Array of base models
 */
router.get('/base', requireAdmin, (
    req: Types.TypedRequest,
    res: Response<Types.ModelResponse[] | Types.ErrorResponse>
) => {
    const baseModels = MockData.mockModels.filter(m => m.base_model_id === null);

    res.status(200).json(baseModels);
});

/**
 * Delete all models from registry.
 * Access Control: Admin only
 *
 * @returns {boolean} - true on success
 */
router.delete('/delete/all', requireAdmin, (
    req: Types.TypedRequest,
    res: Response<boolean | Types.ErrorResponse>
) => {
    // TODO: Delete all models from database

    // For now, just return success
    res.status(200).json(true);
});

/**
 * Sync models list (update existing, insert new, delete removed).
 * Access Control: Admin only
 *
 * @param {Types.SyncModelsForm} - Array of models to sync
 * @returns {Types.ModelModel[]} - Synced models list
 */
router.post('/sync', requireAdmin, (
    req: Types.TypedRequest<{}, Types.SyncModelsForm>,
    res: Response<Types.ModelModel[] | Types.ErrorResponse>
) => {
    const parsed = Types.SyncModelsFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    const { models: incomingModels } = parsed.data;

    // TODO: Implement sync logic to update/insert/delete models in database
    // For now, just echo back the incoming models
    res.status(200).json(incomingModels);
});

export default router;
