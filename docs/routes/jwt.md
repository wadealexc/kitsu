# JWT Token Management

## Overview

JWT (JSON Web Token) tokens are used for stateless authentication. Tokens are signed with HS256 algorithm and can optionally be revoked using Redis.

References:
- _OWUI Implementation:_ `open-webui/backend/open_webui/utils/auth.py`

## Token Structure

### Payload

```typescript
type JWTPayload = {
    id: string;          // User ID
    exp?: number;        // Expiration timestamp (unix seconds)
    jti: string;         // JWT ID (UUID) for revocation tracking
    iat?: number;        // Issued at timestamp (optional, auto-added by jwt library)
};
```

### Signing Configuration

- _Algorithm:_ HS256 (HMAC with SHA-256)
- _Secret:_ `SESSION_SECRET` from environment variable (`WEBUI_SECRET_KEY`)
- _Expiration:_ Configurable via `JWT_EXPIRES_IN` (default: "4w" = 4 weeks)

---

## Token Operations

### Generate Token

```typescript
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

export function createToken(
    userId: string,
    expiresIn: string | number = '4w'
): string {
    const payload: JWTPayload = {
        id: userId,
        jti: randomUUID(), // For revocation tracking
    };

    const options: jwt.SignOptions = {
        algorithm: 'HS256',
    };

    // Handle special expiration values
    if (expiresIn === '-1' || expiresIn === '0') {
        // Permanent token (no expiration)
        // Security warning: should be avoided in production
    } else {
        options.expiresIn = expiresIn;
    }

    return jwt.sign(payload, SESSION_SECRET, options);
}
```

_Expiration Format:_
- Time string: `"4w"`, `"7d"`, `"24h"`, `"60m"`, `"3600s"`
- Permanent: `"-1"` or `"0"` (not recommended)
- Must match regex: `/^(-1|0|(-?\d+(\.\d+)?)(ms|s|m|h|d|w))$/`

### Decode and Verify Token

```typescript
export function verifyToken(token: string): JWTPayload | null {
    try {
        const decoded = jwt.verify(token, SESSION_SECRET, {
            algorithms: ['HS256'],
        }) as JWTPayload;

        return decoded;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            console.log('Token expired');
        } else if (error instanceof jwt.JsonWebTokenError) {
            console.log('Invalid token');
        }
        return null;
    }
}
```

_Errors handled:_
- `TokenExpiredError` - Token has expired
- `JsonWebTokenError` - Invalid signature or malformed token
- `NotBeforeError` - Token used before `nbf` claim

### Token Revocation (Optional - Requires Redis)

```typescript
import type { RedisClientType } from 'redis';

const REDIS_KEY_PREFIX = 'llama-shim';

export async function revokeToken(
    redis: RedisClientType,
    token: string
): Promise<void> {
    const decoded = verifyToken(token);
    if (!decoded) return;

    const { jti, exp } = decoded;
    if (!jti || !exp) return;

    const ttl = exp - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // Already expired

    // Store revoked JTI with TTL matching token expiration
    await redis.set(
        `${REDIS_KEY_PREFIX}:auth:token:${jti}:revoked`,
        '1',
        { EX: ttl }
    );
}

export async function isTokenRevoked(
    redis: RedisClientType | null,
    token: string
): Promise<boolean> {
    if (!redis) return false; // No revocation check if Redis unavailable

    const decoded = verifyToken(token);
    if (!decoded) return true; // Invalid tokens are treated as revoked

    const { jti } = decoded;
    if (!jti) return false;

    const revoked = await redis.get(
        `${REDIS_KEY_PREFIX}:auth:token:${jti}:revoked`
    );

    return revoked === '1';
}
```

_Note:_ Token revocation is optional. If Redis is not available, tokens remain valid until expiration.

---

## Token Extraction

### From Request

```typescript
import type { Request } from 'express';

export function extractToken(req: Request): string | null {
    // Priority 1: Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }

    // Priority 2: Cookie
    const cookieToken = req.cookies?.token;
    if (cookieToken) {
        return cookieToken;
    }

    return null;
}
```

---

## Cookie Management

### Set Secure Cookie

```typescript
import type { Response } from 'express';

export function setTokenCookie(
    res: Response,
    token: string,
    expiresAt?: number
): void {
    const cookieOptions: CookieOptions = {
        httpOnly: true,                    // Not accessible via JavaScript
        secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
        sameSite: 'lax',                   // CSRF protection
        path: '/',
    };

    if (expiresAt) {
        cookieOptions.expires = new Date(expiresAt * 1000);
    }

    res.cookie('token', token, cookieOptions);
}
```

### Clear Cookie

```typescript
export function clearTokenCookie(res: Response): void {
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    });
}
```

---

## Authentication Middleware

### Get Current User from Token

```typescript
import type { Request, Response, NextFunction } from 'express';

export async function getCurrentUser(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const token = extractToken(req);

        if (!token) {
            clearTokenCookie(res); // Clean up invalid cookie
            return res.status(401).json({ detail: 'Not authenticated' });
        }

        // Verify token signature and expiration
        const decoded = verifyToken(token);
        if (!decoded) {
            clearTokenCookie(res);
            return res.status(401).json({ detail: 'Invalid token' });
        }

        // Check revocation (if Redis available)
        if (req.app.locals.redis) {
            const revoked = await isTokenRevoked(req.app.locals.redis, token);
            if (revoked) {
                clearTokenCookie(res);
                return res.status(401).json({ detail: 'Token revoked' });
            }
        }

        // Fetch user from database
        const user = await getUserById(decoded.id);
        if (!user) {
            clearTokenCookie(res);
            return res.status(401).json({ detail: 'User not found' });
        }

        // Attach user to request
        req.user = user;

        // Update last active (async, don't wait)
        updateLastActive(user.id).catch(() => {});

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        clearTokenCookie(res);
        res.status(401).json({ detail: 'Authentication failed' });
    }
}
```

