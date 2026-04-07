import { db, Files, Folders } from '../../db/index.js';
import type { Model } from '../../db/index.js';
import { StorageProvider } from '../../storage/provider.js';
import * as proto from '../../protocol/index.js';
import type * as Types from '../types/index.js';

/* -------------------- SYSTEM PROMPT -------------------- */

/**
 * Resolves the system prompt for a completion request using the priority chain:
 *   1. chat.systemPrompt (per-chat override)
 *   2. Folder's data.systemPrompt (resolved via folderId)
 *   3. Model's params.system (from the custom model record)
 *   4. Fallback
 */
export async function resolveSystemPrompt(
    chat: Types.ChatObject,
    folderId: string | null | undefined,
    customModel: Model | null,
    userId: string,
): Promise<string> {
    if (chat.systemPrompt) return chat.systemPrompt;

    if (folderId) {
        const folder = await Folders.getFolderById(folderId, userId, db);
        if (folder?.data?.systemPrompt) return folder.data.systemPrompt;
    }

    if (customModel?.params?.system) return customModel.params.system;

    console.error(`[resolveSystemPrompt]: empty system prompt!`);
    return 'You are a helpful assistant.';
}

/**
 * Applies template variable substitution to a resolved system prompt.
 * All variable values must already be serialized to strings.
 *
 * Example: `{{USER_NAME}}` → username
 */
export function applyPromptVariables(
    template: string,
    variables: Record<string, string>,
): string {
    let result = template;
    for (const [key, value] of Object.entries(variables))
        result = result.replaceAll(key, value);

    return result;
}

/* -------------------- MESSAGE BUILDING -------------------- */

/**
 * Builds the OAI message array from a chat history for a completion request.
 *
 * Steps:
 *   1. Derives the current user message from history.currentId → parentId
 *   2. Walks the parentId chain to get a linear message list (root → user message)
 *   3. Prepends the system message
 *   4. Converts each history message to OAI format inline:
 *      - User: handles file attachments (images resolved to base64, text files as text parts)
 *      - Assistant: expands MessageBlocks to assistant + tool messages
 *
 * @param history - The chat history tree
 * @param systemPrompt - The resolved, variable-applied system prompt
 * @returns Ordered OAI message array ready for the completion request
 */
export async function buildOAIMessages(
    history: Types.ChatHistory,
    systemPrompt: string,
): Promise<proto.Message[]> {
    // Derive the user message from the assistant placeholder's parentId
    const assistantPlaceholderId = history.currentId;
    if (!assistantPlaceholderId) {
        return [{ role: 'system', content: systemPrompt }];
    }

    const assistantPlaceholder = history.messages[assistantPlaceholderId];
    if (!assistantPlaceholder) {
        return [{ role: 'system', content: systemPrompt }];
    }

    const userMessageId = assistantPlaceholder.parentId;
    const messageList = createMessagesList(history, userMessageId);

    const oaiMessages: proto.Message[] = [{ role: 'system', content: systemPrompt }];

    for (const message of messageList) {
        if (message.role === 'system') {
            oaiMessages.push({ role: 'system', content: message.content });
        } else if (message.role === 'assistant') {
            oaiMessages.push(...expandMessageBlocks(message));
        } else {
            oaiMessages.push(...await buildUserMessage(message));
        }
    }

    return oaiMessages;
}

/**
 * Given a message history, looks for the last user-submitted message
 * 
 * @note this assumes history.currentId is basically a "blank" assistant
 * message, as that's what our frontend creates before starting a completion
 * request. It's a little messy.
 */
export function getLastUserMessage(history: Types.ChatHistory): Types.ChatMessage {
    const currentMsgId = history.currentId;
    if (!currentMsgId)
        throw new Error(`chat history has no currentId`);

    const assistantMessage = history.messages[currentMsgId];
    if (!assistantMessage) 
        throw new Error(`currentId message not found in history`);

    const userMessageId = assistantMessage.parentId;
    if (!userMessageId) 
        throw new Error(`currentId message has no parentId`);

    const userMessage = history.messages[userMessageId];
    if (!userMessage || userMessage.role !== 'user') 
        throw new Error(`last user message not found in history`);

    return userMessage;
};

/* -------------------- HELPERS -------------------- */

/**
 * Walks the parentId chain from messageId back to the root,
 * returning messages in order from root to messageId.
 */
