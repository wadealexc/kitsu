import { describe, test } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import type { Request, Response } from 'express';

import * as JWT from '../../src/routes/jwt.js';
import { currentUnixTimestamp } from '../../src/db/operations/users.js';

/* -------------------- TEST CONSTANTS -------------------- */

const TEST_USER_ID = 'test-user-123';
const DEV_SECRET = 'dev-only-secret-key-NOT-FOR-PROD!';
const SEVEN_DAYS_IN_SECONDS = 3600 * 24 * 7;

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Create a mock Express Request object
 */
function createMockRequest(options: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
} = {}): Request {
    return {
        headers: options.headers ?? {},
        cookies: options.cookies ?? {},
    } as Request;
}

/**
 * Create a mock Express Response object with cookie tracking
 */
function createMockResponse(): Response & {
    _cookies: Array<{ name: string; value: string; options: any }>;
    _clearedCookies: Array<{ name: string; options: any }>;
} {
    const cookies: Array<{ name: string; value: string; options: any }> = [];
    const clearedCookies: Array<{ name: string; options: any }> = [];

    return {
        _cookies: cookies,
        _clearedCookies: clearedCookies,
        cookie(name: string, value: string, options: any) {
            cookies.push({ name, value, options });
            return this;
        },
        clearCookie(name: string, options: any) {
            clearedCookies.push({ name, options });
            return this;
        },
    } as any;
}

/**
 * Decode a JWT without verification (for testing)
 */
function decodeToken(token: string): JWT.JWTPayload {
    return jwt.decode(token) as JWT.JWTPayload;
}

/**
 * Create an expired token for testing
 */
function createExpiredToken(userId: string): string {
    const payload: JWT.JWTPayload = {
        id: userId,
        jti: 'test-jti',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    };

    return jwt.sign(payload, DEV_SECRET, { algorithm: 'HS256' });
}

/**
 * Create a token with invalid signature
 */
function createInvalidSignatureToken(userId: string): string {
    const payload: JWT.JWTPayload = {
        id: userId,
        jti: 'test-jti',
    };

    return jwt.sign(payload, 'wrong-secret', { algorithm: 'HS256' });
}

/* -------------------- CREATE TOKEN TESTS -------------------- */

describe('createToken', () => {
    test('creates valid token with default expiration', () => {
        const now = currentUnixTimestamp();
        const token = JWT.createToken(TEST_USER_ID);

        assert.ok(token);
        assert.strictEqual(typeof token, 'string');

        const decoded = decodeToken(token);
        assert.strictEqual(decoded.id, TEST_USER_ID);
        assert.ok(decoded.jti); // UUID should be present
        assert.ok(decoded.exp! >= now + SEVEN_DAYS_IN_SECONDS); // Default 7d expiration
        assert.ok(decoded.iat! >= now); // Issued at timestamp
    });

    test('creates token with custom expiration', () => {
        const now = currentUnixTimestamp();
        const token = JWT.createToken(TEST_USER_ID, '1h');

        const decoded = decodeToken(token);
        assert.strictEqual(decoded.id, TEST_USER_ID);
        assert.ok(decoded.exp);

        // Verify expiration is approximately 1 hour from now
        const expectedExp = now + 3600;
        assert.ok(decoded.exp! >= expectedExp);
    });

    test('creates token with weeks expiration', () => {
        const token = JWT.createToken(TEST_USER_ID, '4w');

        const decoded = decodeToken(token);
        assert.ok(decoded.exp);

        // Verify expiration is approximately 4 weeks from now
        const now = Math.floor(Date.now() / 1000);
        const expectedExp = now + (4 * 7 * 24 * 3600); // 4 weeks in seconds
        assert.ok(Math.abs(decoded.exp! - expectedExp) < 5);
    });

    test('creates token with days expiration', () => {
        const token = JWT.createToken(TEST_USER_ID, '30d');

        const decoded = decodeToken(token);
        assert.ok(decoded.exp);

        // Verify expiration is approximately 30 days from now
        const now = Math.floor(Date.now() / 1000);
        const expectedExp = now + (30 * 24 * 3600); // 30 days in seconds
        assert.ok(Math.abs(decoded.exp! - expectedExp) < 5);
    });

    test('creates permanent token with -1 expiration', () => {
        const token = JWT.createToken(TEST_USER_ID, '-1');

        const decoded = decodeToken(token);
        assert.strictEqual(decoded.id, TEST_USER_ID);
        assert.ok(decoded.jti);
        assert.strictEqual(decoded.exp, undefined); // No expiration
    });

    test('creates tokens with unique JTI', () => {
        const token1 = JWT.createToken(TEST_USER_ID);
        const token2 = JWT.createToken(TEST_USER_ID);

        const decoded1 = decodeToken(token1);
        const decoded2 = decodeToken(token2);

        // JTIs should be different (UUIDs)
        assert.notStrictEqual(decoded1.jti, decoded2.jti);
    });

    test('creates different tokens for same user', () => {
        const token1 = JWT.createToken(TEST_USER_ID);
        const token2 = JWT.createToken(TEST_USER_ID);

        // Tokens should be different due to different JTI and iat
        assert.notStrictEqual(token1, token2);
    });

    test('encodes user ID correctly', () => {
        const userIds = ['user-1', 'admin-42', 'test@example.com'];

        for (const userId of userIds) {
            const token = JWT.createToken(userId);
            const decoded = decodeToken(token);
            assert.strictEqual(decoded.id, userId);
        }
    });
});

