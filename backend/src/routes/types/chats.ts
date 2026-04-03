import { z } from 'zod';

import { ChatIdSchema, FolderIdSchema } from './common.js';
import { ModelParamsSchema, type ModelParams } from './models.js';

/* -------------------- CHAT RESPONSE TYPES -------------------- */

// Chat title/ID response (minimal chat info for list views)
export const ChatTitleIdResponseSchema = z.object({
    id: ChatIdSchema,
    title: z.string(),
    updatedAt: z.number(),
    createdAt: z.number(),
});
export type ChatTitleIdResponse = z.infer<typeof ChatTitleIdResponseSchema>;

// Folder chat list item response
export const FolderChatListItemResponseSchema = z.object({
    id: ChatIdSchema,
    title: z.string(),
    updatedAt: z.number(),
});
export type FolderChatListItemResponse = z.infer<typeof FolderChatListItemResponseSchema>;

/* -------------------- CHAT DATA STRUCTURES -------------------- */

// Chat message file attachment
export const ChatMessageFileSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    url: z.string(),
    contentType: z.string(),
    size: z.number(),
    content: z.string().optional(),
}).passthrough();
export type ChatMessageFile = z.infer<typeof ChatMessageFileSchema>;

// Chat message citation/source
export const ChatMessageSourceSchema = z.object({
    source: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
}).passthrough();
export type ChatMessageSource = z.infer<typeof ChatMessageSourceSchema>;

// Chat message usage stats
export const ChatMessageUsageSchema = z.object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
    completion_tokens_per_second: z.number().optional(),
    prompt_tokens_per_second: z.number().optional(),
}).passthrough();
export type ChatMessageUsage = z.infer<typeof ChatMessageUsageSchema>;

/* -------------------- MESSAGE BLOCKS -------------------- */

export const ReasoningBlockSchema = z.object({
    type: z.literal('reasoning'),
    content: z.string(),
    done: z.boolean(),
    duration: z.number().optional(),
});
export type ReasoningBlock = z.infer<typeof ReasoningBlockSchema>;

export const ToolCallBlockSchema = z.object({
    type: z.literal('tool_call'),
    id: z.string(),
    name: z.string(),
    arguments: z.string(),
    result: z.string().optional(),
    done: z.boolean(),
    duration: z.number().optional(),
});
export type ToolCallBlock = z.infer<typeof ToolCallBlockSchema>;

export const ContentBlockSchema = z.object({
    type: z.literal('content'),
    content: z.string(),
    done: z.boolean(),
});
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const MessageBlockSchema = z.discriminatedUnion('type', [
    ReasoningBlockSchema,
    ToolCallBlockSchema,
    ContentBlockSchema,
]);
export type MessageBlock = z.infer<typeof MessageBlockSchema>;

// Individual chat message in history
export const ChatMessageSchema = z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    childrenIds: z.array(z.string()),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    files: z.array(ChatMessageFileSchema).default([]),
    timestamp: z.number(),

    // "Optional" fields:
    model: z.string().optional(),
    modelName: z.string().optional(),
    usage: ChatMessageUsageSchema.optional(),
    done: z.boolean().default(false),
    blocks: z.array(MessageBlockSchema).optional(),
    error: z.union([z.boolean(), z.object({ content: z.string() })]).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat history structure (tree-structured messages)
export const ChatHistorySchema = z.object({
    messages: z.record(z.string(), ChatMessageSchema),
    currentId: z.string().nullable().optional(),
}).passthrough();
export type ChatHistory = z.infer<typeof ChatHistorySchema>;

// Complete chat object (the nested "chat" field)
export interface ChatObject {
    id?: string;
    title: string;
    model: string;
    params?: ModelParams;
    webSearchEnabled?: boolean;
    systemPrompt?: string;
    history: ChatHistory;
    timestamp: number;
}

export const ChatObjectSchema: z.ZodType<ChatObject> = z.object({
    id: z.string().optional(),
    title: z.string(),
    model: z.string(),
    params: ModelParamsSchema.default({}),
    history: ChatHistorySchema,
    timestamp: z.number(),
    webSearchEnabled: z.boolean().optional(),
    systemPrompt: z.string().optional(),
}).passthrough();

export const ChatObjectUpdateSchema = z.object({
    id: z.string(),
    title: z.string(),
    model: z.string(),
    params: ModelParamsSchema,
    history: ChatHistorySchema,
    timestamp: z.number(),
    webSearchEnabled: z.boolean(),
    systemPrompt: z.string(),
}).partial();

// Chat form (for updating chats)
export const ChatFormSchema = z.object({
    chat: ChatObjectUpdateSchema,
    folderId: FolderIdSchema.nullable().optional(),
});
export type ChatForm = z.infer<typeof ChatFormSchema>;

