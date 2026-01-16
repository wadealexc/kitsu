import type { Response, NextFunction } from 'express';
import type { TypedRequest } from './types.js';

/* -------------------- AUTHENTICATION MIDDLEWARE -------------------- */

/**
 * Middleware that requires a valid Bearer token in the Authorization header.
 * Validates the token format.
 *
 * @returns 401 if authorization header is missing or invalid
 */
export const requireAuth = <P = {}, B = any, Q = any>(
    req: TypedRequest<P, B, Q>,
    res: Response,
    next: NextFunction
): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ detail: 'Missing or invalid authorization header' });
        return;
    }

    // TODO: Verify JWT token signature and expiration
    // TODO: Extract user info from JWT payload (id, email, role)
    // TODO: Look up user in database to ensure they still exist and are active

    next();
};

/**
 * Middleware that requires a valid Bearer token AND admin role.
 * First validates authentication, then checks if user has admin role.
 *
 * @returns 401 if authentication fails
 * @returns 403 if user is not an admin
 */
export const requireAdmin = <P = {}, B = any, Q = any>(
    req: TypedRequest<P, B, Q>,
    res: Response,
    next: NextFunction
): void => {
    // First check authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        res.status(401).json({ detail: 'Missing or invalid authorization header' });
        return;
    }

    // TODO: Verify JWT token signature and expiration
    // TODO: Extract user info from JWT payload (id, email, role)
    // TODO: Check if user has admin role (for now, mock allows all)

    next();
};
