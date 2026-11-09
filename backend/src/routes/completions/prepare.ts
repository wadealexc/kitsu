import type { Llama } from '../../llama/types.js';
import { db, Chats, Models } from '../../db/index.js';
import type { Model } from '../../db/index.js';
import * as proto from '../../protocol/index.js';
import * as Types from '../types/index.js';
import { getLastUserMessage, resolveSystemPrompt, applyPromptVariables, buildOAIMessages, createMessagesList } from './messages.js';
import { filesNote, SYSTEM_PROMPT_NOTES, toolsNote } from './notes.js';
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

/* -------------------- BUILD REQUEST -------------------- */

type BuildInput = {
    userId: string;
    chatId: string;
    chat: Types.ChatObject;
    folderId: string | null | undefined;
    promptVariables: Record<string, string>;
    sandboxUploads: string[] | undefined;
    stream: boolean;
};

/**
 * Builds exactly what goes to the inference server for this chat: the system prompt
 * with its variables and notes, the tool list, and the messages. Real requests and
 * the raw view both come through here, so what the raw view shows is what gets sent.
 *
 * Writes nothing to the database. `chat` is updated in place with what a real
 * request would save, such as the notes on the newest message.
 *
 * Throws on any validation or access error
 */
async function buildCompletion(input: BuildInput, llama: Llama, toolRegistry: ToolRegistry) {
    const { userId, chatId, chat, folderId, promptVariables, sandboxUploads, stream } = input;
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

    const existingChat = isLocalChat ? null : await Chats.getChatByIdAndUserId(chatId, userId, db);

    // A sandbox is off unless turned on in this chat. Having been on keeps its files reachable.
    const tools = toolRegistry.tools();
    const sandboxServers = new Set(tools.filter(t => t.sandbox).map(t => t.serverId));
    const sandboxOn = !isLocalChat && chat.sandboxEnabled === true;
    if (sandboxOn || existingChat?.chat.sandboxActivated === true) chat.sandboxActivated = true;

    // Servers turned off for this chat. Older chats only had one web search switch.
    const disabledServers = [
        ...(chat.disabledToolServers ?? (chat.webSearchEnabled === false ? [...new Set(tools.map(t => t.serverId))] : []))
            .filter(id => !sandboxServers.has(id)),
        ...(sandboxOn ? [] : sandboxServers),
    ];

    // Earlier messages read exactly as they were saved: notes the frontend may not
    // have, and finished replies unless the user has edited them.
    if (existingChat) {
        for (const [id, saved] of Object.entries(existingChat.chat.history.messages)) {
            const incoming = chat.history.messages[id];
            if (!incoming) continue;
            if (!incoming.notes && saved.notes?.length) incoming.notes = saved.notes;
            if (id !== chat.history.currentId && saved.role === 'assistant' && saved.done && saved.blocks?.length
                && incoming.content.trim() === saved.content.trim()) {
                incoming.content = saved.content;
                incoming.blocks = saved.blocks;
            }
        }
    }

    // Get the user's last message, and tell the model if the tools it can use changed
    const userMessage = getLastUserMessage(chat.history);
    const earlier = createMessagesList(chat.history, userMessage.parentId);
    const otherNotes = (userMessage.notes ?? []).filter(n => n.kind !== 'tools');
    const note = toolsNote(earlier, disabledServers, tools);
    const uploads = sandboxOn && sandboxUploads?.length && !otherNotes.some(n => n.kind === 'files') ? filesNote(sandboxUploads) : undefined;
    const notes = [...otherNotes, ...(note ? [note] : []), ...(uploads ? [uploads] : [])];
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

    return { userMessage, resolvedModel, completionBody, isLocalChat, disabledServers, existingChat };
}

/* -------------------- PREPARE REQUEST -------------------- */

/**
 * Validates a completion request, builds what it will send, and creates the chat
 * in the database if it's new.
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
    const { stream, chatId, chat, folderId, promptVariables, sandboxUploads } = parsed.data;

    const built = await buildCompletion({ userId, chatId, chat, folderId, promptVariables, sandboxUploads, stream }, llama, toolRegistry);

    // For non-local chats: create chat in DB if it doesn't exist
    if (!built.isLocalChat && !built.existingChat) {
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
        userMessage: built.userMessage,
        resolvedModel: built.resolvedModel,
        completionBody: built.completionBody,
        isLocalChat: built.isLocalChat,
        disabledServers: built.disabledServers,
    };
}

/* -------------------- PREVIEW -------------------- */

/**
 * What the next message in this chat would send, for the raw view. Saves nothing.
 *
 * It runs the same build as a real request, with a blank message standing in for
 * the one the user hasn't written yet. That message is left out of the result, and
 * any notes kitsu would attach to it come back separately.
 */
export async function previewRequest(
    req: Types.TypedRequest<{}, Types.ChatCompletionForm>,
    llama: Llama,
    toolRegistry: ToolRegistry,
): Promise<Types.CompletionPreview> {
    const parsed = Types.ChatCompletionFormSchema.safeParse(req.body);
    if (!parsed.success)
        throw new Error(`Invalid request body: ${parsed.error.issues.toString()}`);

    const { stream, chatId, chat, folderId, promptVariables, sandboxUploads } = parsed.data;

    const nextId = 'preview-next-message';
    const replyId = 'preview-next-reply';
    const blank = { childrenIds: [], content: '', files: [], timestamp: Date.now(), done: false };
    chat.history.messages[nextId] = { ...blank, id: nextId, parentId: chat.history.currentId ?? null, role: 'user' } as Types.ChatMessage;
    chat.history.messages[replyId] = { ...blank, id: replyId, parentId: nextId, role: 'assistant' } as Types.ChatMessage;
    chat.history.currentId = replyId;

    const { completionBody } = await buildCompletion({ userId: req.user!.id, chatId, chat, folderId, promptVariables, sandboxUploads, stream }, llama, toolRegistry);

    const next = completionBody.messages.at(-1);
    return {
        request: { ...completionBody, messages: completionBody.messages.slice(0, -1) },
        nextMessageNotes: typeof next?.content === 'string' && next.content.trim() ? next.content.trim() : null,
    };
}
