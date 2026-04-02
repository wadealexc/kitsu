import { z } from 'zod';
import { type Request } from 'express';

/* -------------------- HELPER TYPES -------------------- */

export const DEFAULT_CHAT_TITLE = "New Chat";

// Generic type for Express requests with typed params, body, and/or query
export type TypedRequest<P = {}, B = any, Q = any> = Request<P, any, B, Q>;

// Chat ID schema (UUID v4 format OR "local:<socket_id>" for temporary chats)
export const ChatIdSchema = z.union([
    z.uuidv4(),  // Permanent chat: UUID v4
    z.string().regex(/^local:[a-zA-Z0-9_-]+$/),  // Temporary chat starts with `local:`
]);
export type ChatId = z.infer<typeof ChatIdSchema>;

// User ID schema (UUID v4 format)
export const UserIdSchema = z.uuidv4();
export type UserId = z.infer<typeof UserIdSchema>;

// Share ID schema (UUID v4 format)
export const ShareIdSchema = z.uuidv4();
export type ShareId = z.infer<typeof ShareIdSchema>;

// Folder ID schema (UUID v4 format)
export const FolderIdSchema = z.uuidv4();
export type FolderId = z.infer<typeof FolderIdSchema>;

// Message ID schema (UUID v4 format)
export const MessageIdSchema = z.uuidv4();
export type MessageId = z.infer<typeof MessageIdSchema>;

// File ID schema (UUID v4 format)
export const FileIdSchema = z.uuidv4();
export type FileId = z.infer<typeof FileIdSchema>;

// Path parameter types
export type ChatIdParams = { id: ChatId };
export type UserIdParams = { userId: UserId };
export type FolderIdParams = { folderId: FolderId };
export type FileIdParams = { fileId: FileId };
export type ShareIdParams = { shareId: ShareId };
export type MessageIdParams = { id: ChatId; messageId: MessageId };

/* -------------------- COMMON SCHEMAS -------------------- */

// Error response (standard format for validation/auth errors)
export const ErrorResponseSchema = z.object({
    detail: z.string(),
    errors: z.array(z.any()).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// Status response (simple success response)
export const StatusResponseSchema = z.object({
    status: z.boolean(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

// User role enum
export const UserRoleSchema = z.enum(['admin', 'user', 'pending']);
export type UserRole = z.infer<typeof UserRoleSchema>;
