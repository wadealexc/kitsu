/**
 * User Management Routes
 *
 * Handles user account management, search/listing, personal settings,
 * permissions management, and profile operations.
 */

import { Router, type Response, type NextFunction } from 'express';
import * as Types from './types.js';
import * as MockData from './mock-data.js';
import { requireAuth, requireAdmin, validateUserId } from './middleware.js';

const router = Router();

/* -------------------- ADMIN ENDPOINTS -------------------- */

/**
 * GET /api/v1/users/
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * List users with pagination, filtering, and sorting. Returns users with their group IDs.
 *
 * @query {Types.UserListQuery} - query parameters for filtering and pagination
 * @returns {Types.UserGroupIdsListResponse} - paginated list of users with group IDs
 */
router.get('/', requireAdmin, (
    req: Types.TypedRequest<{}, any, Types.UserListQuery>,
    res: Response<Types.UserGroupIdsListResponse | Types.ErrorResponse>
) => {
    // Validate query parameters
    const queryValidation = Types.UserListQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: queryValidation.error.issues });
    }

    const { page } = queryValidation.data;
    const pageSize = 30;

    // Convert users to UserGroupIdsModel format
    const usersWithGroups: Types.UserGroupIdsModel[] = MockData.mockUsers.map(user => ({
        ...user,
        group_ids: [],
    }));

    res.status(200).json({
        users: usersWithGroups,
        total: usersWithGroups.length,
    });
});

/**
 * GET /api/v1/users/all
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Get all users without pagination. Returns basic user info for each user.
 *
 * @returns {Types.UserInfoListResponse} - list of all users
 */
router.get('/all', requireAdmin, (
    req: Types.TypedRequest,
    res: Response<Types.UserInfoListResponse | Types.ErrorResponse>
) => {
    const userInfos: Types.UserInfoResponse[] = MockData.mockUsers.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status_emoji: user.status_emoji,
        status_message: user.status_message,
        status_expires_at: user.status_expires_at,
    }));

    res.status(200).json({
        users: userInfos,
        total: userInfos.length,
    });
});

/**
 * POST /api/v1/users/{user_id}/update
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Update a user's profile, role, email, and optionally password.
 *
 * @param {string} user_id - User ID to update
 * @param {Types.UserUpdateForm} - Updated user data
 * @returns {Types.UserModel | null} - updated user or null
 */
router.post('/:user_id/update', validateUserId, requireAdmin, (
    req: Types.TypedRequest<Types.UserIdParams, Types.UserUpdateForm>,
    res: Response<Types.UserModel | null | Types.ErrorResponse>
) => {
    const userId = req.params.user_id;
    const parsed = Types.UserUpdateFormSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    // Find user
    const user = MockData.mockUsers.find(u => u.id === userId);
    if (!user) {
        return res.status(404).json({ detail: 'User not found' });
    }

    // TODO: Update user in database
    // Return updated user
    res.status(200).json({
        ...user,
        role: parsed.data.role,
        name: parsed.data.name,
        email: parsed.data.email,
        profile_image_url: parsed.data.profile_image_url,
        updated_at: Math.floor(Date.now() / 1000),
    });
});

/**
 * DELETE /api/v1/users/{user_id}
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Delete a user account. Cannot delete the primary admin.
 *
 * @param {string} user_id - User ID to delete
 * @returns {boolean} - true if deletion successful
 */
router.delete('/:user_id', validateUserId, requireAdmin, (
    req: Types.TypedRequest<Types.UserIdParams>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const userId = req.params.user_id;

    // Prevent deleting first user (primary admin)
    if (userId === MockData.MOCK_ADMIN_USER_ID) {
        return res.status(403).json({ detail: 'Cannot delete primary admin' });
    }

    // TODO: Delete user from database
    // Check if user exists
    const userIndex = MockData.mockUsers.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ detail: 'User not found' });
    }

    // Return success
    res.status(200).json(true);
});

/**
 * GET /api/v1/users/default/permissions
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Get the default permissions template for new users.
 *
 * @returns {Types.UserPermissions} - default permissions
 */
router.get('/default/permissions', requireAdmin, (
    req: Types.TypedRequest,
    res: Response<Types.UserPermissions | Types.ErrorResponse>
) => {
    res.status(200).json(MockData.mockDefaultPermissions);
});

/**
 * POST /api/v1/users/default/permissions
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Update the default permissions template for new users.
 *
 * @param {Types.UserPermissions} - new default permissions
 * @returns {object} - empty response
 */
router.post('/default/permissions', requireAdmin, (
    req: Types.TypedRequest<{}, Types.UserPermissions>,
    res: Response<Record<string, never> | Types.ErrorResponse>
) => {
    const parsed = Types.UserPermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    // TODO: Update default permissions in database
    // For now, just return empty object
    res.status(200).json({});
});

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/v1/users/{user_id}
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Get detailed information about a specific user, including their active status and groups.
 *
 * @param {string} user_id - User ID to retrieve
 * @returns {Types.UserActiveResponse} - user details with active status
 */
router.get('/:user_id', validateUserId, requireAuth, (
    req: Types.TypedRequest<Types.UserIdParams>,
    res: Response<Types.UserActiveResponse | Types.ErrorResponse>
) => {
    const userId = req.params.user_id;

    // Find user
    const user = MockData.mockUsers.find(u => u.id === userId);
    if (!user) {
        return res.status(404).json({ detail: 'User not found' });
    }

    // Build response
    const response: Types.UserActiveResponse = {
        name: user.name,
        profile_image_url: user.profile_image_url,
        groups: [],
        is_active: true,  // Mock: all users are active
        status_emoji: user.status_emoji,
        status_message: user.status_message,
        status_expires_at: user.status_expires_at,
    };

    res.status(200).json(response);
});

