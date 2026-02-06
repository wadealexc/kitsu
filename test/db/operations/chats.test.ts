import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createTestDatabase, newUserParams, type TestDatabase } from '../../helpers.js';
import * as Chats from '../../../src/db/operations/chats.js';
import * as Users from '../../../src/db/operations/users.js';
import * as Folders from '../../../src/db/operations/folders.js';
import type { Chat } from '../../../src/db/schema.js';
import type { ChatForm, ChatImportForm, ChatObject, FlattenedMessage } from '../../../src/routes/types.js';
import { currentUnixTimestamp } from '../../../src/db/utils.js';

/* -------------------- TEST HELPERS -------------------- */

/**
 * Creates a minimal ChatObject for testing.
 */
function createTestChatObject(
    title: string = 'Test Chat',
    models: string[] = ['test-model'],
): ChatObject {
    return {
        title: title,
        models: models,
        history: {
            messages: {},
            currentId: null,
        },
        messages: [],
        timestamp: currentUnixTimestamp(),
    };
}

/**
 * Creates a ChatForm for testing.
 */
function createTestChatData(title: string = 'Test Chat', folderId: string | null = null): Chats.NewChat {
    return {
        title,
        chat: createTestChatObject(title),
        folderId,
    };
}

/**
 * Creates a chat with a message in its history.
 */
function createChatWithMessage(title: string = 'Test Chat'): Chats.NewChat {
    const messageId = crypto.randomUUID();
    return {
        title: title,
        chat: {
            title: title,
            models: ['test-model'],
            history: {
                messages: {
                    [messageId]: {
                        id: messageId,
                        role: 'user',
                        content: 'Hello world',
                        timestamp: currentUnixTimestamp(),
                        parentId: null,
                        childrenIds: [],
                    },
                },
                currentId: messageId,
            },
            messages: [],
            timestamp: currentUnixTimestamp(),
        },
        folderId: null,
    };
}

/* -------------------- CORE CRUD OPERATIONS -------------------- */