/* -------------------- VERIFY TOKEN TESTS -------------------- */

describe('verifyToken', () => {
    test('verifies valid token', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const payload = JWT.verifyToken(token);

        assert.ok(payload);
        assert.strictEqual(payload.id, TEST_USER_ID);
        assert.ok(payload.jti);
        assert.ok(payload.exp);
        assert.ok(payload.iat);
    });

    test('verifies token created with custom expiration', () => {
        const token = JWT.createToken(TEST_USER_ID, '1h');
        const payload = JWT.verifyToken(token);

        assert.strictEqual(payload.id, TEST_USER_ID);
    });

    test('verifies permanent token', () => {
        const token = JWT.createToken(TEST_USER_ID, '-1');
        const payload = JWT.verifyToken(token);

        assert.strictEqual(payload.id, TEST_USER_ID);
        assert.strictEqual(payload.exp, undefined);
    });

    test('rejects expired token', () => {
        const expiredToken = createExpiredToken(TEST_USER_ID);

        assert.throws(
            () => JWT.verifyToken(expiredToken),
            (error: any) => {
                assert.ok(error instanceof jwt.TokenExpiredError);
                assert.strictEqual(error.name, 'TokenExpiredError');
                return true;
            }
        );
    });

    test('rejects token with invalid signature', () => {
        const invalidToken = createInvalidSignatureToken(TEST_USER_ID);

        assert.throws(
            () => JWT.verifyToken(invalidToken),
            (error: any) => {
                assert.ok(error instanceof jwt.JsonWebTokenError);
                assert.match(error.message, /invalid signature/i);
                return true;
            }
        );
    });

    test('rejects malformed token', () => {
        const malformedTokens = [
            'not.a.token',
            'invalid-token',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
            '',
        ];

        for (const malformedToken of malformedTokens) {
            assert.throws(
                () => JWT.verifyToken(malformedToken),
                (error: any) => {
                    const isExpectedError =
                        error instanceof jwt.JsonWebTokenError ||
                        error instanceof SyntaxError;
                    assert.ok(isExpectedError, `Expected JsonWebTokenError or SyntaxError, got ${error.constructor.name}`);
                    return true;
                }
            );
        }
    });

    test('rejects token with missing parts', () => {
        // Token with only header and payload (no signature)
        const incompleteToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InRlc3QifQ';

        assert.throws(
            () => JWT.verifyToken(incompleteToken),
            (error: any) => {
                assert.ok(error instanceof jwt.JsonWebTokenError);
                return true;
            }
        );
    });

    test('rejects token with invalid JSON in payload', () => {
        // Create a token with invalid base64 payload
        const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
        const payload = 'not-valid-base64-json!!!';
        const invalidToken = `${header}.${payload}.fake-signature`;

        assert.throws(
            () => JWT.verifyToken(invalidToken),
            (error: any) => {
                assert.ok(error instanceof jwt.JsonWebTokenError);
                return true;
            }
        );
    });
});

/* -------------------- EXTRACT TOKEN TESTS -------------------- */