### Role Guards

```typescript
export function requireAdmin(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (!req.user) {
        return res.status(401).json({ detail: 'Not authenticated' });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({ detail: 'Admin access required' });
    }

    next();
}

export function requireVerified(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    if (!req.user) {
        return res.status(401).json({ detail: 'Not authenticated' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'user') {
        return res.status(403).json({ detail: 'Account pending verification' });
    }

    next();
}
```

---

## Security Considerations

### Cookie Security

_HttpOnly Flag:_
- Prevents JavaScript access to token
- Mitigates XSS attacks

_Secure Flag:_
- Requires HTTPS in production
- Prevents token leakage over unencrypted connections

_SameSite Flag:_
- `lax` - Prevents CSRF attacks while allowing top-level navigation
- Blocks cross-site POST requests
- Compatible with most browsers

### Token Lifetime

_Recommendations:_
- Short-lived tokens: 1-7 days for better security
- Refresh tokens: Implement separate long-lived refresh tokens
- Session extension: Update token on each request (optional)

_OWUI defaults to 4 weeks_ - reasonable for small team deployments.

### Secret Key Management

```typescript
const SESSION_SECRET = process.env.WEBUI_SECRET_KEY;

if (!SESSION_SECRET) {
    throw new Error('WEBUI_SECRET_KEY environment variable is required');
}

if (SESSION_SECRET.length < 32) {
    console.warn('WARNING: WEBUI_SECRET_KEY should be at least 32 characters');
}
```

_Best practices:_
- Use strong random secret (min 32 characters)
- Store in environment variables, not in code
- Rotate secret periodically (invalidates all tokens)
- Use different secrets for dev/staging/production

---

## Implementation Checklist

### Required for MVP:
- [x] Token generation with configurable expiration
- [x] Token verification and signature validation
- [x] Token extraction from Authorization header and cookies
- [x] Secure cookie management
- [x] Authentication middleware
- [x] Role-based guards (admin, verified user)
- [x] Automatic cookie cleanup on auth failure

### Optional (Nice to Have):
- [ ] Token revocation via Redis
- [ ] Refresh token support
- [ ] Token rotation/extension on activity
- [ ] Multiple device tracking
- [ ] Rate limiting per token

---

## Testing Strategy

### Unit Tests

```typescript
describe('JWT Token Management', () => {
    test('should generate valid token', () => {
        const token = createToken('user-123', '1h');
        expect(token).toBeTruthy();
        const decoded = verifyToken(token);
        expect(decoded?.id).toBe('user-123');
    });

    test('should reject expired token', async () => {
        const token = createToken('user-123', '1ms');
        await new Promise(resolve => setTimeout(resolve, 10));
        const decoded = verifyToken(token);
        expect(decoded).toBeNull();
    });

    test('should reject invalid signature', () => {
        const token = createToken('user-123', '1h');
        const tampered = token + 'x';
        const decoded = verifyToken(tampered);
        expect(decoded).toBeNull();
    });
});
```

### Integration Tests

```typescript
describe('Authentication Middleware', () => {
    test('should authenticate valid token', async () => {
        const user = await createTestUser();
        const token = createToken(user.id, '1h');

        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(200);
        expect(res.body.id).toBe(user.id);
    });

    test('should reject missing token', async () => {
        const res = await request(app)
            .get('/api/v1/auths/');

        expect(res.status).toBe(401);
    });

    test('should clear cookie on invalid token', async () => {
        const res = await request(app)
            .get('/api/v1/auths/')
            .set('Cookie', 'token=invalid');

        expect(res.status).toBe(401);
        expect(res.headers['set-cookie']).toContain('token=;');
    });
});
```

---

## Migration from Mock Auth

When replacing mock authentication:

1. _Signin endpoint (`POST /api/v1/auths/signin`):_
   ```typescript
   const { user, auth } = await authenticateUser(email, password);
   const token = createToken(user.id, JWT_EXPIRES_IN);
   setTokenCookie(res, token, getExpiresAt(JWT_EXPIRES_IN));
   return res.json({ ...user, token, token_type: 'Bearer', expires_at });
   ```

2. _Signup endpoint (`POST /api/v1/auths/signup`):_
   ```typescript
   const { user } = await createUserWithAuth(email, password, name);
   const token = createToken(user.id, JWT_EXPIRES_IN);
   setTokenCookie(res, token);
   return res.json({ ...user, token, token_type: 'Bearer' });
   ```

3. _Signout endpoint (`GET /api/v1/auths/signout`):_
   ```typescript
   const token = extractToken(req);
   if (token && redis) {
       await revokeToken(redis, token);
   }
   clearTokenCookie(res);
   return res.json({ status: true });
   ```

4. _Session check (`GET /api/v1/auths/`):_
   ```typescript
   // getCurrentUser middleware already attached req.user
   const token = extractToken(req)!;
   const decoded = verifyToken(token)!;
   return res.json({
       ...req.user,
       token,
       token_type: 'Bearer',
       expires_at: decoded.exp,
   });
   ```