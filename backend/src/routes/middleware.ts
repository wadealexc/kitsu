import type { Request, Response, NextFunction } from 'express';

/// <reference path="./express.d.ts" />

import type { TypedRequest } from './types.js';
import * as Types from './types.js';
import * as JWT from './jwt.js';
import * as Users from '../db/operations/users.js';
import { db } from '../db/client.js';

/* -------------------- AUTHENTICATION MIDDLEWARE -------------------- */

/**
 * Middleware that requires a valid Bearer token in the Authorization header OR cookie.
 * Verifies JWT signature, checks expiration, and looks up user in database.
 *
 * This dual approach is necessary because:
 * - JavaScript fetch/XHR can send Authorization headers
 * - Browser <img>, <script>, <link> tags cannot send custom headers
 * - Cookies are automatically sent by browsers for all requests
 *
 * On success: Attaches user to req.user and updates lastActiveAt
 * On failure: Clears token cookie and returns 401
 *
 * @returns 401 if authentication fails
 */
export const requireAuth = async <P = {}, B = any, Q = any>(
    req: TypedRequest<P, B, Q>,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const token = JWT.extractToken(req as Request);
        if (!token) {
            res.status(401).json({ detail: 'Not authenticated' });
            return;
        }

        // Verify token signature and expiration (throws if invalid)
        const decoded = JWT.verifyToken(token);

        // Fetch user from database
        const user = await Users.getUserById(decoded.id, db);
        if (!user) {
            JWT.clearTokenCookie(res);
            res.status(401).json({ detail: 'User not found' });
            return;
        }

        // Attach user to request
        req.user = user;

        // Update last active (async, don't wait)
        Users.updateLastActive(user.id, db).catch((err) => {
            console.error('Failed to update last active:', err);
        });

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        JWT.clearTokenCookie(res);
        res.status(401).json({ detail: 'Authentication failed' });
    }
};

/**
 * Middleware that requires a valid Bearer token (header or cookie) AND admin role.
 * Performs authentication (via requireAuth) then checks for admin role.
 *
 * @returns 401 if not authenticated
 * @returns 403 if user is not an admin
 */
export const requireAdmin = async <P = {}, B = any, Q = any>(
    req: TypedRequest<P, B, Q>,
    res: Response,
    next: NextFunction
): Promise<void> => {
    // First authenticate the user
    await requireAuth(req, res, () => {
        if (!req.user) {
            res.status(401).json({ detail: 'Not authenticated' });
            return;
        }

        if (req.user.role !== 'admin') {
            res.status(403).json({ detail: 'Admin access required' });
            return;
        }

        next();
    });
};

/**
 * Middleware that requires a verified user (admin or user role, not pending).
 * Should be chained after requireAuth middleware.
 *
 * @returns 401 if not authenticated
 * @returns 403 if user is pending verification
 */
export const requireVerified = async <P = {}, B = any, Q = any>(
    req: TypedRequest<P, B, Q>,
    res: Response,
    next: NextFunction
): Promise<void> => {
    await requireAuth(req, res, () => {
        if (!req.user) {
            res.status(401).json({ detail: 'Not authenticated' });
            return;
        }

        if (req.user.role === 'pending') {
            res.status(403).json({ detail: 'Account pending verification' });
            return;
        }

        next();
    });
};

/* -------------------- PARAMETER VALIDATION MIDDLEWARE -------------------- */

/**
 * UUID validation middleware for :user_id parameter.
 * If user_id doesn't match UUID v4 format, skip to next route with next('route').
 * This prevents :user_id from matching non-UUID routes like /permissions or /search.
 *
 * Generic constraint allows this to work with any params type that includes user_id.
 *
 * @returns next('route') if validation fails (skips to next route)
 */
export const validateUserId = <P extends { user_id: Types.UserId }>(
    req: TypedRequest<P>,
    res: Response,
    next: NextFunction
): void => {
    const parsed = Types.UserIdSchema.safeParse(req.params.user_id);

    if (!parsed.success) {
        return next('route'); // Skip to next route (e.g., /permissions, /search)
    }

    next();
};

/**
 * Chat ID validation middleware for :id parameter.
 * Validates chat ID format (UUID v4 OR "local:<socket_id>" for temporary chats).
 * If validation fails, skip to next route with next('route').
 * This prevents :id from matching non-chat-ID routes.
 *
 * Generic constraint allows this to work with any params type that includes id.
 * Works with both ChatIdParams and MessageIdParams.
 *
 * @returns next('route') if validation fails (skips to next route)
 */
export const validateChatId = <P extends { id: Types.ChatId }>(
    req: TypedRequest<P>,
    res: Response,
    next: NextFunction
): void => {
    const parsed = Types.ChatIdSchema.safeParse(req.params.id);

    if (!parsed.success) {
        return next('route'); // Skip to next route
    }

    next();
};

/**
 * Share ID validation middleware for :share_id parameter.
 * Validates share ID format (UUID v4).
 * If validation fails, skip to next route with next('route').
 *
 * Generic constraint allows this to work with any params type that includes share_id.
 *
 * @returns next('route') if validation fails (skips to next route)
 */
export const validateShareId = <P extends { share_id: Types.ShareId }>(
    req: TypedRequest<P>,
    res: Response,
    next: NextFunction
): void => {
    const parsed = Types.ShareIdSchema.safeParse(req.params.share_id);

    if (!parsed.success) {
        return next('route'); // Skip to next route
    }

    next();
};

/**
 * Folder ID validation middleware for :folder_id parameter.
 * Validates folder ID format (UUID v4).
 * If validation fails, skip to next route with next('route').
 *
 * Generic constraint allows this to work with any params type that includes folder_id.
 *
 * @returns next('route') if validation fails (skips to next route)
 */
export const validateFolderId = <P extends { folder_id: Types.FolderId }>(
    req: TypedRequest<P>,
    res: Response,
    next: NextFunction
): void => {
    const parsed = Types.FolderIdSchema.safeParse(req.params.folder_id);

    if (!parsed.success) {
        return next('route'); // Skip to next route
    }

    next();
};

/**
 * File ID validation middleware for :file_id parameter.
 * Validates file ID format (UUID v4).
 * If validation fails, skip to next route with next('route').
 *
 * Generic constraint allows this to work with any params type that includes file_id.
 *
 * @returns next('route') if validation fails (skips to next route)
 */
export const validateFileId = <P extends { file_id: Types.FileId }>(
    req: TypedRequest<P>,
    res: Response,
    next: NextFunction
): void => {
    const parsed = Types.FileIdSchema.safeParse(req.params.file_id);

    if (!parsed.success) {
        return next('route'); // Skip to next route
    }

    next();
};

/**
 * Combined Chat ID and Message ID validation middleware for routes like :id/messages/:message_id.
 * Validates both chat ID format (UUID v4 OR "local:<socket_id>") and message ID format (UUID v4).
 * If either validation fails, skip to next route with next('route').
 *
 * Generic constraint allows this to work with MessageIdParams type.
 *
 * @returns next('route') if validation fails (skips to next route)
 */
export const validateChatAndMessageId = <P extends { id: Types.ChatId; message_id: Types.MessageId }>(
    req: TypedRequest<P>,
    res: Response,
    next: NextFunction
): void => {
    const chatIdParsed = Types.ChatIdSchema.safeParse(req.params.id);
    const messageIdParsed = Types.MessageIdSchema.safeParse(req.params.message_id);

    if (!chatIdParsed.success || !messageIdParsed.success) {
        return next('route'); // Skip to next route
    }

    next();
};
