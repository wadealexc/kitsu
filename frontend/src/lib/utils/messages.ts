import type { ChatHistory, ChatMessage, ToolCallBlock } from '@backend/routes/types';
import type { AssistantMessage, ToolMessage } from '@backend/protocol';

/**
 * appendMessage — inserts message into history, links parent/child.
 *
 * Generates a UUID, inserts the message into history.messages,
 * links it to its parent's childrenIds, and sets history.currentId.
 * Mutates `history` in place.
 */
export const appendMessage = (
    history: ChatHistory,
    message: Omit<ChatMessage, 'id' | 'childrenIds' | 'timestamp'>
): ChatMessage => {
    const id = crypto.randomUUID();
    const fullMessage: ChatMessage = {
        ...message,
        id,
        childrenIds: [],
        timestamp: Math.floor(Date.now() / 1000)
    };

    history.messages[id] = fullMessage;
    history.currentId = id;

    if (fullMessage.parentId !== null && history.messages[fullMessage.parentId]) {
        history.messages[fullMessage.parentId].childrenIds = [
            ...history.messages[fullMessage.parentId].childrenIds,
            id
        ];
    }

    return fullMessage;
};

export const createMessagesList = (
    history: ChatHistory,
    messageId: string | null | undefined
): ChatMessage[] => {
    if (messageId === null || messageId === undefined) {
        return [];
    }

    const message: ChatMessage = history.messages[messageId];

    if (message.parentId) {
        return [...createMessagesList(history, message.parentId), message];
    } else {
        return [message];
    }
};

/**
 * expandMessageBlocks — expands ChatMessage blocks to OAI messages.
 *
 * Converts a ChatMessage with typed blocks into the OpenAI message
 * format: assistant messages with tool_calls, followed by tool result messages.
 * Consecutive tool_call blocks are batched into one assistant message's tool_calls array.
 */
export const expandMessageBlocks = (message: ChatMessage): (AssistantMessage | ToolMessage)[] => {
    if (!message.blocks?.length) {
        return [{ role: 'assistant' as const, content: message.content }];
    }

    const result: (AssistantMessage | ToolMessage)[] = [];
    let currentReasoning = '';
    let currentContent = '';
    let pendingToolCalls: ToolCallBlock[] = [];

    for (let i = 0; i < message.blocks.length; i++) {
        const block = message.blocks[i];

        if (block.type === 'reasoning') {
            currentReasoning += (currentReasoning ? '\n' : '') + block.content;
        } else if (block.type === 'content') {
            currentContent += block.content;
        } else if (block.type === 'tool_call') {
            pendingToolCalls.push(block);
        }

        // Flush tool calls when next block is not a tool_call (or end of blocks)
        const nextBlock = message.blocks[i + 1];
        if (pendingToolCalls.length > 0 && nextBlock?.type !== 'tool_call') {
            const assistantMsg: AssistantMessage = {
                role: 'assistant',
                content: currentContent,
                ...(currentReasoning ? { reasoning_content: currentReasoning } : {}),
                tool_calls: pendingToolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: tc.arguments }
                }))
            };
            result.push(assistantMsg);
            for (const tc of pendingToolCalls) {
                result.push({
                    role: 'tool' as const,
                    tool_call_id: tc.id,
                    content: tc.result ?? ''
                });
            }
            currentReasoning = '';
            currentContent = '';
            pendingToolCalls = [];
        }
    }

    // Final assistant message with content + any trailing reasoning
    result.push({
        role: 'assistant' as const,
        content: message.content,
        ...(currentReasoning ? { reasoning_content: currentReasoning } : {})
    });

    return result;
};

/**
 * navigateToLeaf — walks to the deepest last-child of a branch.
 *
 * Given a messageId, follows .childrenIds.at(-1) until a leaf is reached.
 * Returns the leaf messageId.
 */
export const navigateToLeaf = (history: ChatHistory, messageId: string): string => {
    let id = messageId;
    let childrenIds = history.messages[id].childrenIds;

    while (childrenIds.length !== 0) {
        id = childrenIds.at(-1)!;
        childrenIds = history.messages[id].childrenIds;
    }

    return id;
};

/**
 * Get the root message ids of a chat history. These are the top-level
 * user messages, identified because they have no parents.
 */
export const getRootMessageIds = (history: ChatHistory): string[] => {
    return Object.values(history.messages)
        .filter((m) => m.parentId === null)
        .map((m) => m.id);
};

/**
 * Given a message, retrieves its siblings from the ChatHistory
 */
export const getSiblingIds = (history: ChatHistory, message: ChatMessage): string[] => {
    return message.parentId === null
        ? getRootMessageIds(history)
        : history.messages[message.parentId].childrenIds;
};
