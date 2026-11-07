import type { Llama } from '../../llama/types.js';
import { db, Chats, Models } from '../../db/index.js';
import type { Model } from '../../db/index.js';
import * as proto from '../../protocol/index.js';
import * as Types from '../types/index.js';
import { getLastUserMessage, resolveSystemPrompt, applyPromptVariables, buildOAIMessages, createMessagesList } from './messages.js';
import { SYSTEM_PROMPT_NOTES, toolsNote } from './notes.js';
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
    /** MCP server ids the user turned off for this chat */
    disabledServers: string[];
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
    llama: Llama,
    toolRegistry: ToolRegistry,
): Promise<ChatRequestContext> {
    const parsed = Types.ChatCompletionFormSchema.safeParse(req.body);
    if (!parsed.success)
        throw new Error(`Invalid request body: ${parsed.error.issues.toString()}`);

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

        if (!await llama.getModelInfo(resolvedModel))
            throw new Error(`Model not found: ${resolvedModel}`);
    }

    const tools = toolRegistry.tools();

    // Servers turned off for this chat. Older chats only had one web search switch.
    const disabledServers = chat.disabledToolServers
        ?? (chat.webSearchEnabled === false ? [...new Set(tools.map(t => t.serverId))] : []);

    // Notes the frontend may not have: keep the saved copy so earlier messages
    // read exactly as before.
    const existingChat = isLocalChat ? null : await Chats.getChatByIdAndUserId(chatId, userId, db);
    if (existingChat) {
        for (const [id, saved] of Object.entries(existingChat.chat.history.messages)) {
            const incoming = chat.history.messages[id];
            if (incoming && !incoming.notes && saved.notes?.length) incoming.notes = saved.notes;
        }
    }

    // Get the user's last message, and tell the model if the tools it can use changed
    const userMessage = getLastUserMessage(chat.history);
    const earlier = createMessagesList(chat.history, userMessage.parentId);
    const otherNotes = (userMessage.notes ?? []).filter(n => n.kind !== 'tools');
    const note = toolsNote(earlier, disabledServers, tools);
    const notes = note ? [...otherNotes, note] : otherNotes;
    if (notes.length) userMessage.notes = notes;
    else delete userMessage.notes;

    // Resolve the system prompt. The notes explanation is always added, so it never changes.
    const systemPromptTemplate = await resolveSystemPrompt(chat, folderId, customModel, userId);
    const systemPrompt = applyPromptVariables(systemPromptTemplate, promptVariables) + SYSTEM_PROMPT_NOTES;

    // Build OAI message array from history
    const oaiMessages = buildOAIMessages(chat.history, systemPrompt);

    // Every tool goes out on every request, whatever is turned off, so the prompt cache holds.
    const toolDefinitions = toolRegistry.getToolDefinitions();
    const completionBody: proto.CompletionRequest = {
        model: resolvedModel,
        messages: oaiMessages,
        stream,
        ...params,
        ...(toolDefinitions.length ? { tools: toolDefinitions } : {}),
    };

    // For non-local chats: create chat in DB if it doesn't exist
    if (!isLocalChat && !existingChat) {
        await Chats.createChat(userId, {
            id: chatId,
            title: chat.title,
            chat: chat,
            folderId: folderId ?? null,
        }, db);
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
        disabledServers,
    };
}
