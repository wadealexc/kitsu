/**
 * JWT Token Management
 *
 * Provides token generation, verification, extraction, and cookie management
 * for stateless authentication using HS256 algorithm.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import type { Request, Response, CookieOptions } from 'express';
import { type StringValue } from 'ms';

/* -------------------- TYPES -------------------- */

export type JWTPayload = {
    id: string;          // User ID
    exp?: number;        // Expiration timestamp (unix seconds)
    jti: string;         // JWT ID (UUID) for revocation tracking
    iat?: number;        // Issued at timestamp (auto-added by jwt library)
};

/* -------------------- CONFIGURATION -------------------- */

// Load secret key (use dev default if not set)
const DEV_ONLY_SECRET = 'dev-only-secret-key-NOT-FOR-PROD!';
const SESSION_SECRET = process.env.WEBUI_SECRET_KEY ?? DEV_ONLY_SECRET;

if (!process.env.WEBUI_SECRET_KEY) {
    console.warn('⚠️  WARNING: Using dev-only JWT secret! Set WEBUI_SECRET_KEY environment variable for production.');
} else if (SESSION_SECRET.length < 32) {
    console.warn('⚠️  WARNING: WEBUI_SECRET_KEY should be at least 32 characters for security');
}

/* -------------------- TOKEN OPERATIONS -------------------- */

/**
 * Generate a signed JWT token for a user
 *
 * @param userId - User ID to encode in token
 * @param expiresIn - Token lifetime (e.g., "4w", "7d", "24h", "-1" for permanent)
 * @returns Signed JWT token string
 */
export function createToken(
    userId: string,
    expiresIn: StringValue = '7d'
): string {
    const payload: JWTPayload = {
        id: userId,
        jti: randomUUID(), // For revocation tracking
    };

    const options: jwt.SignOptions = {
        algorithm: 'HS256',
    };

    // Handle special expiration values
    if (expiresIn === '-1') {
        // Permanent token (no expiration)
        // Security warning: should be avoided in production
        console.warn('WARNING: Creating permanent JWT token (no expiration)');
    } else {
        options.expiresIn = expiresIn;
    }

    return jwt.sign(payload, SESSION_SECRET, options);
}

/**
 * Verify and decode a JWT token
 *
 * @param token - JWT token string to verify
 * @returns Decoded payload if valid
 * @throws {jwt.TokenExpiredError} if token has expired
 * @throws {jwt.JsonWebTokenError} if token is invalid or malformed
 * @throws {jwt.NotBeforeError} if token is used before nbf claim
 */
export function verifyToken(token: string): JWTPayload {
    return jwt.verify(token, SESSION_SECRET, {
        algorithms: ['HS256'],
    }) as JWTPayload;
}

/**
 * Extract JWT token from request (Authorization header or cookie)
 *
 * Priority:
 * 1. Authorization header (Bearer scheme)
 * 2. Cookie
 *
 * @param req - Express request object
 * @returns Token string if found, null otherwise
 */
export function extractToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7); // Remove 'Bearer ' prefix
        return token || null; // Treat empty string as no token
    }

    const cookieToken = req.cookies?.token;
    if (cookieToken) {
        return cookieToken;
    }

    return null;
}

/* -------------------- COOKIE MANAGEMENT -------------------- */

/**
 * Set secure JWT token cookie
 *
 * @param res - Express response object
 * @param token - JWT token to store in cookie
 * @param expiresAt - Unix timestamp when token expires (optional)
 */
export function setTokenCookie(
    res: Response,
    token: string,
    expiresAt?: number
): void {
    const cookieOptions: CookieOptions = {
        httpOnly: true,                                          // Not accessible via JavaScript
        secure: process.env.NODE_ENV === 'production',           // HTTPS only in production
        sameSite: 'lax',                                         // CSRF protection
        path: '/',
    };

    if (expiresAt) {
        cookieOptions.expires = new Date(expiresAt * 1000);
    }

    res.cookie('token', token, cookieOptions);
}

/**
 * Clear JWT token cookie
 *
 * @param res - Express response object
 */
export function clearTokenCookie(res: Response): void {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    });
}

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Calculate expiration timestamp from token
 *
 * @param token - JWT token string
 * @returns Unix timestamp when token expires, or null if invalid/no expiration
 */
export function getTokenExpiration(token: string): number | null {
    try {
        const decoded = verifyToken(token);
        return decoded.exp ?? null;
    } catch {
        return null;
    }
}