/**
 * GET /api/v1/users/search
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Search users with pagination and filtering.
 *
 * @query {Types.UserListQuery} - query parameters for filtering and pagination
 * @returns {Types.UserInfoListResponse} - paginated list of users
 */
router.get('/search', requireAuth, (
    req: Types.TypedRequest<{}, any, Types.UserListQuery>,
    res: Response<Types.UserInfoListResponse | Types.ErrorResponse>
) => {
    // Validate query parameters
    const queryValidation = Types.UserListQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
        return res.status(400).json({ detail: 'Invalid query parameters', errors: queryValidation.error.issues });
    }

    const { page } = queryValidation.data;

    const userInfos: Types.UserInfoResponse[] = MockData.mockUsers.map(user => ({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status_emoji: user.status_emoji,
        status_message: user.status_message,
        status_expires_at: user.status_expires_at,
    }));

    res.status(200).json({
        users: userInfos,
        total: userInfos.length,
    });
});

/**
 * GET /api/v1/users/permissions
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Get the current authenticated user's computed permissions.
 *
 * @returns {Types.UserPermissions} - user permissions
 */
router.get('/permissions', requireAuth, (
    req: Types.TypedRequest,
    res: Response<Types.UserPermissions | Types.ErrorResponse>
) => {
    // Mock: return default permissions (in real impl, would compute based on user/group)
    res.status(200).json(MockData.mockDefaultPermissions);
});

/**
 * GET /api/v1/users/user/settings
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Get the current authenticated user's settings (UI preferences, etc.).
 *
 * @returns {Types.UserSettings | null} - user settings
 */
router.get('/user/settings', requireAuth, (
    req: Types.TypedRequest,
    res: Response<Types.UserSettings | null | Types.ErrorResponse>
) => {
    res.status(200).json(MockData.mockUserSettings);
});

/**
 * POST /api/v1/users/user/settings/update
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Update the current authenticated user's settings.
 *
 * @param {Types.UserSettings} - updated settings
 * @returns {Types.UserSettings} - updated settings
 */
router.post('/user/settings/update', requireAuth, (
    req: Types.TypedRequest<{}, Types.UserSettings>,
    res: Response<Types.UserSettings | Types.ErrorResponse>
) => {
    const parsed = Types.UserSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ detail: 'Invalid request body', errors: parsed.error.issues });
    }

    // TODO: Update user settings in database
    // For now, just echo back the submitted settings
    res.status(200).json(parsed.data);
});

/**
 * GET /api/v1/users/user/info
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Get the current authenticated user's custom info object (arbitrary JSON data).
 *
 * @returns {object | null} - user info object
 */
router.get('/user/info', requireAuth, (
    req: Types.TypedRequest,
    res: Response<Record<string, any> | null | Types.ErrorResponse>
) => {
    res.status(200).json(MockData.mockUserInfo);
});

/**
 * POST /api/v1/users/user/info/update
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Update the current authenticated user's custom info object.
 *
 * @param {object} - updated info object
 * @returns {object | null} - updated info object
 */
router.post('/user/info/update', requireAuth, (
    req: Types.TypedRequest<{}, Record<string, any>>,
    res: Response<Record<string, any> | null | Types.ErrorResponse>
) => {
    // TODO: Update user info in database
    // For now, just echo back the submitted info
    res.status(200).json(req.body);
});

/**
 * GET /api/v1/users/{user_id}/profile/image
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Get a user's profile image. Returns redirect (HTTP URLs), streaming image data (data URIs),
 * or default fallback image.
 *
 * @param {string} user_id - User ID whose profile image to retrieve
 * @returns {Response} - 302 redirect, image stream, or default image file
 */
router.get('/:user_id/profile/image', validateUserId, requireAuth, (
    req: Types.TypedRequest<Types.UserIdParams>,
    res: Response
) => {
    const userId = req.params.user_id;

    // Find user
    const user = MockData.mockUsers.find(u => u.id === userId);
    if (!user) {
        return res.status(400).json({ detail: 'User not found' });
    }

    // HTTP URL: return 302 redirect
    if (user.profile_image_url.startsWith('http')) {
        return res.redirect(302, user.profile_image_url);
    }

    // Data URI: decode and stream image
    if (user.profile_image_url.startsWith('data:image')) {
        try {
            // Parse data URI: "data:image/png;base64,iVBORw0KG..."
            const [header, base64Data] = user.profile_image_url.split(',', 2);
            if (!header || !base64Data) {
                throw new Error('Invalid data URI format');
            }

            // Extract media type from header (e.g., "image/png")
            const mediaType = header.split(';')[0]?.replace('data:', '');
            if (!mediaType) throw new Error('Invalid data URI format');

            // Decode base64 data
            const imageData = Buffer.from(base64Data, 'base64');

            // Stream image with appropriate content type
            res.setHeader('Content-Type', mediaType);
            res.setHeader('Content-Disposition', 'inline');
            return res.status(200).send(imageData);
        } catch (error) {
            // If data URI parsing fails, fall through to default image
        }
    }

    // Fallback: return default user.png
    // TODO: In production, return actual static file
    // For now, return mock response indicating fallback
    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(Buffer.from('mock-default-user-image'));
});

/* -------------------- EXPORT -------------------- */

export default router;