describe('extractToken', () => {
    test('extracts token from Authorization header', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const req = createMockRequest({
            headers: { authorization: `Bearer ${token}` },
        });

        const extracted = JWT.extractToken(req);
        assert.strictEqual(extracted, token);
    });

    test('extracts token from cookie', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const req = createMockRequest({
            cookies: { token },
        });

        const extracted = JWT.extractToken(req);
        assert.strictEqual(extracted, token);
    });

    test('prioritizes Authorization header over cookie', () => {
        const headerToken = JWT.createToken(TEST_USER_ID);
        const cookieToken = JWT.createToken('other-user');
        const req = createMockRequest({
            headers: { authorization: `Bearer ${headerToken}` },
            cookies: { token: cookieToken },
        });

        const extracted = JWT.extractToken(req);
        assert.strictEqual(extracted, headerToken);
    });

    test('returns null when no token present', () => {
        const req = createMockRequest();

        const extracted = JWT.extractToken(req);
        assert.strictEqual(extracted, null);
    });

    test('returns null for malformed Authorization header', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const malformedHeaders = [
            { authorization: token }, // Missing "Bearer " prefix
            { authorization: `Basic ${token}` }, // Wrong scheme
            { authorization: 'Bearer' }, // No token
            { authorization: '' }, // Empty string
        ];

        for (const headers of malformedHeaders) {
            const req = createMockRequest({ headers });
            const extracted = JWT.extractToken(req);
            assert.strictEqual(extracted, null);
        }
    });

    test('handles case-sensitive Authorization header', () => {
        const token = JWT.createToken(TEST_USER_ID);

        // "Bearer " must be exact case
        const req1 = createMockRequest({
            headers: { authorization: `bearer ${token}` }, // lowercase
        });
        assert.strictEqual(JWT.extractToken(req1), null);

        const req2 = createMockRequest({
            headers: { authorization: `BEARER ${token}` }, // uppercase
        });
        assert.strictEqual(JWT.extractToken(req2), null);
    });

    test('returns null when cookies object is undefined', () => {
        const req = {
            headers: {},
            cookies: undefined,
        } as unknown as Request;

        const extracted = JWT.extractToken(req);
        assert.strictEqual(extracted, null);
    });

    test('extracts token with spaces in Bearer scheme', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const req = createMockRequest({
            headers: { authorization: `Bearer  ${token}` }, // Extra space
        });

        const extracted = JWT.extractToken(req);
        // Should not extract due to extra space
        assert.notStrictEqual(extracted, token);
    });
});

/* -------------------- SET TOKEN COOKIE TESTS -------------------- */

describe('setTokenCookie', () => {
    test('sets cookie with token', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const res = createMockResponse();

        JWT.setTokenCookie(res, token);

        assert.strictEqual(res._cookies.length, 1);
        assert.strictEqual(res._cookies[0]!.name, 'token');
        assert.strictEqual(res._cookies[0]!.value, token);
    });

    test('sets cookie with httpOnly flag', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const res = createMockResponse();

        JWT.setTokenCookie(res, token);

        const options = res._cookies[0]!.options;
        assert.strictEqual(options.httpOnly, true);
    });

    test('sets cookie with correct sameSite', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const res = createMockResponse();

        JWT.setTokenCookie(res, token);

        const options = res._cookies[0]!.options;
        assert.strictEqual(options.sameSite, 'lax');
    });

    test('sets cookie with correct path', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const res = createMockResponse();

        JWT.setTokenCookie(res, token);

        const options = res._cookies[0]!.options;
        assert.strictEqual(options.path, '/');
    });

    test('sets secure flag based on environment', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const res = createMockResponse();

        JWT.setTokenCookie(res, token);

        const options = res._cookies[0]!.options;
        // In test environment, NODE_ENV is not 'production'
        assert.strictEqual(options.secure, false);
    });

    test('sets cookie expiration when provided', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
        const res = createMockResponse();

        JWT.setTokenCookie(res, token, expiresAt);

        const options = res._cookies[0]!.options;
        assert.ok(options.expires);
        assert.ok(options.expires instanceof Date);

        // Verify expiration is correct (within 1 second)
        const expectedDate = new Date(expiresAt * 1000);
        assert.ok(Math.abs(options.expires.getTime() - expectedDate.getTime()) < 1000);
    });

    test('does not set expiration when not provided', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const res = createMockResponse();

        JWT.setTokenCookie(res, token);

        const options = res._cookies[0]!.options;
        assert.strictEqual(options.expires, undefined);
    });

    test('sets cookie with past expiration', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const expiresAt = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
        const res = createMockResponse();

        JWT.setTokenCookie(res, token, expiresAt);

        const options = res._cookies[0]!.options;
        assert.ok(options.expires);
        assert.ok(options.expires < new Date());
    });

    test('sets cookie with far future expiration', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const expiresAt = Math.floor(Date.now() / 1000) + (365 * 24 * 3600); // 1 year from now
        const res = createMockResponse();

        JWT.setTokenCookie(res, token, expiresAt);

        const options = res._cookies[0]!.options;
        assert.ok(options.expires);
        assert.ok(options.expires > new Date());
    });
});

/* -------------------- CLEAR TOKEN COOKIE TESTS -------------------- */