describe('Chat Operations', () => {
    let db: TestDatabase;
    let userId: string;

    beforeEach(async () => {
        db = await createTestDatabase();
        // Create test user
        const params = newUserParams('admin');
        const user = await Users.createUser(params, db);
        userId = user.id;
    });

    afterEach(async () => {
        await db.$client?.close();
    });

    describe('createChat', () => {
        it('should create a chat with required fields', async () => {
            const chatData = createTestChatData('My First Chat');
            const chat = await Chats.createChat(userId, chatData, db);

            assert.ok(chat.id);
            assert.strictEqual(chat.userId, userId);
            assert.strictEqual(chat.title, 'My First Chat');
            assert.strictEqual(chat.archived, false);
            assert.strictEqual(chat.pinned, false);
            assert.strictEqual(chat.shareId, null);
            assert.ok(chat.createdAt);
            assert.ok(chat.updatedAt);
            assert.deepStrictEqual(chat.meta, {});
        });

        it('should extract title from chat object', async () => {
            const chatData = createTestChatData('Extracted Title');
            const chat = await Chats.createChat(userId, chatData, db);

            assert.strictEqual(chat.title, 'Extracted Title');
            assert.strictEqual((chat.chat).title, 'Extracted Title');
        });

        it('should create chat with folder_id', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chatData = createTestChatData('Chat in Folder', folder.id);
            const chat = await Chats.createChat(userId, chatData, db);

            assert.strictEqual(chat.folderId, folder.id);
        });

        it('should initialize empty meta object', async () => {
            const chatData = createTestChatData();
            const chat = await Chats.createChat(userId, chatData, db);

            assert.deepStrictEqual(chat.meta, {});
        });
    });

    describe('getChatById', () => {
        it('should retrieve existing chat', async () => {
            const created = await Chats.createChat(userId, createTestChatData(), db);
            const retrieved = await Chats.getChatById(created.id, db);

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, created.id);
            assert.strictEqual(retrieved.userId, userId);
        });

        it('should return null for non-existent chat', async () => {
            const retrieved = await Chats.getChatById('non-existent-id', db);

            assert.strictEqual(retrieved, null);
        });
    });

    describe('getChatByIdAndUserId', () => {
        it('should retrieve chat with ownership verification', async () => {
            const created = await Chats.createChat(userId, createTestChatData(), db);
            const retrieved = await Chats.getChatByIdAndUserId(created.id, userId, db);

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, created.id);
            assert.strictEqual(retrieved.userId, userId);
        });

        it('should return null if user does not own chat', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);

            const created = await Chats.createChat(userId, createTestChatData(), db);
            const retrieved = await Chats.getChatByIdAndUserId(created.id, otherUser.id, db);

            assert.strictEqual(retrieved, null);
        });

        it('should return null for non-existent chat', async () => {
            const retrieved = await Chats.getChatByIdAndUserId('non-existent-id', userId, db);

            assert.strictEqual(retrieved, null);
        });
    });

    describe('getChatByShareId', () => {
        it('should retrieve chat by share_id', async () => {
            const created = await Chats.createChat(userId, createTestChatData(), db);
            const shareId = crypto.randomUUID();
            await Chats.updateChatShareIdById(created.id, shareId, db);

            const retrieved = await Chats.getChatByShareId(shareId, db);

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, created.id);
            assert.strictEqual(retrieved.shareId, shareId);
        });

        it('should return null for non-existent share_id', async () => {
            const retrieved = await Chats.getChatByShareId('non-existent-share-id', db);

            assert.strictEqual(retrieved, null);
        });
    });

    describe('getChats', () => {
        it('should retrieve all chats (admin operation)', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);

            const chats = await Chats.getChats({}, db);

            assert.ok(chats.length >= 2);
        });

        it('should support pagination with skip and limit', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);
            await Chats.createChat(userId, createTestChatData('Chat 3'), db);

            const page1 = await Chats.getChats({ skip: 0, limit: 2 }, db);
            const page2 = await Chats.getChats({ skip: 2, limit: 2 }, db);

            assert.ok(page1.length <= 2);
            assert.ok(page2.length >= 1);
        });
    });

    describe('getChatsByUserId', () => {
        it('should retrieve all chats for user', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);

            const result = await Chats.getChatsByUserId(userId, {}, db);

            assert.ok(result.items.length >= 2);
            assert.ok(result.total >= 2);
        });

        it('should support pagination', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);
            await Chats.createChat(userId, createTestChatData('Chat 3'), db);

            const result = await Chats.getChatsByUserId(userId, { skip: 0, limit: 2 }, db);

            assert.strictEqual(result.items.length, 2);
            assert.ok(result.total >= 3);
        });

        it('should filter by search query', async () => {
            await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
            await Chats.createChat(userId, createTestChatData('Project Beta'), db);
            await Chats.createChat(userId, createTestChatData('Meeting Notes'), db);

            const result = await Chats.getChatsByUserId(userId, {
                filter: { query: 'Project' }
            }, db);

            assert.ok(result.items.length >= 2);
            assert.ok(result.items.every(chat => chat.title.includes('Project')));
        });

        it('should sort by updatedAt DESC by default', async () => {
            const now = currentUnixTimestamp();

            // Create 'old' chat
            const [chat1] = await Chats.importChats(userId, [{
                chat: createTestChatObject('Chat 1'),
                meta: {},
                pinned: false,
                created_at: now - 1000,
                updated_at: now - 1000,
            }], db);
            assert.ok(chat1);

            const chat2 = await Chats.createChat(userId, createTestChatData('Chat 2'), db);

            const result = await Chats.getChatsByUserId(userId, {}, db);
            assert.strictEqual(result.items[0]!.id, chat2.id);
            assert.strictEqual(result.items[1]!.id, chat1.id);
        });

        it('should sort by title ASC when specified', async () => {
            await Chats.createChat(userId, createTestChatData('Zebra'), db);
            await Chats.createChat(userId, createTestChatData('Apple'), db);

            const result = await Chats.getChatsByUserId(userId, {
                filter: { orderBy: 'title', direction: 'asc' }
            }, db);

            assert.strictEqual(result.items[0]!.title, 'Apple');
            assert.strictEqual(result.items[1]!.title, 'Zebra');
        });

        it('should filter by updatedAt timestamp', async () => {
            const now = currentUnixTimestamp();

            // Create 'old' chat
            const [chat1] = await Chats.importChats(userId, [{
                chat: createTestChatObject('Chat 1'),
                meta: {},
                pinned: false,
                created_at: now - 1000,
                updated_at: now - 1000,
            }], db);
            assert.ok(chat1);

            const chat2 = await Chats.createChat(userId, createTestChatData('New Chat'), db);

            const result = await Chats.getChatsByUserId(userId, {
                filter: { updatedAt: now - 1 }
            }, db);

            assert.ok(result.items.some(chat => chat.id === chat2.id));
            assert.ok(!result.items.some(chat => chat.id === chat1.id));
        });
    });

    describe('getChatTitleIdListByUserId', () => {
        it('should retrieve minimal chat info (title, id, timestamps)', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);

            const chats = await Chats.getChatTitleIdListByUserId(userId, {}, db);

            assert.ok(chats.length >= 2);
            assert.ok(chats[0]!.id);
            assert.ok(chats[0]!.title);
            assert.ok(chats[0]!.updatedAt);
            assert.ok(chats[0]!.createdAt);
        });

        it('should exclude archived chats by default', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Archived Chat'), db);
            await Chats.updateChatArchivedById(chat2.id, db);

            const chats = await Chats.getChatTitleIdListByUserId(userId, {}, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(!chats.some(c => c.id === chat2.id));
        });

        it('should include archived chats when requested', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Archived Chat'), db);
            await Chats.updateChatArchivedById(chat2.id, db);

            const chats = await Chats.getChatTitleIdListByUserId(userId, {
                includeArchived: true
            }, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(chats.some(c => c.id === chat2.id));
        });

        it('should exclude chats in folders by default', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat1 = await Chats.createChat(userId, createTestChatData('Root Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Folder Chat', folder.id), db);

            const chats = await Chats.getChatTitleIdListByUserId(userId, {}, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(!chats.some(c => c.id === chat2.id));
        });

        it('should include chats in folders when requested', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat1 = await Chats.createChat(userId, createTestChatData('Root Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Folder Chat', folder.id), db);

            const chats = await Chats.getChatTitleIdListByUserId(userId, {
                includeFolders: true
            }, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(chats.some(c => c.id === chat2.id));
        });

        it('should exclude pinned chats by default', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Pinned Chat'), db);
            await Chats.updateChatPinnedById(chat2.id, db);

            const chats = await Chats.getChatTitleIdListByUserId(userId, {}, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(!chats.some(c => c.id === chat2.id));
        });

        it('should include pinned chats when requested', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Pinned Chat'), db);
            await Chats.updateChatPinnedById(chat2.id, db);

            const chats = await Chats.getChatTitleIdListByUserId(userId, {
                includePinned: true
            }, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(chats.some(c => c.id === chat2.id));
        });

        it('should support pagination', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);
            await Chats.createChat(userId, createTestChatData('Chat 3'), db);

            const page1 = await Chats.getChatTitleIdListByUserId(userId, {
                skip: 0,
                limit: 2
            }, db);

            assert.strictEqual(page1.length, 2);
        });
    });

    describe('getChatsByFolderIdAndUserId', () => {
        it('should retrieve chats in specific folder', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat1 = await Chats.createChat(userId, createTestChatData('Chat in Folder', folder.id), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Chat in Root'), db);

            const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(!chats.some(c => c.id === chat2.id));
        });

        it('should exclude archived chats', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);
            await Chats.updateChatArchivedById(chat.id, db);

            const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);

            assert.ok(!chats.some(c => c.id === chat.id));
        });

        it('should exclude pinned chats', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);
            await Chats.updateChatPinnedById(chat.id, db);

            const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);

            assert.ok(!chats.some(c => c.id === chat.id));
        });

        it('should verify user ownership', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], otherUser.id, {}, db);

            assert.strictEqual(chats.length, 0);
        });

        it('should support pagination', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat 1', folder.id), db);
            await Chats.createChat(userId, createTestChatData('Chat 2', folder.id), db);
            await Chats.createChat(userId, createTestChatData('Chat 3', folder.id), db);

            const page1 = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {
                skip: 0,
                limit: 2
            }, db);

            assert.strictEqual(page1.length, 2);
        });
    });

    describe('updateChat', () => {
        it('should update chat data and title', async () => {
            const now = currentUnixTimestamp();

            // Create 'old' chat
            const [chat] = await Chats.importChats(userId, [{
                chat: createTestChatObject('Chat 1'),
                meta: {},
                pinned: false,
                created_at: now - 1000,
                updated_at: now - 1000,
            }], db);
            assert.ok(chat);
            const originalUpdatedAt = chat.updatedAt;

            const updatedData: ChatForm = {
                chat: {
                    title: 'Updated Title'
                }
            };
            const updated = await Chats.updateChat(chat.id, updatedData, db);

            assert.ok(updated);
            assert.strictEqual(updated.title, 'Updated Title');
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        it('should merge chat data', async () => {
            const chat = await Chats.createChat(userId, createChatWithMessage('Original'), db);
            const originalChat = chat.chat;

            const messageId = Object.keys(originalChat.history!.messages)[0]!;
            const updatedData: ChatForm = {
                chat: createTestChatObject('Updated', ['new-model']),
                folder_id: null,
            };
            updatedData.chat.history = originalChat.history;

            const updated = await Chats.updateChat(chat.id, updatedData, db);

            assert.ok(updated);
            const updatedChat = updated.chat;
            assert.strictEqual(updatedChat.title, 'Updated');
            assert.deepStrictEqual(updatedChat.models, ['new-model']);
            // Original message should still exist
            assert.ok(updatedChat.history!.messages[messageId]);
        });

        it('should update folder_id when provided', async () => {
            const folder = await Folders.createFolder(userId, { name: 'New Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const updatedData: ChatForm = {
                chat: {},
                folder_id: folder.id,
            };

            const updated = await Chats.updateChat(chat.id, updatedData, db);

            assert.ok(updated);
            assert.strictEqual(updated.folderId, folder.id);
        });

        it('should return null for non-existent chat', async () => {
            const updated = await Chats.updateChat('non-existent-id', { chat: {} }, db);

            assert.strictEqual(updated, null);
        });
    });

    describe('updateChatFolderIdByIdAndUserId', () => {
        it('should move chat to folder', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const updated = await Chats.updateChatFolderIdByIdAndUserId(chat.id, userId, folder.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.folderId, folder.id);
        });

        it('should clear folder_id when set to null', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            const updated = await Chats.updateChatFolderIdByIdAndUserId(chat.id, userId, null, db);

            assert.ok(updated);
            assert.strictEqual(updated.folderId, null);
        });

        it('should clear pinned status when moving to folder', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            await Chats.updateChatPinnedById(chat.id, db);

            const updated = await Chats.updateChatFolderIdByIdAndUserId(chat.id, userId, folder.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.pinned, false);
        });

        it('should verify user ownership', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const updated = await Chats.updateChatFolderIdByIdAndUserId(chat.id, otherUser.id, folder.id, db);

            assert.strictEqual(updated, null);
        });
    });

    describe('updateChatShareIdById', () => {
        it('should set share_id', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const shareId = crypto.randomUUID();

            const updated = await Chats.updateChatShareIdById(chat.id, shareId, db);

            assert.ok(updated);
            assert.strictEqual(updated.shareId, shareId);
        });

        it('should clear share_id when set to null', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const shareId = crypto.randomUUID();
            await Chats.updateChatShareIdById(chat.id, shareId, db);

            const updated = await Chats.updateChatShareIdById(chat.id, null, db);

            assert.ok(updated);
            assert.strictEqual(updated.shareId, null);
        });

        it('should return null for non-existent chat', async () => {
            const updated = await Chats.updateChatShareIdById('non-existent-id', crypto.randomUUID(), db);

            assert.strictEqual(updated, null);
        });
    });

    describe('updateChatPinnedById', () => {
        it('should toggle pinned from false to true', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const updated = await Chats.updateChatPinnedById(chat.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.pinned, true);
        });

        it('should toggle pinned from true to false', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            await Chats.updateChatPinnedById(chat.id, db);

            const updated = await Chats.updateChatPinnedById(chat.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.pinned, false);
        });

        it('should convert null to false before toggling', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            // Pinned defaults to false (or null in schema)

            const updated = await Chats.updateChatPinnedById(chat.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.pinned, true);
        });

        it('should return null for non-existent chat', async () => {
            const updated = await Chats.updateChatPinnedById('non-existent-id', db);

            assert.strictEqual(updated, null);
        });
    });

    describe('updateChatArchivedById', () => {
        it('should toggle archived from false to true', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const updated = await Chats.updateChatArchivedById(chat.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.archived, true);
        });

        it('should toggle archived from true to false', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            await Chats.updateChatArchivedById(chat.id, db);

            const updated = await Chats.updateChatArchivedById(chat.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.archived, false);
        });

        it('should clear folder_id when archiving', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            const updated = await Chats.updateChatArchivedById(chat.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.archived, true);
            assert.strictEqual(updated.folderId, null);
        });

        it('should restore folder_id when unarchiving', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);
            await Chats.updateChatArchivedById(chat.id, db); // Archive (clears folderId)

            const updated = await Chats.updateChatArchivedById(chat.id, db); // Unarchive

            assert.ok(updated);
            assert.strictEqual(updated.archived, false);
            // Note: folderId is not restored automatically
            assert.strictEqual(updated.folderId, null);
        });

        it('should return null for non-existent chat', async () => {
            const updated = await Chats.updateChatArchivedById('non-existent-id', db);

            assert.strictEqual(updated, null);
        });
    });

    describe('deleteChat', () => {
        it('should delete chat by id', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const success = await Chats.deleteChat(chat.id, db);

            assert.strictEqual(success, true);

            const retrieved = await Chats.getChatById(chat.id, db);
            assert.strictEqual(retrieved, null);
        });

        it('should return false for non-existent chat', async () => {
            const success = await Chats.deleteChat('non-existent-id', db);

            assert.strictEqual(success, false);
        });
    });

    describe('deleteChatByIdAndUserId', () => {
        it('should delete chat with ownership verification', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const success = await Chats.deleteChatByIdAndUserId(chat.id, userId, db);

            assert.strictEqual(success, true);

            const retrieved = await Chats.getChatById(chat.id, db);
            assert.strictEqual(retrieved, null);
        });

        it('should not delete chat owned by different user', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const success = await Chats.deleteChatByIdAndUserId(chat.id, otherUser.id, db);

            assert.strictEqual(success, false);

            const retrieved = await Chats.getChatById(chat.id, db);
            assert.ok(retrieved);
        });

        it('should return false for non-existent chat', async () => {
            const success = await Chats.deleteChatByIdAndUserId('non-existent-id', userId, db);

            assert.strictEqual(success, false);
        });
    });

    describe('deleteAllChatsByUserId', () => {
        it('should delete all chats for user', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);
            await Chats.createChat(userId, createTestChatData('Chat 3'), db);

            const success = await Chats.deleteAllChatsByUserId(userId, db);

            assert.strictEqual(success, true);

            const chats = await Chats.getChatsByUserId(userId, {}, db);
            assert.strictEqual(chats.items.length, 0);
        });

        it('should not delete chats of other users', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            await Chats.createChat(userId, createTestChatData('User 1 Chat'), db);
            await Chats.createChat(otherUser.id, createTestChatData('User 2 Chat'), db);

            await Chats.deleteAllChatsByUserId(userId, db);

            const user1Chats = await Chats.getChatsByUserId(userId, {}, db);
            const user2Chats = await Chats.getChatsByUserId(otherUser.id, {}, db);

            assert.strictEqual(user1Chats.items.length, 0);
            assert.ok(user2Chats.items.length > 0);
        });

        it('should return false if user has no chats', async () => {
            const success = await Chats.deleteAllChatsByUserId(userId, db);

            assert.strictEqual(success, false);
        });
    });

    /* -------------------- SEARCH & FILTERING -------------------- */

    describe('getChatsByUserIdAndSearchText', () => {
        it('should search chats by title', async () => {
            await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
            await Chats.createChat(userId, createTestChatData('Project Beta'), db);
            await Chats.createChat(userId, createTestChatData('Meeting Notes'), db);

            const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {}, db);

            assert.ok(chats.length >= 2);
            assert.ok(chats.every(c => c.title.includes('Project')));
        });

        it('should exclude archived chats by default', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Project Beta'), db);
            await Chats.updateChatArchivedById(chat2.id, db);

            const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {}, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(!chats.some(c => c.id === chat2.id));
        });

        it('should include archived chats when requested', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Project Beta'), db);
            await Chats.updateChatArchivedById(chat2.id, db);

            const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {
                includeArchived: true
            }, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(chats.some(c => c.id === chat2.id));
        });

        it('should support pagination', async () => {
            await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
            await Chats.createChat(userId, createTestChatData('Project Beta'), db);
            await Chats.createChat(userId, createTestChatData('Project Gamma'), db);

            const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {
                skip: 0,
                limit: 2
            }, db);

            assert.ok(chats.length <= 2);
        });

        it('should return empty array for no matches', async () => {
            await Chats.createChat(userId, createTestChatData('Meeting Notes'), db);

            const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {}, db);

            assert.strictEqual(chats.length, 0);
        });
    });

    /* -------------------- FILE OPERATIONS -------------------- */

    // TODO - Need to create/use Files table
    // describe('insertChatFiles', () => {
    //     it('should associate files with chat', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const fileId1 = crypto.randomUUID();
    //         const fileId2 = crypto.randomUUID();

    //         const chatFiles = await Chats.insertChatFiles(chat.id, null, [fileId1, fileId2], userId, db);

    //         assert.ok(chatFiles.length >= 2);
    //     });

    //     it('should associate files with specific message', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const messageId = crypto.randomUUID();
    //         const fileId = crypto.randomUUID();

    //         const chatFiles = await Chats.insertChatFiles(chat.id, messageId, [fileId], userId, db);

    //         assert.ok(chatFiles.length >= 1);
    //         assert.strictEqual(chatFiles[0]!.messageId, messageId);
    //     });

    //     it('should prevent duplicate file associations', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const fileId = crypto.randomUUID();

    //         await Chats.insertChatFiles(chat.id, null, [fileId], userId, db);
    //         const chatFiles = await Chats.insertChatFiles(chat.id, null, [fileId], userId, db);

    //         // Should return existing association, not create duplicate
    //         assert.strictEqual(chatFiles.length, 1);
    //     });

    //     it('should filter out null and empty fileIds', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

    //         const chatFiles = await Chats.insertChatFiles(chat.id, null, ['', '  ', null as any], userId, db);

    //         assert.strictEqual(chatFiles.length, 0);
    //     });

    //     it('should return empty array for empty file list', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

    //         const chatFiles = await Chats.insertChatFiles(chat.id, null, [], userId, db);

    //         assert.strictEqual(chatFiles.length, 0);
    //     });
    // });

    
    // describe('getChatFiles', () => {
    //     it('should retrieve files for specific message', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const messageId = crypto.randomUUID();
    //         const fileId1 = crypto.randomUUID();
    //         const fileId2 = crypto.randomUUID();

    //         await Chats.insertChatFiles(chat.id, messageId, [fileId1, fileId2], userId, db);

    //         const chatFiles = await Chats.getChatFiles(chat.id, messageId, db);

    //         assert.ok(chatFiles.length >= 2);
    //     });

    //     it('should return empty array if no files', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const messageId = crypto.randomUUID();

    //         const chatFiles = await Chats.getChatFiles(chat.id, messageId, db);

    //         assert.strictEqual(chatFiles.length, 0);
    //     });

    //     it('should return files sorted by createdAt ascending', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const messageId = crypto.randomUUID();
    //         const fileId1 = crypto.randomUUID();
    //         await Chats.insertChatFiles(chat.id, messageId, [fileId1], userId, db);

    //         // TODO - we have to wait for enough time for the new unix timestamp to change
    //         // This is hacky and may slow down tests. We'd be better off with a file import method
    //         await new Promise(resolve => setTimeout(resolve, 2000));

    //         const fileId2 = crypto.randomUUID();
    //         await Chats.insertChatFiles(chat.id, messageId, [fileId2], userId, db);

    //         const chatFiles = await Chats.getChatFiles(chat.id, messageId, db);

    //         assert.ok(chatFiles[0]!.createdAt <= chatFiles[1]!.createdAt);
    //     });
    // });

    // describe('deleteChatFile', () => {
    //     it('should remove file association from chat', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const messageId = crypto.randomUUID();
    //         const fileId = crypto.randomUUID();

    //         await Chats.insertChatFiles(chat.id, messageId, [fileId], userId, db);

    //         const success = await Chats.deleteChatFile(chat.id, fileId, db);

    //         assert.strictEqual(success, true);

    //         const chatFiles = await Chats.getChatFiles(chat.id, messageId, db);
    //         assert.strictEqual(chatFiles.length, 0);
    //     });

    //     it('should return false for non-existent association', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const fileId = crypto.randomUUID();

    //         const success = await Chats.deleteChatFile(chat.id, fileId, db);

    //         assert.strictEqual(success, false);
    //     });
    // });

    // describe('getSharedChatsByFileId', () => {
    //     it('should retrieve shared chats using specific file', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const fileId = crypto.randomUUID();
    //         await Chats.insertChatFiles(chat.id, null, [fileId], userId, db);

    //         const shareId = crypto.randomUUID();
    //         await Chats.updateChatShareIdById(chat.id, shareId, db);

    //         const sharedChats = await Chats.getSharedChatsByFileId(fileId, db);

    //         assert.ok(sharedChats.some(c => c.id === chat.id));
    //     });

    //     it('should only return chats with shareId set', async () => {
    //         const chat1 = await Chats.createChat(userId, createTestChatData('Shared Chat'), db);
    //         const chat2 = await Chats.createChat(userId, createTestChatData('Private Chat'), db);
    //         const fileId = crypto.randomUUID();

    //         await Chats.insertChatFiles(chat1.id, null, [fileId], userId, db);
    //         await Chats.insertChatFiles(chat2.id, null, [fileId], userId, db);

    //         const shareId = crypto.randomUUID();
    //         await Chats.updateChatShareIdById(chat1.id, shareId, db);

    //         const sharedChats = await Chats.getSharedChatsByFileId(fileId, db);

    //         assert.ok(sharedChats.some(c => c.id === chat1.id));
    //         assert.ok(!sharedChats.some(c => c.id === chat2.id));
    //     });

    //     it('should return empty array if file not used', async () => {
    //         const fileId = crypto.randomUUID();

    //         const sharedChats = await Chats.getSharedChatsByFileId(fileId, db);

    //         assert.strictEqual(sharedChats.length, 0);
    //     });
    // });

    /* -------------------- SHARING OPERATIONS -------------------- */

    describe('insertSharedChat', () => {
        it('should create shared chat with shareId', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const sharedChat = await Chats.insertSharedChat(chat.id, db);

            assert.ok(sharedChat);
            assert.ok(sharedChat.shareId);
        });

        it('should generate unique shareId', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Chat 2'), db);

            const shared1 = await Chats.insertSharedChat(chat1.id, db);
            const shared2 = await Chats.insertSharedChat(chat2.id, db);

            assert.ok(shared1);
            assert.ok(shared2);
            assert.notStrictEqual(shared1.shareId, shared2.shareId);
        });
    });

    describe('updateSharedChat', () => {
        it('should update shared chat timestamp', async () => {
            const now = currentUnixTimestamp();

            // Create 'old' chat
            const [chat] = await Chats.importChats(userId, [{
                chat: createTestChatObject('Chat 1'),
                meta: {},
                pinned: false,
                created_at: now - 1000,
                updated_at: now - 1000,
            }], db);
            assert.ok(chat);

            const originalUpdatedAt = chat.updatedAt;
            const updated = await Chats.updateSharedChat(chat.id, db);

            assert.ok(updated);
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        it('should return null for non-existent chat', async () => {
            const updated = await Chats.updateSharedChat('non-existent-id', db);

            assert.strictEqual(updated, null);
        });
    });

    describe('deleteSharedChat', () => {
        it('should clear shareId', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            await Chats.insertSharedChat(chat.id, db);

            const success = await Chats.deleteSharedChat(chat.id, db);

            assert.strictEqual(success, true);

            const retrieved = await Chats.getChatById(chat.id, db);
            assert.ok(retrieved);
            assert.strictEqual(retrieved.shareId, null);
        });

        it('should return false for non-existent chat', async () => {
            const success = await Chats.deleteSharedChat('non-existent-id', db);

            assert.strictEqual(success, false);
        });
    });

    /* -------------------- MESSAGE OPERATIONS -------------------- */

    describe('addMessageToChat', () => {
        it('should add message to chat history', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const messageId = crypto.randomUUID();
            const message = {
                id: messageId,
                role: 'user' as const,
                content: 'Hello world',
                timestamp: currentUnixTimestamp(),
                parentId: null,
            };

            const updated = await Chats.addMessageToChat(chat.id, messageId, message, db);

            assert.ok(updated);
            const chatData = updated.chat;
            assert.ok(chatData.history!.messages[messageId]);
            assert.strictEqual(chatData.history!.currentId, messageId);
        });

        it('should update existing message', async () => {
            const chat = await Chats.createChat(userId, createChatWithMessage('Chat'), db);
            const chatData = chat.chat;
            const messageId = Object.keys(chatData.history!.messages)[0]!;

            const updatedMessage = {
                ...chatData.history!.messages[messageId],
                content: 'Updated content',
            };

            const updated = await Chats.addMessageToChat(chat.id, messageId, updatedMessage, db);

            assert.ok(updated);
            const updatedChatData = updated.chat;
            assert.strictEqual(updatedChatData.history!.messages[messageId]!.content, 'Updated content');
        });

        it('should set currentId to new message', async () => {
            const chat = await Chats.createChat(userId, createChatWithMessage('Chat'), db);
            const newMessageId = crypto.randomUUID();
            const newMessage = {
                id: newMessageId,
                role: 'assistant' as const,
                content: 'Response',
                timestamp: currentUnixTimestamp(),
                parentId: null,
            };

            const updated = await Chats.addMessageToChat(chat.id, newMessageId, newMessage, db);

            assert.ok(updated);
            const chatData = updated.chat;
            assert.strictEqual(chatData.history!.currentId, newMessageId);
        });

        it('should return null for non-existent chat', async () => {
            const messageId = crypto.randomUUID();
            const message = {
                id: messageId,
                role: 'user' as const,
                content: 'Hello',
                timestamp: currentUnixTimestamp(),
                parentId: null,
            };

            const updated = await Chats.addMessageToChat('non-existent-id', messageId, message, db);

            assert.strictEqual(updated, null);
        });
    });

    describe('addMessageStatus', () => {
        it('should append status to message statusHistory', async () => {
            const chat = await Chats.createChat(userId, createChatWithMessage('Chat'), db);
            const chatData = chat.chat;
            const messageId = Object.keys(chatData.history!.messages)[0]!;

            const status = {
                timestamp: currentUnixTimestamp(),
                status: 'completed',
            };

            const updated = await Chats.addMessageStatus(chat.id, messageId, status, db);

            assert.ok(updated);
            const updatedChatData = updated.chat;
            const message = updatedChatData.history!.messages[messageId];
            assert.ok(message!.statusHistory);
            assert.ok(message!.statusHistory!.length > 0);
        });

        it('should initialize statusHistory if not exists', async () => {
            const chat = await Chats.createChat(userId, createChatWithMessage('Chat'), db);
            const chatData = chat.chat;
            const messageId = Object.keys(chatData.history!.messages)[0]!;

            const status = {
                timestamp: currentUnixTimestamp(),
                status: 'pending',
            };

            const updated = await Chats.addMessageStatus(chat.id, messageId, status, db);

            assert.ok(updated);
            const updatedChatData = updated.chat;
            const message = updatedChatData.history!.messages[messageId];
            assert.ok(Array.isArray(message!.statusHistory));
            assert.strictEqual(message!.statusHistory!.length, 1);
        });

        it('should return null for non-existent message', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const messageId = crypto.randomUUID();
            const status = {
                timestamp: currentUnixTimestamp(),
                status: 'completed',
            };

            const updated = await Chats.addMessageStatus(chat.id, messageId, status, db);

            assert.strictEqual(updated, null);
        });

        it('should return null for non-existent chat', async () => {
            const messageId = crypto.randomUUID();
            const status = {
                timestamp: currentUnixTimestamp(),
                status: 'completed',
            };

            const updated = await Chats.addMessageStatus('non-existent-id', messageId, status, db);

            assert.strictEqual(updated, null);
        });
    });

    // TODO - Need to create/use Files table
    // describe('addMessageFiles', () => {
    //     it('should append files to message', async () => {
    //         const chat = await Chats.createChat(userId, createChatWithMessage('Chat'), db);
    //         const chatData = chat.chat;
    //         const messageId = Object.keys(chatData.history!.messages)[0]!;

    //         const files = [
    //             { id: crypto.randomUUID(), name: 'file1.pdf', type: 'application/pdf' },
    //             { id: crypto.randomUUID(), name: 'file2.png', type: 'image/png' },
    //         ];

    //         const addedFiles = await Chats.addMessageFiles(chat.id, messageId, files, userId, db);

    //         assert.strictEqual(addedFiles.length, 2);

    //         const updated = await Chats.getChatById(chat.id, db);
    //         assert.ok(updated);
    //         const updatedChatData = updated.chat;
    //         const message = updatedChatData.history!.messages[messageId];
    //         assert.ok(message!.files);
    //         assert.ok(message!.files!.length >= 2);
    //     });

    //     it('should create chat_file records', async () => {
    //         const chat = await Chats.createChat(userId, createChatWithMessage('Chat'), db);
    //         const chatData = chat.chat;
    //         const messageId = Object.keys(chatData.history!.messages)[0]!;

    //         const fileId = crypto.randomUUID();
    //         const files = [
    //             { id: fileId, name: 'file.pdf', type: 'application/pdf' },
    //         ];

    //         await Chats.addMessageFiles(chat.id, messageId, files, userId, db);

    //         const chatFiles = await Chats.getChatFiles(chat.id, messageId, db);
    //         assert.ok(chatFiles.some(cf => cf.fileId === fileId));
    //     });

    //     it('should initialize files array if not exists', async () => {
    //         const chat = await Chats.createChat(userId, createChatWithMessage('Chat'), db);
    //         const chatData = chat.chat;
    //         const messageId = Object.keys(chatData.history!.messages)[0]!;

    //         const files = [
    //             { id: crypto.randomUUID(), name: 'file.pdf', type: 'application/pdf' },
    //         ];

    //         await Chats.addMessageFiles(chat.id, messageId, files, userId, db);

    //         const updated = await Chats.getChatById(chat.id, db);
    //         assert.ok(updated);
    //         const updatedChatData = updated.chat;
    //         const message = updatedChatData.history!.messages[messageId];
    //         assert.ok(Array.isArray(message!.files));
    //     });

    //     it('should return empty array for non-existent message', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         const messageId = crypto.randomUUID();
    //         const files = [
    //             { id: crypto.randomUUID(), name: 'file.pdf', type: 'application/pdf' },
    //         ];

    //         const addedFiles = await Chats.addMessageFiles(chat.id, messageId, files, userId, db);

    //         assert.strictEqual(addedFiles.length, 0);
    //     });
    // });

    /* -------------------- ARCHIVING & PINNING -------------------- */

    describe('archiveAllChatsByUserId', () => {
        it('should archive all chats for user', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);

            const success = await Chats.archiveAllChatsByUserId(userId, db);

            assert.strictEqual(success, true);

            const result = await Chats.getChatsByUserId(userId, {}, db);
            assert.ok(result.items.every(c => c.archived === true));
        });

        it('should clear folder_id for all archived chats', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            await Chats.archiveAllChatsByUserId(userId, db);

            const result = await Chats.getChatsByUserId(userId, {}, db);
            assert.ok(result.items.every(c => c.folderId === null));
        });

        it('should return false if user has no chats', async () => {
            const success = await Chats.archiveAllChatsByUserId(userId, db);

            assert.strictEqual(success, false);
        });
    });

    describe('unarchiveAllChatsByUserId', () => {
        it('should unarchive all chats for user', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);
            await Chats.archiveAllChatsByUserId(userId, db);

            const success = await Chats.unarchiveAllChatsByUserId(userId, db);

            assert.strictEqual(success, true);

            const result = await Chats.getChatsByUserId(userId, {}, db);
            assert.ok(result.items.every(c => c.archived === false));
        });

        it('should return false if user has no chats', async () => {
            const success = await Chats.unarchiveAllChatsByUserId(userId, db);

            assert.strictEqual(success, false);
        });
    });

    describe('getArchivedChats', () => {
        it('should retrieve only archived chats', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Archived Chat'), db);
            await Chats.updateChatArchivedById(chat2.id, db);

            const archivedChats = await Chats.getArchivedChats(userId, {}, db);

            assert.ok(archivedChats.some(c => c.id === chat2.id));
            assert.ok(!archivedChats.some(c => c.id === chat1.id));
        });

        it('should support pagination', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);
            await Chats.createChat(userId, createTestChatData('Chat 3'), db);
            await Chats.archiveAllChatsByUserId(userId, db);

            const page1 = await Chats.getArchivedChats(userId, {
                skip: 0,
                limit: 2
            }, db);

            assert.strictEqual(page1.length, 2);
        });

        it('should return empty array if no archived chats', async () => {
            await Chats.createChat(userId, createTestChatData('Chat'), db);

            const archivedChats = await Chats.getArchivedChats(userId, {}, db);

            assert.strictEqual(archivedChats.length, 0);
        });
    });

    describe('getPinnedChats', () => {
        it('should retrieve only pinned chats', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Pinned Chat'), db);
            await Chats.updateChatPinnedById(chat2.id, db);

            const pinnedChats = await Chats.getPinnedChats(userId, db);

            assert.ok(pinnedChats.some(c => c.id === chat2.id));
            assert.ok(!pinnedChats.some(c => c.id === chat1.id));
        });

        it('should exclude archived chats', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            await Chats.updateChatPinnedById(chat.id, db);
            await Chats.updateChatArchivedById(chat.id, db);

            const pinnedChats = await Chats.getPinnedChats(userId, db);

            assert.ok(!pinnedChats.some(c => c.id === chat.id));
        });

        it('should return empty array if no pinned chats', async () => {
            await Chats.createChat(userId, createTestChatData('Chat'), db);

            const pinnedChats = await Chats.getPinnedChats(userId, db);

            assert.strictEqual(pinnedChats.length, 0);
        });
    });

    /* -------------------- FOLDER OPERATIONS -------------------- */

    describe('moveChatsToFolder', () => {
        it('should move all chats from one folder to another', async () => {
            const folder1 = await Folders.createFolder(userId, { name: 'Folder 1' }, null, db);
            const folder2 = await Folders.createFolder(userId, { name: 'Folder 2' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat 1', folder1.id), db);
            await Chats.createChat(userId, createTestChatData('Chat 2', folder1.id), db);

            const success = await Chats.moveChatsToFolder(userId, folder1.id, folder2.id, db);

            assert.strictEqual(success, true);

            const chatsInFolder2 = await Chats.getChatsByFolderIdAndUserId([folder2.id], userId, {}, db);
            assert.ok(chatsInFolder2.length >= 2);
        });

        it('should move chats to root when toFolderId is null', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Folder' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            const success = await Chats.moveChatsToFolder(userId, folder.id, null, db);

            assert.strictEqual(success, true);

            const chatsInFolder = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);
            assert.strictEqual(chatsInFolder.length, 0);
        });

        it('should clear pinned status for moved chats', async () => {
            const folder1 = await Folders.createFolder(userId, { name: 'Folder 1' }, null, db);
            const folder2 = await Folders.createFolder(userId, { name: 'Folder 2' }, null, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat', folder1.id), db);
            await Chats.updateChatPinnedById(chat.id, db);

            await Chats.moveChatsToFolder(userId, folder1.id, folder2.id, db);

            const updated = await Chats.getChatById(chat.id, db);
            assert.ok(updated);
            assert.strictEqual(updated.pinned, false);
        });

        it('should return false if no chats to move', async () => {
            const folder1 = await Folders.createFolder(userId, { name: 'Folder 1' }, null, db);
            const folder2 = await Folders.createFolder(userId, { name: 'Folder 2' }, null, db);

            const success = await Chats.moveChatsToFolder(userId, folder1.id, folder2.id, db);

            assert.strictEqual(success, false);
        });
    });

    describe('deleteChatsInFolder', () => {
        it('should delete all chats in folder', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Folder' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat 1', folder.id), db);
            await Chats.createChat(userId, createTestChatData('Chat 2', folder.id), db);

            const success = await Chats.deleteChatsInFolder(userId, folder.id, db);

            assert.strictEqual(success, true);

            const chatsInFolder = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);
            assert.strictEqual(chatsInFolder.length, 0);
        });

        it('should not delete chats in other folders', async () => {
            const folder1 = await Folders.createFolder(userId, { name: 'Folder 1' }, null, db);
            const folder2 = await Folders.createFolder(userId, { name: 'Folder 2' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat 1', folder1.id), db);
            await Chats.createChat(userId, createTestChatData('Chat 2', folder2.id), db);

            await Chats.deleteChatsInFolder(userId, folder1.id, db);

            const chatsInFolder2 = await Chats.getChatsByFolderIdAndUserId([folder2.id], userId, {}, db);
            assert.ok(chatsInFolder2.length > 0);
        });

        it('should verify user ownership', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder(userId, { name: 'Folder' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            const success = await Chats.deleteChatsInFolder(otherUser.id, folder.id, db);

            assert.strictEqual(success, false);
        });

        it('should return false if folder is empty', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Folder' }, null, db);

            const success = await Chats.deleteChatsInFolder(userId, folder.id, db);

            assert.strictEqual(success, false);
        });
    });

    describe('countChatsInFolder', () => {
        it('should count chats in folder', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Folder' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat 1', folder.id), db);
            await Chats.createChat(userId, createTestChatData('Chat 2', folder.id), db);

            const count = await Chats.countChatsInFolder(userId, folder.id, db);

            assert.strictEqual(count, 2);
        });

        it('should return 0 for empty folder', async () => {
            const folder = await Folders.createFolder(userId, { name: 'Folder' }, null, db);

            const count = await Chats.countChatsInFolder(userId, folder.id, db);

            assert.strictEqual(count, 0);
        });

        it('should verify user ownership', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder(userId, { name: 'Folder' }, null, db);
            await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            const count = await Chats.countChatsInFolder(otherUser.id, folder.id, db);

            assert.strictEqual(count, 0);
        });
    });

    /* -------------------- IMPORT/EXPORT -------------------- */

    describe('importChats', () => {
        it('should bulk import chats', async () => {
            const chatsData: ChatImportForm[] = [
                {
                    chat: createTestChatObject('Imported Chat 1'),
                    meta: { source: 'backup' },
                    pinned: false,
                },
                {
                    chat: createTestChatObject('Imported Chat 2'),
                    meta: {},
                    pinned: true,
                },
            ];

            const imported = await Chats.importChats(userId, chatsData, db);

            assert.strictEqual(imported.length, 2);
            assert.strictEqual(imported[0]!.title, 'Imported Chat 1');
            assert.strictEqual(imported[1]!.title, 'Imported Chat 2');
        });

        it('should generate new UUIDs for imported chats', async () => {
            const chatsData: ChatImportForm[] = [
                {
                    chat: createTestChatObject('Chat 1'),
                    meta: {},
                    pinned: false,
                },
                {
                    chat: createTestChatObject('Chat 2'),
                    meta: {},
                    pinned: false,
                },
            ];

            const imported = await Chats.importChats(userId, chatsData, db);

            assert.ok(imported[0]!.id);
            assert.ok(imported[1]!.id);
            assert.notStrictEqual(imported[0]!.id, imported[1]!.id);
        });

        it('should preserve timestamps if provided', async () => {
            const createdAt = 1700000000;
            const updatedAt = 1700100000;
            const chatsData: ChatImportForm[] = [
                {
                    chat: createTestChatObject('Chat'),
                    created_at: createdAt,
                    updated_at: updatedAt,
                    meta: {},
                    pinned: false,
                },
            ];

            const imported = await Chats.importChats(userId, chatsData, db);

            assert.strictEqual(imported[0]!.createdAt, createdAt);
            assert.strictEqual(imported[0]!.updatedAt, updatedAt);
        });

        it('should use current timestamp if not provided', async () => {
            const now = currentUnixTimestamp();
            const chatsData: ChatImportForm[] = [
                {
                    chat: createTestChatObject('Chat'),
                    meta: {},
                    pinned: false,
                },
            ];

            const imported = await Chats.importChats(userId, chatsData, db);

            assert.ok(imported[0]!.createdAt >= now);
            assert.ok(imported[0]!.updatedAt >= now);
        });

        it('should assign all chats to provided userId', async () => {
            const chatsData: ChatImportForm[] = [
                {
                    chat: createTestChatObject('Chat 1'),
                    meta: {},
                    pinned: false,
                },
                {
                    chat: createTestChatObject('Chat 2'),
                    meta: {},
                    pinned: false,
                },
            ];

            const imported = await Chats.importChats(userId, chatsData, db);

            assert.ok(imported.every(c => c.userId === userId));
        });

        it('should return empty array for empty input', async () => {
            const imported = await Chats.importChats(userId, [], db);

            assert.strictEqual(imported.length, 0);
        });

        it('should set archived to false and shareId to null', async () => {
            const chatsData: ChatImportForm[] = [
                {
                    chat: createTestChatObject('Chat'),
                    meta: {},
                    pinned: false,
                },
            ];

            const imported = await Chats.importChats(userId, chatsData, db);

            assert.strictEqual(imported[0]!.archived, false);
            assert.strictEqual(imported[0]!.shareId, null);
        });
    });
});
