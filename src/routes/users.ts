import { Router, type Response, type NextFunction } from 'express';

import * as Types from './types.js';
import { requireAuth, requireAdmin, validateUserId } from './middleware.js';
import { db } from '../db/client.js';
import * as Users from '../db/operations/users.js';
import type { User } from '../db/operations/users.js';
import * as Auths from '../db/operations/auths.js';
import type { UserRole } from './types.js';
import { HttpError, NotFoundError, ForbiddenError, BadRequestError } from './errors.js';

const router = Router();

/* -------------------- ADMIN ENDPOINTS -------------------- */

/**
 * GET /api/v1/users/
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * List users with pagination, filtering, and sorting
 *
 * @query {Types.UserListQuery} - query parameters for filtering and pagination
 * @returns {Types.UserModelListResponse} - paginated list of users
 */
router.get('/', requireAdmin, async (
    req: Types.TypedRequest<{}, any, Types.UserListQuery>,
    res: Response<Types.UserModelListResponse | Types.ErrorResponse>
) => {
    const query = Types.UserListQuerySchema.safeParse(req.query);
    if (!query.success) {
        return res.status(400).json({
            detail: 'Invalid query parameters',
            errors: query.error.issues
        });
    }

    const { page, query: searchQuery, order_by: orderBy, direction } = query.data;
    const pageSize = 30;
    const skip = (page - 1) * pageSize;

    try {
        const { users, total } = await Users.getUsers({
            query: searchQuery,
            orderBy: orderBy,
            direction,
            skip,
            limit: pageSize,
        }, db);

        // Convert to UserModel format
        const userList: Types.UserModel[] = users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            last_active_at: user.lastActiveAt,
            updated_at: user.updatedAt,
            created_at: user.createdAt,
        }));

        return res.json({
            users: userList,
            total,
        });
    } catch (error) {
        console.error('Get users error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/users/all
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Get all users without pagination. Returns basic user info for each user.
 *
 * @returns {Types.UserInfoListResponse} - list of all users
 * 
 * TODO: UNUSED ON FRONTEND
 */
router.get('/all', requireAdmin, async (
    req: Types.TypedRequest,
    res: Response<Types.UserInfoListResponse | Types.ErrorResponse>
) => {
    try {
        const { users, total } = await Users.getUsers({}, db);

        const userInfos: Types.UserInfoResponse[] = users.map(user => ({
            id: user.id,
            username: user.username,
            role: user.role,
            status_emoji: undefined,
            status_message: undefined,
            status_expires_at: undefined,
        }));

        return res.json({
            users: userInfos,
            total,
        });
    } catch (error) {
        console.error('Get all users error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * POST /api/v1/users/{user_id}/update
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Update a user's profile, role, username, and optionally password.
 *
 * @param {Types.UserIdParams} - User ID to update
 * @param {Types.UserUpdateForm} - Updated user data
 * @returns {Types.UserModel} - updated user
 */
router.post('/:user_id/update', validateUserId, requireAdmin, async (
    req: Types.TypedRequest<Types.UserIdParams, Types.UserUpdateForm>,
    res: Response<Types.UserModel | Types.ErrorResponse>
) => {
    const body = Types.UserUpdateFormSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const userId = req.params.user_id;
    const { role, username, password } = body.data;

    try {
        const updatedUser = await db.transaction(async (tx) => {
            // Get existing user
            const user = await Users.getUserById(userId, tx);
            if (!user) {
                throw NotFoundError('User not found');
            }

            // Even the primary admin is NOT allowed to modify the primary admin's role
            const isPrimary = await Users.isPrimaryAdmin(userId, tx);
            if (isPrimary && role !== 'admin') {
                throw ForbiddenError('Cannot change primary admin role');
            }

            // Other admins are not allowed to modify the primary admin at all
            if (isPrimary && req.user!.id !== userId) {
                throw ForbiddenError('User cannot modify primary admin');
            }

            // Check if username is already taken by another user
            if (username !== user.username) {
                const existingUser = await Users.getUserByUsername(username, tx);
                if (existingUser && existingUser.id !== userId) {
                    throw BadRequestError('Username already taken');
                }
            }

            // Update user table
            const updated = await Users.updateUser(userId, {
                role: role,
                username,
            }, tx);

            // Update auth table (username and optionally password)
            await Auths.updateUsername(userId, username, tx);
            if (password) {
                await Auths.updatePassword(userId, password, tx);
            }

            return updated;
        });

        // Convert to response format
        return res.json({
            id: updatedUser.id,
            username: updatedUser.username,
            role: updatedUser.role,
            last_active_at: updatedUser.lastActiveAt,
            updated_at: updatedUser.updatedAt,
            created_at: updatedUser.createdAt,
        });
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Handle validation errors from operations
        if (error instanceof Error) {
            return res.status(400).json({ detail: error.message });
        }

        console.error('Update user error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * DELETE /api/v1/users/{user_id}
 * Access Control: Requires HTTPBearer authentication and admin role
 *
 * Delete a user account. Cannot delete the primary admin.
 *
 * @param {Types.UserIdParams} - User ID to delete
 * @returns {boolean} - true if deletion successful
 */
router.delete('/:user_id', validateUserId, requireAdmin, async (
    req: Types.TypedRequest<Types.UserIdParams>,
    res: Response<boolean | Types.ErrorResponse>
) => {
    const userId = req.params.user_id;

    try {
        // Check if user exists
        const user = await Users.getUserById(userId, db);
        if (!user) {
            throw NotFoundError('User not found');
        }

        // Delete user (automatically checks primary admin protection)
        await Users.deleteUser(userId, db);

        return res.json(true);
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.statusCode).json({ detail: error.message });
        }

        // Probably triggered by admin protection -- TODO clean up
        if (error instanceof Error) {
            return res.status(403).json({ detail: error.message });
        }

        console.error('Delete user error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- AUTHENTICATED ENDPOINTS -------------------- */

/**
 * GET /api/v1/users/{user_id}
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Get detailed information about a specific user, including their active status and groups.
 *
 * @param {Types.UserIdParams} - User ID to retrieve
 * @returns {Types.UserActiveResponse} - user details with active status
 */
router.get('/:user_id', validateUserId, requireAuth, async (
    req: Types.TypedRequest<Types.UserIdParams>,
    res: Response<Types.UserActiveResponse | Types.ErrorResponse>
) => {
    let userId = req.params.user_id;

    try {
        const user = await Users.getUserById(userId, db);
        if (!user) {
            return res.status(400).json({ detail: 'User not found' });
        }

        // TODO: Check if user is active when activity tracking implemented
        // const isActive = await Users.isUserActive(userId, db);

        const response: Types.UserActiveResponse = {
            username: user.username,
            is_active: true,  // TODO: Replace with actual activity check
        };

        return res.json(response);
    } catch (error) {
        console.error('Get user by id error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
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
    return res.json(req.user!.settings);
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
router.post('/user/settings/update', requireAuth, async (
    req: Types.TypedRequest<{}, Types.UserSettings>,
    res: Response<Types.UserSettings | Types.ErrorResponse>
) => {
    const body = Types.UserSettingsSchema.safeParse(req.body);
    if (!body.success) {
        return res.status(400).json({
            detail: 'Invalid request body',
            errors: body.error.issues
        });
    }

    const userId = req.user!.id;
    let settings = body.data;

    try {
        const updatedSettings = await Users.updateUserSettings(userId, settings, db);
        return res.json(updatedSettings);
    } catch (error) {
        console.error('Update user settings error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/**
 * GET /api/v1/users/user/info
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Get the current authenticated user's custom info object (arbitrary JSON data).
 *
 * @returns {object | null} - user info object
 * 
 * TODO: UNUSED ON FRONTEND
 */
router.get('/user/info', requireAuth, (
    req: Types.TypedRequest,
    res: Response<Record<string, any> | null | Types.ErrorResponse>
) => {
    return res.json(req.user!.info);
});

/**
 * POST /api/v1/users/user/info/update
 * Access Control: Requires HTTPBearer authentication (any verified user)
 *
 * Update the current authenticated user's custom info object.
 *
 * @param {object} - updated info object
 * @returns {object | null} - updated info object
 * 
 * TODO: Used on frontend, but seems to be pointless. Info isn't queried.
 */
router.post('/user/info/update', requireAuth, async (
    req: Types.TypedRequest<{}, Record<string, any>>,
    res: Response<Record<string, any> | null | Types.ErrorResponse>
) => {
    const userId = req.user!.id;
    const info = req.body;

    try {
        const updatedInfo = await Users.updateUserInfo(userId, info, db);
        return res.json(updatedInfo);
    } catch (error) {
        console.error('Update user info error:', error);
        return res.status(500).json({ detail: 'Internal server error' });
    }
});

/* -------------------- EXPORT -------------------- */

export default router;