describe('clearTokenCookie', () => {
    test('clears token cookie', () => {
        const res = createMockResponse();

        JWT.clearTokenCookie(res);

        assert.strictEqual(res._clearedCookies.length, 1);
        assert.strictEqual(res._clearedCookies[0]!.name, 'token');
    });

    test('clears cookie with correct options', () => {
        const res = createMockResponse();

        JWT.clearTokenCookie(res);

        const options = res._clearedCookies[0]!.options;
        assert.strictEqual(options.httpOnly, true);
        assert.strictEqual(options.sameSite, 'lax');
        assert.strictEqual(options.path, '/');
    });

    test('clears cookie with secure flag based on environment', () => {
        const res = createMockResponse();

        JWT.clearTokenCookie(res);

        const options = res._clearedCookies[0]!.options;
        // In test environment, NODE_ENV is not 'production'
        assert.strictEqual(options.secure, false);
    });

    test('can be called multiple times', () => {
        const res = createMockResponse();

        JWT.clearTokenCookie(res);
        JWT.clearTokenCookie(res);

        assert.strictEqual(res._clearedCookies.length, 2);
    });
});

/* -------------------- GET TOKEN EXPIRATION TESTS -------------------- */

describe('getTokenExpiration', () => {
    test('returns expiration for valid token', () => {
        const token = JWT.createToken(TEST_USER_ID, '1h');
        const expiration = JWT.getTokenExpiration(token);

        assert.ok(expiration);
        assert.strictEqual(typeof expiration, 'number');

        // Verify it's approximately 1 hour from now
        const now = Math.floor(Date.now() / 1000);
        const expectedExp = now + 3600;
        assert.ok(Math.abs(expiration - expectedExp) < 5);
    });

    test('returns null for permanent token', () => {
        const token = JWT.createToken(TEST_USER_ID, '-1');
        const expiration = JWT.getTokenExpiration(token);

        assert.strictEqual(expiration, null);
    });

    test('returns expiration for expired token', () => {
        const expiredToken = createExpiredToken(TEST_USER_ID);
        const expiration = JWT.getTokenExpiration(expiredToken);

        // Should return null because verification fails
        assert.strictEqual(expiration, null);
    });

    test('returns null for invalid token', () => {
        const invalidToken = createInvalidSignatureToken(TEST_USER_ID);
        const expiration = JWT.getTokenExpiration(invalidToken);

        assert.strictEqual(expiration, null);
    });

    test('returns null for malformed token', () => {
        const malformedTokens = [
            'not.a.token',
            'invalid-token',
            '',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
        ];

        for (const malformedToken of malformedTokens) {
            const expiration = JWT.getTokenExpiration(malformedToken);
            assert.strictEqual(expiration, null);
        }
    });

    test('returns correct expiration for different durations', () => {
        const durations = [
            { duration: '1h' as const, seconds: 3600 },
            { duration: '1d' as const, seconds: 86400 },
            { duration: '7d' as const, seconds: 604800 },
        ];

        for (const { duration, seconds } of durations) {
            const token = JWT.createToken(TEST_USER_ID, duration);
            const expiration = JWT.getTokenExpiration(token);

            assert.ok(expiration);
            const now = Math.floor(Date.now() / 1000);
            const expectedExp = now + seconds;
            assert.ok(Math.abs(expiration - expectedExp) < 5);
        }
    });
});

/* -------------------- INTEGRATION TESTS -------------------- */

describe('integration: token lifecycle', () => {
    test('create, extract, and verify token flow', () => {
        // Create token
        const token = JWT.createToken(TEST_USER_ID, '1h');

        // Extract from Authorization header
        const req1 = createMockRequest({
            headers: { authorization: `Bearer ${token}` },
        });
        const extracted1 = JWT.extractToken(req1);
        assert.strictEqual(extracted1, token);

        // Verify extracted token
        const payload1 = JWT.verifyToken(extracted1!);
        assert.strictEqual(payload1.id, TEST_USER_ID);

        // Extract from cookie
        const req2 = createMockRequest({
            cookies: { token },
        });
        const extracted2 = JWT.extractToken(req2);
        assert.strictEqual(extracted2, token);

        // Verify extracted token
        const payload2 = JWT.verifyToken(extracted2!);
        assert.strictEqual(payload2.id, TEST_USER_ID);
    });

    test('create token, set cookie, and verify', () => {
        // Create token with expiration
        const token = JWT.createToken(TEST_USER_ID, '7d');
        const payload = JWT.verifyToken(token);

        // Set cookie with expiration
        const res = createMockResponse();
        JWT.setTokenCookie(res, token, payload.exp);

        // Verify cookie was set correctly
        assert.strictEqual(res._cookies.length, 1);
        assert.strictEqual(res._cookies[0]!.value, token);

        // Extract and verify token from cookie
        const req = createMockRequest({
            cookies: { token: res._cookies[0]!.value },
        });
        const extracted = JWT.extractToken(req);
        const verifiedPayload = JWT.verifyToken(extracted!);

        assert.strictEqual(verifiedPayload.id, TEST_USER_ID);
    });

    test('get expiration from created token', () => {
        const token = JWT.createToken(TEST_USER_ID, '2h');
        const expiration = JWT.getTokenExpiration(token);

        assert.ok(expiration);

        // Verify expiration matches what we expect
        const payload = JWT.verifyToken(token);
        assert.strictEqual(expiration, payload.exp);
    });

    test('clear cookie after setting', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const res = createMockResponse();

        // Set cookie
        JWT.setTokenCookie(res, token);
        assert.strictEqual(res._cookies.length, 1);

        // Clear cookie
        JWT.clearTokenCookie(res);
        assert.strictEqual(res._clearedCookies.length, 1);
        assert.strictEqual(res._clearedCookies[0]!.name, 'token');
    });
});

