import { z } from 'zod';
import parse, { type StringValue } from 'ms';

import { UserIdSchema, UserRoleSchema } from './common.js';

// Signin
export const SigninFormSchema = z.object({
    username: z.string(),
    password: z.string(),
});
export type SigninForm = z.infer<typeof SigninFormSchema>;

// Signup
export const SignupFormSchema = z.object({
    username: z.string(),
    password: z.string(),
});
export type SignupForm = z.infer<typeof SignupFormSchema>;

// Signout
export const SignoutResponseSchema = z.object({
    status: z.boolean(),
    redirectUrl: z.string().nullable().optional(),
});
export type SignoutResponse = z.infer<typeof SignoutResponseSchema>;

// Session responses
export const SessionUserResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
    token: z.string(),
    tokenType: z.string(),
    expiresAt: z.number().nullable().optional(),
});
export type SessionUserResponse = z.infer<typeof SessionUserResponseSchema>;

// Profile update
export const UpdateProfileFormSchema = z.object({
    username: z.string(),
});
export type UpdateProfileForm = z.infer<typeof UpdateProfileFormSchema>;

export const UpdateProfileResponseSchema = z.object({
    id: UserIdSchema,
    username: z.string(),
    role: UserRoleSchema,
});
export type UpdateProfileResponse = z.infer<typeof UpdateProfileResponseSchema>;

// Password update
export const UpdatePasswordFormSchema = z.object({
    password: z.string(),
    newPassword: z.string(),
});
export type UpdatePasswordForm = z.infer<typeof UpdatePasswordFormSchema>;

// Admin config
const MsStringValueSchema = z.custom<StringValue>((v) => {
    if (v === '-1') return true;

    try {
        const n = parse(v as StringValue);
        return typeof n === "number" && Number.isFinite(n);
    } catch {
        return false;
    }
}, {
    message: 'Must be a valid ms time string (e.g. "1d", "2h", "30m", "2 days", "1 mo")',
});

export const AdminConfigSchema = z.object({
    APP_URL: z.string(),
    ENABLE_SIGNUP: z.boolean(),
    DEFAULT_USER_ROLE: z.enum(['pending', 'user', 'admin']),
    JWT_EXPIRES_IN: MsStringValueSchema,
});
export type AdminConfig = z.infer<typeof AdminConfigSchema>;

// Import config form (for POST /api/v1/configs/import)
export const ImportConfigFormSchema = z.object({
    config: z.record(z.string(), z.any()),
});
export type ImportConfigForm = z.infer<typeof ImportConfigFormSchema>;
