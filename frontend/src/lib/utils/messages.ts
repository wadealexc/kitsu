import type { ChatHistory, ChatMessage } from '@backend/routes/types';

/**
 * appendMessage — inserts message into history, links parent/child.
 *
 * Generates a UUID, inserts the message into history.messages,
 * links it to its parent's childrenIds, and sets history.currentId.
 * Mutates `history` in place.
 */
export function appendMessage(
    history: ChatHistory,
    message: Omit<ChatMessage, 'id' | 'childrenIds' | 'timestamp'>
): ChatMessage {
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

export function createMessagesList(
    history: ChatHistory,
    messageId: string | null | undefined
): ChatMessage[] {
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
 * navigateToLeaf — walks to the deepest last-child of a branch.
 *
 * Given a messageId, follows .childrenIds.at(-1) until a leaf is reached.
 * Returns the leaf messageId.
 */
export function navigateToLeaf(history: ChatHistory, messageId: string): string {
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
export function getRootMessageIds(history: ChatHistory): string[] {
    return Object.values(history.messages)
        .filter((m) => m.parentId === null)
        .map((m) => m.id);
};

/**
 * Given a message, retrieves its siblings from the ChatHistory
 */
export function getSiblingIds(history: ChatHistory, message: ChatMessage): string[] {
    return message.parentId === null
        ? getRootMessageIds(history)
        : history.messages[message.parentId].childrenIds;
};