import { z } from 'zod';

import type { User } from '../../db/index.js';
import { UserIdSchema, UserRoleSchema } from './common.js';

// User settings (UI preferences)
export const UserSettingsSchema = z.object({
    ui: z.record(z.string(), z.any()).optional().default({}),
}).passthrough();
export type UserSettings = z.infer<typeof UserSettingsSchema>;

// User info response (basic subset)
export const UserInfoResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
});
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;

// User info list response
export const UserInfoListResponseSchema = z.object({
    users: z.array(UserInfoResponseSchema),
    total: z.number(),
});
export type UserInfoListResponse = z.infer<typeof UserInfoListResponseSchema>;

// User model list response (uses DB User type directly)
export type UserModelListResponse = {
    users: User[];
    total: number;
};

// User active response
export const UserActiveResponseSchema = z.object({
    username: z.string(),
    isActive: z.boolean(),
});
export type UserActiveResponse = z.infer<typeof UserActiveResponseSchema>;

// User update form (admin operation)
export const UserUpdateFormSchema = z.object({
    role: UserRoleSchema,
    username: z.string(),
    password: z.string().optional(),
});
export type UserUpdateForm = z.infer<typeof UserUpdateFormSchema>;

// User list/search query parameters
export const UserListQuerySchema = z.object({
    query: z.string().optional(),
    orderBy: z.enum(['role', 'username', 'lastActiveAt', 'createdAt']).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;
