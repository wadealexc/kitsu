/**
 * Authentication and Authorization Routes
 *
 * Handles user authentication (signin/signup/signout), session management,
 * profile updates, password management, admin user creation, and admin configuration.
 */

import { Router, type Request, type Response } from 'express';
import * as Types from './types.js';
import * as MockData from './mock-data.js';
import { requireAuth, requireAdmin } from './middleware.js';

const router = Router();

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
router.post('/signin', (
    req: Types.TypedRequest<{},Types.SigninForm>,
    res: Response<Types.SessionUserResponse | Types.ErrorResponse>
) => {
    const parsed = Types.SigninFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    const { email, password } = parsed.data;

    // Mock response
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

    const response: Types.SessionUserResponse = {
        id: MockData.mockUserId,
        name: 'Mock User',
        role: 'user',
        email: email,
        profile_image_url: '/user.png',
        token: MockData.mockToken,
        token_type: 'Bearer',
        expires_at: expiresAt,
        permissions: {
            workspace: { models: true, knowledge: false, prompts: false },
        },
    };

    // Set httponly cookie for browser-based auth
    res.cookie('token', MockData.mockToken, {
        expires: new Date(expiresAt * 1000),
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
    });

    res.status(200).json(response);
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
router.post('/signup', (
    req: Types.TypedRequest<{},Types.SignupForm>,
    res: Response<Types.SessionUserResponse | Types.ErrorResponse>
) => {
    const parsed = Types.SignupFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    const { name, email, profile_image_url } = parsed.data;

    // Mock response (simulating first user = admin)
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

    const response: Types.SessionUserResponse = {
        id: MockData.mockUserId,
        name: name,
        role: 'admin',
        email: email,
        profile_image_url: profile_image_url,
        token: MockData.mockToken,
        token_type: 'Bearer',
        expires_at: expiresAt,
        permissions: {
            workspace: { models: true, knowledge: true, prompts: true },
        },
    };

    // Set httponly cookie for browser-based auth
    res.cookie('token', MockData.mockToken, {
        expires: new Date(expiresAt * 1000),
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
    });

    res.status(200).json(response);
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
    // Clear the token cookie
    res.clearCookie('token');

    // Mock response (no redirect)
    res.status(200).json({ status: true });
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
    // Extract token from Authorization header (already validated by middleware)
    const authHeader = req.headers.authorization!;
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

    // Mock response
    const response: Types.SessionUserInfoResponse = {
        id: MockData.mockUserId,
        name: 'Mock User',
        role: 'user',
        email: 'user@example.com',
        profile_image_url: '/user.png',
        token: token,
        token_type: 'Bearer',
        expires_at: expiresAt,
        permissions: {
            workspace: { models: true, knowledge: false, prompts: false },
        },
        bio: 'This is my bio',
        gender: null,
        date_of_birth: null,
        status_emoji: '🚀',
        status_message: 'Working on something cool',
        status_expires_at: null,
    };

    // Refresh/extend the cookie on each session check
    res.cookie('token', token, {
        expires: new Date(expiresAt * 1000),
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
    });

    res.status(200).json(response);
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
router.post('/update/profile', requireAuth, (
    req: Types.TypedRequest<{},Types.UpdateProfileForm>,
    res: Response<Types.UserProfileImageResponse | Types.ErrorResponse>
) => {
    const parsed = Types.UpdateProfileFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    const { name, profile_image_url } = parsed.data;

    // Mock response
    const response: Types.UserProfileImageResponse = {
        id: MockData.mockUserId,
        name: name,
        role: 'user',
        email: 'user@example.com',
        profile_image_url: profile_image_url,
    };

    res.status(200).json(response);
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
router.post('/update/password', requireAuth, (
    req: Types.TypedRequest<{},Types.UpdatePasswordForm>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const parsed = Types.UpdatePasswordFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    // Mock response (success)
    res.status(200).json(true);
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
    req: Types.TypedRequest<{},Types.UpdateTimezoneForm>,
    res: Response<Types.StatusResponse | Types.ErrorResponse>
) => {
    const parsed = Types.UpdateTimezoneFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    // Mock response
    res.status(200).json({ status: true });
});

/**
 * GET /api/v1/auths/admin/details
 * Access Control: Requires HTTPBearer authentication (JWT token)
 *
 * Get the admin's name and email for display purposes (e.g., support contact info).
 *
 * @returns {Types.AdminDetailsResponse} - admin name and email
 */
router.get('/admin/details', requireAuth, (
    req: Request,
    res: Response<Types.AdminDetailsResponse | Types.ErrorResponse>
) => {
    // Mock response
    res.status(200).json({
        name: 'Admin User',
        email: 'admin@example.com',
    });
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
router.post('/add', requireAdmin, (
    req: Types.TypedRequest<{},Types.AddUserForm>,
    res: Response<Types.SigninResponse | Types.ErrorResponse>
) => {
    const parsed = Types.AddUserFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    const { name, email, profile_image_url, role } = parsed.data;

    // Mock response
    const response: Types.SigninResponse = {
        id: MockData.mockUserId,
        name: name,
        role: role,
        email: email,
        profile_image_url: profile_image_url,
        token: MockData.mockToken,
        token_type: 'Bearer',
    };

    res.status(200).json(response);
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
    res.status(200).json(MockData.mockAdminConfig);
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
    req: Types.TypedRequest<{},Types.AdminConfig>,
    res: Response<Types.AdminConfig | Types.ErrorResponse>
) => {
    const parsed = Types.AdminConfigSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    // TODO: Update admin config in database
    // For now, just echo back the submitted configuration
    res.status(200).json(parsed.data);
});

/* -------------------- EXPORT -------------------- */

export default router;
