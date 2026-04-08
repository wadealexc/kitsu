import { LlamaManager } from '../../llama/llamaManager.js';
import { db, Chats, Models } from '../../db/index.js';
import type { Model } from '../../db/index.js';
import * as proto from '../../protocol/index.js';
import * as Types from '../types/index.js';
import { getLastUserMessage, resolveSystemPrompt, applyPromptVariables, buildOAIMessages } from './messages.js';
import type { ToolRegistry } from '../../tools/registry.js';

/* -------------------- TYPES -------------------- */

export type ChatRequestContext = {
    userId: string;
    chatId: string;
    chat: Types.ChatObject;
    folderId: string | null | undefined;
    userMessage: Types.ChatMessage;
    resolvedModel: string;
    completionBody: proto.CompletionRequest;
    isLocalChat: boolean;
    webSearchEnabled: boolean;
};

/* -------------------- PREPARE REQUEST -------------------- */

/**
 * Validate request and model access
 * Resolve and apply system prompt + variables
 * Build OAI message array
 * Create chat in DB if needed
 *
 * Throws on any validation or access error
 */
export async function prepareRequest(
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
    llama: LlamaManager,
    toolRegistry: ToolRegistry,
): Promise<ChatRequestContext> {
    const parsed = Types.ChatCompletionFormSchema.safeParse(req.body);
    if (!parsed.success)
        throw new Error(`Invalid request body: ${parsed.error.issues}`);

    const userId = req.user!.id;
    const { stream, chatId, chat, folderId, promptVariables } = parsed.data;
    const isLocalChat = chatId.startsWith('local:');

    // Resolve custom model -> base model and fetch params from DB
    let resolvedModel: string = chat.model;
    const customModel: Model | null = await Models.getModelById(resolvedModel, db);
    let params: Partial<Types.ModelParams> = {};
    {
        if (customModel) {
            if (!Models.hasAccess(customModel, userId, 'read'))
                throw new Error(`No access to this model`);

            resolvedModel = customModel.baseModelId;

            // Strip non-OAI fields
            const {
                system: _,
                stream_response: __,
                reasoning_effort: ___,
                chat_template_kwargs: ____,
                ...rest
            } = customModel.params;
            params = rest;
        }

        if (!llama.getModelInfo(resolvedModel))
            throw new Error(`Model not found: ${resolvedModel}`);
    }

    // Get the user's last message and resolve the system prompt
    const userMessage = getLastUserMessage(chat.history);
    const systemPromptTemplate = await resolveSystemPrompt(chat, folderId, customModel, userId);
    const systemPrompt = applyPromptVariables(systemPromptTemplate, promptVariables);

    // Build OAI message array from history
    const oaiMessages = await buildOAIMessages(chat.history, systemPrompt);

    let completionBody: proto.CompletionRequest = {
        model: resolvedModel,
        messages: oaiMessages,
        stream,
        ...params,
    };

    // Inject tool definitions and run beforeRequest hooks
    completionBody = await toolRegistry.prepareTools(
        completionBody,
        { webSearchEnabled: chat.webSearchEnabled ?? false },
    );

    // For non-local chats: create chat in DB if it doesn't exist, and insert file associations
    if (!isLocalChat) {
        const existingChat = await Chats.getChatByIdAndUserId(chatId, userId, db);
        if (!existingChat) {
            await Chats.createChat(userId, {
                id: chatId,
                title: chat.title,
                chat: chat,
                folderId: folderId ?? null,
            }, db);
        }

        if (userMessage.files.length > 0) {
            const fileIds: string[] = userMessage.files
                .filter((f: Types.ChatMessageFile) => f.type === 'file')
                .map((f: Types.ChatMessageFile) => f.id)
                .filter(Boolean);

            if (fileIds.length > 0) {
                try {
                    await Chats.insertChatFiles(chatId, userMessage.id, fileIds, userId, db);
                } catch (error) {
                    console.error('Error inserting chat files:', error);
                    // Don't fail — file associations are metadata, not critical
                }
            }
        }
    }

    return {
        userId,
        chatId,
        chat,
        folderId,
        userMessage,
        resolvedModel,
        completionBody,
        isLocalChat,
        webSearchEnabled: chat.webSearchEnabled ?? false,
    };
}
