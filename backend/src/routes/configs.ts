/**
 * Configuration Routes
 *
 * Handles system-wide configuration management (import/export).
 */

import { Router, type Request, type Response } from 'express';
import * as Types from './types/index.js';
import { requireAdmin } from './middleware.js';

const router = Router();

// Backend config endpoint (temporary inline implementation)
router.get('/', (
    _req: Request,
    res: Response<any | Types.ErrorResponse>
) => {
    res.json({
        name: 'kitsu',
        default_locale: 'en-US',
        features: {
            auth: true,
            enableSignup: true,
        },
    });
});

/* -------------------- ADMIN ENDPOINTS -------------------- */

/**
 * GET /api/v1/configs/export
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Export the entire system configuration as a JSON object.
 * Used for backup or migration to another instance.
 *
 * @returns {object} - system configuration object
 */
router.get('/export', requireAdmin, (
    req: Request,
    res: Response<Record<string, any> | Types.ErrorResponse>
) => {
    res.status(200).json({
        version: 1,
        ui: {
            theme: 'dark',
            language: 'en',
        },
        features: {
            enableSignup: true,
            enableApiKeys: false,
        },
    });
});

/**
 * POST /api/v1/configs/import
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Import a system configuration JSON object. Replaces the current configuration.
 * Used for restoring from backup or migrating from another instance.
 *
 * @param {Types.ImportConfigForm} - config object to import
 * @returns {object} - the imported configuration
 */
router.post('/import', requireAdmin, (
    req: Types.TypedRequest<{}, Types.ImportConfigForm>,
    res: Response<Record<string, any> | Types.ErrorResponse>
) => {
    const body = Types.ImportConfigFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    // TODO: Update system config in database
    // For now, just echo back the imported config
    res.status(200).json(body.data.config);
});

/* -------------------- EXPORT -------------------- */

export default router;
