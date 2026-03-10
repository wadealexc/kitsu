/**
 * Configuration Routes
 *
 * Handles system-wide configuration management (import/export) and
 * admin announcement banners.
 */

import { Router, type Request, type Response } from 'express';
import * as Types from './types.js';
import { requireAuth, requireAdmin } from './middleware.js';

const router = Router();

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

/**
 * POST /api/v1/configs/banners
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Set the list of admin announcement banners. Replaces the current banner list.
 *
 * @param {Types.SetBannersForm} - banners array to set
 * @returns {Types.BannerModel[]} - the updated banner list
 */
router.post('/banners', requireAdmin, (
    req: Types.TypedRequest<{}, Types.SetBannersForm>,
    res: Response<Types.BannerModel[] | Types.ErrorResponse>
) => {
    const body = Types.SetBannersFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: body.error.issues });
    }

    // TODO: Update banners in database
    // For now, just echo back the submitted banners
    res.status(200).json(body.data.banners);
});

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/v1/configs/banners
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Get the list of admin announcement banners displayed to all users.
 *
 * @returns {Types.BannerModel[]} - array of banner objects
 */
router.get('/banners', requireAuth, (
    req: Request,
    res: Response<Types.BannerModel[] | Types.ErrorResponse>
) => {
    res.status(200).json([]);
});

/* -------------------- EXPORT -------------------- */

export default router;
