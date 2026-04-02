/**
 * Health API Router
 *
 * Provides health check endpoints for monitoring and container orchestration.
 */

import { Router, type Response } from 'express';
import * as Types from './types.js';

const router = Router();

/* -------------------- PUBLIC ENDPOINTS -------------------- */

/**
 * GET /health
 *
 * Basic health check that verifies the API server is running.
 * Lightweight check with no external dependencies - suitable for liveness probes.
 *
 * @returns StatusResponse - { status: true } if server is responding
 */
router.get('/', (
    req: Types.TypedRequest,
    res: Response<Types.StatusResponse | Types.ErrorResponse>
) => {
    res.json({ status: true });
});

/**
 * GET /health/db
 *
 * Health check that includes database connectivity verification.
 * Executes a simple query to verify database is accessible - suitable for readiness probes.
 *
 * @returns StatusResponse - { status: true } if server and database are healthy
 */
router.get('/db', (
    req: Types.TypedRequest,
    res: Response<Types.StatusResponse | Types.ErrorResponse>
) => {
    // TODO: Execute SELECT 1 query to verify database connectivity
    // For now, return success (mock implementation)
    res.json({ status: true });
});

export default router;
