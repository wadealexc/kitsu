/**
 * Authentication and Authorization Routes
 *
 * Handles user authentication (signin/signup/signout), session management,
 * profile updates, password management, admin user creation, and admin configuration.
 */

import { Router, type Request, type Response } from 'express';
import type { StringValue } from 'ms';

import * as Types from './types.js';
import { requireAuth, requireAdmin } from './middleware.js';
import { db } from '../db/client.js';
import * as Users from '../db/operations/users.js';
import * as Auths from '../db/operations/auths.js';
import * as JWT from './jwt.js';
import { DEFAULT_USER_ROLE, type User } from '../db/schema.js';
import type { UserRole } from './types.js';
import { HttpError, BadRequestError, NotFoundError } from './errors.js';

const router = Router();

/* -------------------- MODULE-LEVEL CONFIG -------------------- */

let adminConfig: Types.AdminConfig = {
    SHOW_ADMIN_DETAILS: true,
    ADMIN_EMAIL: null,
    WEBUI_URL: 'http://192.168.87.30:5050',
    ENABLE_SIGNUP: true,
    ENABLE_API_KEYS: false,
    ENABLE_API_KEYS_ENDPOINT_RESTRICTIONS: false,
    API_KEYS_ALLOWED_ENDPOINTS: '',
    DEFAULT_USER_ROLE: DEFAULT_USER_ROLE,
    DEFAULT_GROUP_ID: '',
    JWT_EXPIRES_IN: '7d',
    ENABLE_COMMUNITY_SHARING: false,
    ENABLE_MESSAGE_RATING: false,
    ENABLE_FOLDERS: true,
    FOLDER_MAX_FILE_COUNT: null,
    ENABLE_CHANNELS: false,
    ENABLE_MEMORIES: false,
    ENABLE_NOTES: false,
    ENABLE_USER_WEBHOOKS: false,
    ENABLE_USER_STATUS: false,
    PENDING_USER_OVERLAY_TITLE: null,
    PENDING_USER_OVERLAY_CONTENT: null,
    RESPONSE_WATERMARK: null,
};

/* -------------------- PUBLIC ENDPOINTS -------------------- */

/**
 * POST /api/v1/auths/signin
 * Access Control: Public
 *
 * Authenticate a user with email and password, returning a session token.
 *
 * @param {Types.SigninForm} - email and password
 * @returns {Types.SessionUserResponse} - user info with JWT token
 */
