import type { Model } from '../../db/index.js';
import { db, Folders } from '../../db/index.js';
import * as proto from '../../protocol/index.js';
import type * as Types from '../types/index.js';
import { renderNotes } from './notes.js';

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
 *      - User: handles file attachments (images as base64 data URLs, text as text parts)
 *      - Assistant: expands MessageBlocks to assistant + tool messages
 *
 * @param history - The chat history tree
 * @param systemPrompt - The resolved, variable-applied system prompt
 * @returns Ordered OAI message array ready for the completion request
 */
export function buildOAIMessages(
    history: Types.ChatHistory,
    systemPrompt: string,
): proto.Message[] {
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
            oaiMessages.push(...buildUserMessage(message));
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
export function createMessagesList(
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
): proto.Message[] {
    if (!message.blocks?.length) {
        return [{ role: 'assistant', content: message.content }];
    }

    const { messages, reasoning } = toolRoundMessages(message.blocks);

    // Final assistant message with content + any trailing reasoning
    messages.push({
        role: 'assistant',
        content: message.content,
        ...(reasoning ? { reasoning_content: reasoning } : {}),
    });

    return messages;
}

/**
 * The model turns a reply's tool rounds are made of. The tool loop and every later
 * request both build them here: if the two ever differ, llama.cpp has to process
 * everything after the difference again.
 */
export function toolRoundMessages(
    blocks: Types.MessageBlock[],
): { messages: proto.Message[]; reasoning: string } {
    const result: proto.Message[] = [];
    let currentReasoning = '';
    let currentContent = '';
    let pendingToolCalls: Types.ToolCallBlock[] = [];

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (!block) continue;

        if (block.type === 'reasoning') {
            currentReasoning += (currentReasoning ? '\n' : '') + block.content;
        } else if (block.type === 'content') {
            currentContent += block.content;
        } else if (block.type === 'tool_call') {
            pendingToolCalls.push(block);
        }

        // Flush tool calls when the next block is not a tool_call (or end of blocks)
        // or is from a later round: back-to-back rounds with nothing between them are
        // still separate model turns.
        const nextBlock = blocks[i + 1];
        const sameRound = nextBlock?.type === 'tool_call' && nextBlock.round === pendingToolCalls[0]?.round;
        if (pendingToolCalls.length > 0 && !sameRound) {
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
                    content: tc.failed ? `Error: ${tc.result ?? ''}` : (tc.result ?? ''),
                });
            }

            // Tool messages can't hold images, so the model gets them in a user message.
            const images = pendingToolCalls.flatMap(tc => tc.images ?? []);
            if (images.length > 0) {
                result.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: images.length === 1 ? 'The image from the tool result above:' : 'The images from the tool results above:' },
                        ...images.map((image): proto.ContentPart => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } })),
                    ],
                });
            }
            currentReasoning = '';
            currentContent = '';
            pendingToolCalls = [];
        }
    }

    return { messages: result, reasoning: currentReasoning };
}

/**
 * Converts a user ChatMessage to OAI user message(s), using inline file data.
 * Images use dataUrl directly; text files use content directly.
 */
function buildUserMessage(message: Types.ChatMessage): proto.UserMessage[] {
    const text = message.content + renderNotes(message.notes);

    const imageParts: proto.ContentPart[] = message.files
        .filter((f): f is Extract<Types.ChatMessageFile, { kind: 'image' }> => f.kind === 'image')
        .map(f => ({ type: 'image_url', image_url: { url: f.dataUrl } }));

    const textParts: proto.ContentPart[] = message.files
        .filter((f): f is Extract<Types.ChatMessageFile, { kind: 'text' }> => f.kind === 'text')
        .map(f => ({ type: 'text', text: `[File: ${f.name}]\n${f.content}` }));

    if (imageParts.length === 0 && textParts.length === 0) {
        return [{ role: 'user', content: text }];
    }

    return [{
        role: 'user',
        content: [{ type: 'text', text }, ...imageParts, ...textParts],
    }];
}
