/**
 * PWA API Router
 *
 * Provides Progressive Web App manifest for application installation.
 */

import { Router, type Response } from 'express';
import * as Types from './types.js';
import * as MockData from './mock-data.js';

const router = Router();

/* -------------------- PUBLIC ENDPOINTS -------------------- */

/**
 * GET /manifest.json
 *
 * Get the PWA manifest for application installation.
 * Returns manifest configuration for making the app installable on mobile and desktop.
 *
 * @returns PWAManifest - Standard PWA manifest JSON
 */
router.get('/', (
    req: Types.TypedRequest,
    res: Response<Types.PWAManifest | Types.ErrorResponse>
) => {
    res.json(MockData.mockPWAManifest);
});

export default router;