/* -------------------- EDGE CASES AND SECURITY TESTS -------------------- */

describe('edge cases and security', () => {
    test('handles very long user IDs', () => {
        const longUserId = 'user-' + 'a'.repeat(1000);
        const token = JWT.createToken(longUserId);
        const payload = JWT.verifyToken(token);

        assert.strictEqual(payload.id, longUserId);
    });

    test('handles special characters in user ID', () => {
        const specialUserIds = [
            'user@example.com',
            'user+test@example.com',
            'user/123',
            'user\\123',
            'user"123',
            "user'123",
        ];

        for (const userId of specialUserIds) {
            const token = JWT.createToken(userId);
            const payload = JWT.verifyToken(token);
            assert.strictEqual(payload.id, userId);
        }
    });

    test('tokens created milliseconds apart are different', () => {
        const token1 = JWT.createToken(TEST_USER_ID);
        const token2 = JWT.createToken(TEST_USER_ID);

        assert.notStrictEqual(token1, token2);

        const payload1 = JWT.verifyToken(token1);
        const payload2 = JWT.verifyToken(token2);

        // JTIs must be different
        assert.notStrictEqual(payload1.jti, payload2.jti);
    });

    test('cannot modify token payload without detection', () => {
        const token = JWT.createToken(TEST_USER_ID);
        const parts = token.split('.');

        // Try to modify the payload
        const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
        payload.id = 'hacker-user';
        parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');

        const modifiedToken = parts.join('.');

        // Verification should fail
        assert.throws(
            () => JWT.verifyToken(modifiedToken),
            (error: any) => {
                assert.ok(error instanceof jwt.JsonWebTokenError);
                return true;
            }
        );
    });

    test('extractToken handles header injection attempts', () => {
        const token = JWT.createToken(TEST_USER_ID);

        // Try various header injection patterns
        const injectionAttempts = [
            `Bearer ${token}\r\nX-Admin: true`,
            `Bearer ${token}\nX-Admin: true`,
            `Bearer ${token}; DROP TABLE users;`,
        ];

        for (const attempt of injectionAttempts) {
            const req = createMockRequest({
                headers: { authorization: attempt },
            });
            const extracted = JWT.extractToken(req);

            // If extracted, it should include the injection attempt
            // The verification will fail
            if (extracted) {
                assert.throws(() => JWT.verifyToken(extracted));
            }
        }
    });

    test('cookie with empty string token', () => {
        const req = createMockRequest({
            cookies: { token: '' },
        });

        const extracted = JWT.extractToken(req);
        assert.strictEqual(extracted, null); // Empty string treated as no token
    });

    test('Authorization header with empty token', () => {
        const req = createMockRequest({
            headers: { authorization: 'Bearer ' },
        });

        const extracted = JWT.extractToken(req);
        assert.strictEqual(extracted, null); // Empty string treated as no token
    });

    test('multiple Bearer tokens in header', () => {
        const token1 = JWT.createToken(TEST_USER_ID);
        const token2 = JWT.createToken('other-user');
        const req = createMockRequest({
            headers: { authorization: `Bearer ${token1} Bearer ${token2}` },
        });

        const extracted = JWT.extractToken(req);
        // Should extract everything after "Bearer "
        assert.strictEqual(extracted, `${token1} Bearer ${token2}`);

        // Verification should fail due to extra content
        assert.throws(() => JWT.verifyToken(extracted!));
    });
});