router.post('/signin', async (
    req: Types.TypedRequest<{}, Types.SigninForm>,
    res: Response<Types.SessionUserResponse | Types.ErrorResponse>
) => {
    const body = Types.SigninFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { email, password } = body.data;

    try {
        // Authenticate user (email is used as username)
        const result = await Auths.authenticateUser(email, password, db);
        if (!result) {
            throw BadRequestError('Invalid credentials');
        }

        const { user } = result;

        // Generate JWT token
        const expiresIn = getJWTExpiration();
        const token = JWT.createToken(user.id, expiresIn);
        const expiresAt = JWT.getTokenExpiration(token);

        // Set cookie
        JWT.setTokenCookie(res, token, expiresAt ?? undefined);

        // Return session user response
        return res.json(toSessionUserResponse(user, token, expiresAt));
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        console.error('Signin error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/auths/signup
 * Access Control: Public
 *
 * Register a new user account. First user becomes admin, subsequent users get default role.
 *
 * @param {Types.SignupForm} - name, email, password, and optional profile image URL
 * @returns {Types.SessionUserResponse} - user info with JWT token
 */
router.post('/signup', async (
    req: Types.TypedRequest<{}, Types.SignupForm>,
    res: Response<Types.SessionUserResponse | Types.ErrorResponse>
) => {
    const body = Types.SignupFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { email, password, profile_image_url: profileImageUrl } = body.data;

    try {
        const user = await db.transaction(async (tx) => {
            // Determine role (first user is admin)
            const role = await Users.determineRole(tx);

            // Create user (email used as username)
            const newUser = await Users.createUser({
                id: crypto.randomUUID(),
                username: email,
                role,
                profileImageUrl: profileImageUrl,
            }, tx);

            // Create auth credentials
            await Auths.createAuth({
                id: newUser.id,
                username: email,
                password,
            }, tx);

            return newUser;
        });

        // Generate token
        const expiresIn = getJWTExpiration();
        const token = JWT.createToken(user.id, expiresIn);
        const expiresAt = JWT.getTokenExpiration(token);

        // Set cookie
        JWT.setTokenCookie(res, token, expiresAt ?? undefined);

        return res.json(toSessionUserResponse(user, token, expiresAt));
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Signup error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/auths/signout
 * Access Control: Public (accepts token from header or cookie)
 *
 * Sign out the current user by invalidating their token and clearing cookies.
 *
 * @returns {Types.SignoutResponse} - status and optional redirect URL
 */
router.get('/signout', (
    req: Request,
    res: Response<Types.SignoutResponse | Types.ErrorResponse>
) => {
    // TODO: Implement token blacklisting/revocation
    JWT.clearTokenCookie(res);
    return res.json({ status: true });
});

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/v1/auths/
 * Access Control: Requires HTTPBearer authentication (JWT token in Authorization header)
 *
 * Returns the currently authenticated user's session information including their profile,
 * permissions, and token expiration.
 *
 * @returns {Types.SessionUserInfoResponse} - extended user info with profile fields and status
 */
router.get('/', requireAuth, (
    req: Request,
    res: Response<Types.SessionUserInfoResponse | Types.ErrorResponse>
) => {
    const user = req.user!;

    // Extract token and refresh cookie
    const token = JWT.extractToken(req);
    if (token) {
        const expiresAt = JWT.getTokenExpiration(token);
        JWT.setTokenCookie(res, token, expiresAt ?? undefined);
    }

    return res.json({
        id: user.id,
        name: user.username,
        role: user.role,
        email: user.username,
        profile_image_url: user.profileImageUrl,
        token: token || '',
        token_type: 'Bearer',
        expires_at: token ? JWT.getTokenExpiration(token) : null,
        permissions: getDefaultPermissions(user.role),
    });
});

/**
 * POST /api/v1/auths/update/profile
 * Access Control: Requires HTTPBearer authentication (JWT token)
 *
 * Update the current user's profile information (name, bio, gender, date of birth, profile image).
 *
 * @param {Types.UpdateProfileForm} - profile image URL, name, bio, gender, and date of birth
 * @returns {Types.UserProfileImageResponse} - updated user profile
 */
router.post('/update/profile', requireAuth, async (
    req: Types.TypedRequest<{}, Types.UpdateProfileForm>,
    res: Response<Types.UserProfileImageResponse | Types.ErrorResponse>
) => {
    const body = Types.UpdateProfileFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const profileImageUrl = body.data.profile_image_url;
    const userId = req.user!.id;

    try {
        // Only update profile image (other fields ignored)
        const updatedUser = await Users.updateProfile(userId, {
            profileImageUrl: profileImageUrl,
        }, db);

        if (!updatedUser) {
            throw NotFoundError('User not found');
        }

        return res.json({
            id: updatedUser.id,
            name: updatedUser.username,
            role: updatedUser.role,
            email: updatedUser.username,
            profile_image_url: updatedUser.profileImageUrl,
        });
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        console.error('Update profile error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/auths/update/password
 * Access Control: Requires HTTPBearer authentication (JWT token)
 *
 * Change the current user's password after verifying their current password.
 *
 * @param {Types.UpdatePasswordForm} - current password and new password
 * @returns {boolean} - true if successful
 */
router.post('/update/password', requireAuth, async (
    req: Types.TypedRequest<{}, Types.UpdatePasswordForm>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const body = Types.UpdatePasswordFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { password, new_password: newPassword } = body.data;
    const user = req.user!;

    try {
        // Verify current password
        const isValid = await Auths.authenticateUser(user.username, password, db);
        if (!isValid) {
            throw BadRequestError('Current password is incorrect');
        }

        // Update to new password
        await Auths.updatePassword(user.id, newPassword, db);

        return res.json(true);
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Update password error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/auths/update/timezone
 * Access Control: Requires HTTPBearer authentication (JWT token)
 *
 * Update the current user's timezone preference.
 *
 * @param {Types.UpdateTimezoneForm} - IANA timezone string (e.g., 'America/New_York')
 * @returns {Types.StatusResponse} - success status
 */
router.post('/update/timezone', requireAuth, (
    req: Types.TypedRequest<{}, Types.UpdateTimezoneForm>,
    res: Response<Types.StatusResponse | Types.ErrorResponse>
) => {
    // TODO: Timezone field removed from schema - this endpoint is a no-op
    // Kept for backward compatibility with frontend
    return res.json({ status: true });
});

/**
 * GET /api/v1/auths/admin/details
 * Access Control: Requires HTTPBearer authentication (JWT token)
 *
 * Get the admin's name and email for display purposes (e.g., support contact info).
 *
 * @returns {Types.AdminDetailsResponse} - admin name and email
 */
router.get('/admin/details', requireAuth, async (
    req: Request,
    res: Response<Types.AdminDetailsResponse | Types.ErrorResponse>
) => {
    try {
        const firstUser = await Users.getFirstUser(db);
        if (!firstUser) {
            throw NotFoundError('No users found');
        }

        return res.json({
            name: firstUser.username,
            email: firstUser.username,
        });
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        console.error('Get admin details error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- ADMIN ENDPOINTS -------------------- */

/**
 * POST /api/v1/auths/add
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Admin Only: Create a new user account without going through the signup flow.
 *
 * @param {Types.AddUserForm} - name, email, password, optional profile image URL and role
 * @returns {Types.SigninResponse} - created user info with token
 */
router.post('/add', requireAdmin, async (
    req: Types.TypedRequest<{}, Types.AddUserForm>,
    res: Response<Types.SigninResponse | Types.ErrorResponse>
) => {
    const body = Types.AddUserFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const { email, password, role, profile_image_url: profileImageUrl } = body.data;

    try {
        const user = await db.transaction(async (tx) => {
            // Create user with specified role
            const newUser = await Users.createUser({
                id: crypto.randomUUID(),
                username: email,
                role: role,
                profileImageUrl: profileImageUrl,
            }, tx);

            // Create auth credentials
            await Auths.createAuth({
                id: newUser.id,
                username: email,
                password,
            }, tx);

            return newUser;
        });

        // Generate token (but don't set cookie for admin-created users)
        const expiresIn = getJWTExpiration();
        const token = JWT.createToken(user.id, expiresIn);
        const expiresAt = JWT.getTokenExpiration(token);

        return res.json(toSigninResponse(user, token, expiresAt));
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Add user error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/auths/admin/config
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Admin Only: Get the current admin/auth configuration settings.
 *
 * @returns {Types.AdminConfig} - configuration fields controlling authentication, signup, and features
 */
router.get('/admin/config', requireAdmin, (
    req: Request,
    res: Response<Types.AdminConfig | Types.ErrorResponse>
) => {
    return res.json(adminConfig);
});

/**
 * POST /api/v1/auths/admin/config
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Admin Only: Update the admin/auth configuration settings.
 *
 * @param {Types.AdminConfig} - all configuration fields
 * @returns {Types.AdminConfig} - echoes back the updated configuration
 */
router.post('/admin/config', requireAdmin, (
    req: Types.TypedRequest<{}, Types.AdminConfig>,
    res: Response<Types.AdminConfig | Types.ErrorResponse>
) => {
    const body = Types.AdminConfigSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    // Update in-memory config
    adminConfig = { ...adminConfig, ...body.data };
    return res.json(adminConfig);
});

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Convert user to SessionUserResponse format
 * Handles field translation from DB schema to API schema
 */
function toSessionUserResponse(
    user: User,
    token: string,
    expiresAt: number | null
): Types.SessionUserResponse {
    return {
        id: user.id,
        name: user.username,  // Use username as name
        role: user.role,
        email: user.username,  // Use username as email
        profile_image_url: user.profileImageUrl,
        token,
        token_type: 'Bearer',
        expires_at: expiresAt,
        permissions: getDefaultPermissions(user.role),
    };
}

/**
 * Convert user to SigninResponse format (for admin-created users)
 */
function toSigninResponse(
    user: User,
    token: string,
    expiresAt: number | null
): Types.SigninResponse {
    return {
        id: user.id,
        name: user.username,
        role: user.role,
        email: user.username,
        profile_image_url: user.profileImageUrl,
        token,
        token_type: 'Bearer',
    };
}

/**
 * Get default permissions based on user role
 * TODO: Move to database once permissions table exists
 */
function getDefaultPermissions(role: UserRole): Record<string, any> {
    const isAdmin = role === 'admin';
    return {
        workspace: {
            models: isAdmin,
            knowledge: isAdmin,
            prompts: isAdmin,
        },
    };
}

/**
 * Get JWT expiration duration from admin config
 */
function getJWTExpiration(): StringValue {
    return adminConfig.JWT_EXPIRES_IN;
}

/* -------------------- EXPORT -------------------- */

export default router;
