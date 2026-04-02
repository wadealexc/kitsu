import { z } from 'zod';

// Version information response
export const VersionInfoSchema = z.object({
    version: z.string(),
    deploymentId: z.string(),
});
export type VersionInfo = z.infer<typeof VersionInfoSchema>;

// Version update information response
export const VersionUpdateInfoSchema = z.object({
    current: z.string(),
    latest: z.string(),
});
export type VersionUpdateInfo = z.infer<typeof VersionUpdateInfoSchema>;