// New Chat Form (for creating chats)
export const NewChatFormSchema = z.object({
    chat: ChatObjectSchema,
    folderId: FolderIdSchema.nullable(),
});
export type NewChatForm = z.infer<typeof NewChatFormSchema>;

// Chat import form
export const ChatImportFormSchema = z.object({
    chat: ChatObjectSchema,
    folderId: FolderIdSchema.nullable().optional(),
    meta: z.record(z.string(), z.any()).optional().default({}),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
});
export type ChatImportForm = z.infer<typeof ChatImportFormSchema>;

// Clone form
export const CloneFormSchema = z.object({
    title: z.string().optional(),
});
export type CloneForm = z.infer<typeof CloneFormSchema>;

// Chat folder ID form
export const ChatFolderIdFormSchema = z.object({
    folderId: FolderIdSchema.nullable().optional(),
});
export type ChatFolderIdForm = z.infer<typeof ChatFolderIdFormSchema>;

// Message form
export const MessageFormSchema = z.object({
    content: z.string(),
});
export type MessageForm = z.infer<typeof MessageFormSchema>;

// Event form
export const EventFormSchema = z.object({
    type: z.string(),
    data: z.record(z.string(), z.any()),
});
export type EventForm = z.infer<typeof EventFormSchema>;

// Query parameters
export const ChatListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    includeFolders: z.stringbool().optional().default(false),
});
export type ChatListQuery = z.infer<typeof ChatListQuerySchema>;

export const UserChatListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    query: z.string().optional(),
    orderBy: z.string().optional(),
    direction: z.enum(['asc', 'desc']).optional(),
});
export type UserChatListQuery = z.infer<typeof UserChatListQuerySchema>;

export const FolderChatListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
});
export type FolderChatListQuery = z.infer<typeof FolderChatListQuerySchema>;

export const ChatUsageStatsQuerySchema = z.object({
    itemsPerPage: z.coerce.number().int().min(1).default(50),
    page: z.coerce.number().int().min(1).default(1),
});
export type ChatUsageStatsQuery = z.infer<typeof ChatUsageStatsQuerySchema>;

/* -------------------- OAI MESSAGE SCHEMAS -------------------- */

export const OAITextContentPartSchema = z.object({
    type: z.literal('text'),
    text: z.string(),
});
export type OAITextContentPart = z.infer<typeof OAITextContentPartSchema>;

export const OAIImageContentPartSchema = z.object({
    type: z.literal('image_url'),
    image_url: z.object({
        url: z.string(),
        detail: z.string().optional(),
    }),
});
export type OAIImageContentPart = z.infer<typeof OAIImageContentPartSchema>;

export const OAIContentPartSchema = z.discriminatedUnion('type', [
    OAITextContentPartSchema,
    OAIImageContentPartSchema,
]);
export type OAIContentPart = z.infer<typeof OAIContentPartSchema>;

export const OAISystemMessageSchema = z.object({
    role: z.union([z.literal('system'), z.literal('developer')]),
    content: z.string(),
});
export type OAISystemMessage = z.infer<typeof OAISystemMessageSchema>;

export const OAIUserMessageSchema = z.object({
    role: z.literal('user'),
    content: z.union([z.string(), z.array(OAIContentPartSchema)]),
});
export type OAIUserMessage = z.infer<typeof OAIUserMessageSchema>;

export const OAIAssistantToolCallSchema = z.object({
    id: z.string(),
    type: z.literal('function'),
    function: z.object({
        name: z.string(),
        arguments: z.string(),
    }),
});
export type OAIAssistantToolCall = z.infer<typeof OAIAssistantToolCallSchema>;

export const OAIAssistantMessageSchema = z.object({
    role: z.literal('assistant'),
    content: z.string(),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(OAIAssistantToolCallSchema).optional(),
});
export type OAIAssistantMessage = z.infer<typeof OAIAssistantMessageSchema>;

export const OAIToolMessageSchema = z.object({
    role: z.literal('tool'),
    tool_call_id: z.string(),
    content: z.string(),
});
export type OAIToolMessage = z.infer<typeof OAIToolMessageSchema>;

export const OAIMessageSchema = z.union([
    OAISystemMessageSchema,
    OAIUserMessageSchema,
    OAIAssistantMessageSchema,
    OAIToolMessageSchema,
]);
export type OAIMessage = z.infer<typeof OAIMessageSchema>;

/* -------------------- COMPLETION FORM -------------------- */

export const ChatCompletionFormSchema = z.object({
    model: z.string(),
    messages: z.array(OAIMessageSchema),
    stream: z.boolean(),
    chatId: ChatIdSchema,
    userMessage: ChatMessageSchema,
    chat: ChatObjectSchema,
    folderId: FolderIdSchema.optional(),
    params: ModelParamsSchema,
    webSearchEnabled: z.boolean(),
    generateTitle: z.boolean(),
});
export type ChatCompletionForm = z.infer<typeof ChatCompletionFormSchema>;
