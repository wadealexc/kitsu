/**
 * Version API Router
 *
 * Provides version information and update checking.
 */

import { Router, type Response } from 'express';
import * as Types from './types.js';
import { requireAuth } from './middleware.js';

const router = Router();

/* -------------------- PUBLIC ENDPOINTS -------------------- */

/**
 * GET /api/version
 *
 * Get current application version and deployment ID.
 *
 * @returns VersionInfo - Current version and deployment identifier
 */
router.get('/', (
    req: Types.TypedRequest,
    res: Response<Types.VersionInfo | Types.ErrorResponse>
) => {
    res.json({
        version: '0.3.9',
        deploymentId: 'dev-local',
    });
});

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/version/updates
 *
 * Check for available updates by comparing current version with latest GitHub release.
 *
 * Access Control: Requires authentication (any verified user)
 *
 * @returns VersionUpdateInfo - Current and latest version comparison
 */
router.get('/updates', requireAuth, (
    req: Types.TypedRequest,
    res: Response<Types.VersionUpdateInfo | Types.ErrorResponse>
) => {
    // TODO: Implement GitHub API integration to fetch latest release
    // For now, return mock data showing no update available
    res.json({
        current: '0.3.9',
        latest: '0.3.9',
    });
});

export default router;