function createMessagesList(
    history: Types.ChatHistory,
    messageId: string | null | undefined,
): Types.ChatMessage[] {
    if (messageId === null || messageId === undefined) return [];

    const message = history.messages[messageId];
    if (!message) return [];

    if (message.parentId) {
        return [...createMessagesList(history, message.parentId), message];
    } else {
        return [message];
    }
}

/**
 * Converts an assistant ChatMessage's blocks into OAI assistant + tool messages.
 * Consecutive tool_call blocks are batched into one assistant message's tool_calls array.
 */
function expandMessageBlocks(
    message: Types.ChatMessage,
): (proto.AssistantMessage | proto.ToolMessage)[] {
    if (!message.blocks?.length) {
        return [{ role: 'assistant', content: message.content }];
    }

    const result: (proto.AssistantMessage | proto.ToolMessage)[] = [];
    let currentReasoning = '';
    let currentContent = '';
    let pendingToolCalls: Types.ToolCallBlock[] = [];

    for (let i = 0; i < message.blocks.length; i++) {
        const block = message.blocks[i];
        if (!block) continue;

        if (block.type === 'reasoning') {
            currentReasoning += (currentReasoning ? '\n' : '') + block.content;
        } else if (block.type === 'content') {
            currentContent += block.content;
        } else if (block.type === 'tool_call') {
            pendingToolCalls.push(block);
        }

        // Flush tool calls when the next block is not a tool_call (or end of blocks)
        const nextBlock = message.blocks[i + 1];
        if (pendingToolCalls.length > 0 && nextBlock?.type !== 'tool_call') {
            const assistantMsg: proto.AssistantMessage = {
                role: 'assistant',
                content: currentContent,
                ...(currentReasoning ? { reasoning_content: currentReasoning } : {}),
                tool_calls: pendingToolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: tc.arguments },
                })),
            };
            result.push(assistantMsg);
            for (const tc of pendingToolCalls) {
                result.push({
                    role: 'tool' as const,
                    tool_call_id: tc.id,
                    content: tc.result ?? '',
                });
            }
            currentReasoning = '';
            currentContent = '';
            pendingToolCalls = [];
        }
    }

    // Final assistant message with content + any trailing reasoning
    result.push({
        role: 'assistant',
        content: message.content,
        ...(currentReasoning ? { reasoning_content: currentReasoning } : {}),
    });

    return result;
}

/**
 * Converts a user ChatMessage to OAI user message(s), resolving image file IDs
 * to base64 data URLs inline and encoding text file attachments as text parts.
 */
async function buildUserMessage(message: Types.ChatMessage): Promise<proto.UserMessage[]> {
    const imageFiles = message.files.filter(
        (file) => file.type === 'image' || file.contentType.startsWith('image/')
    );
    const textFiles = message.files.filter(
        (file) =>
            file.type !== 'image' &&
            !file.contentType.startsWith('image/') &&
            file.content
    );

    if (imageFiles.length === 0 && textFiles.length === 0) {
        return [{ role: 'user', content: message.content }];
    }

    const imageParts: proto.ContentPart[] = await Promise.all(
        imageFiles.map(file => resolveImageFilePart(file.url))
    );

    const textFileParts: proto.ContentPart[] = textFiles.map((file) => ({
        type: 'text' as const,
        text: `[File: ${file.name}]\n${file.content}`,
    }));

    return [{
        role: 'user',
        content: [
            { type: 'text', text: message.content },
            ...imageParts,
            ...textFileParts,
        ],
    }];
}

/**
 * Resolves a single image file URL to an OAI image content part.
 *
 * If the URL is already a data: or http(s): URL it is used directly.
 * Otherwise it is treated as a file ID and resolved to a base64 data URL.
 * Falls back to a text placeholder if the file cannot be found.
 */
async function resolveImageFilePart(url: string): Promise<proto.ContentPart> {
    if (
        url.startsWith('data:') ||
        url.startsWith('http://') ||
        url.startsWith('https://')
    ) {
        return { type: 'image_url', image_url: { url } };
    }

    // Treat as file ID
    const file = await Files.getFileById(url, db);
    if (!file || !file.path) {
        console.warn(`[buildOAIMessages] file not found for id: ${url}`);
        return { type: 'text', text: '[image unavailable]' };
    }

    const buffer = await StorageProvider.downloadFile(file.path);
    const contentType = file.meta?.contentType ?? 'image/png';
    const base64 = buffer.toString('base64');

    return {
        type: 'image_url',
        image_url: { url: `data:${contentType};base64,${base64}` },
    };
}
