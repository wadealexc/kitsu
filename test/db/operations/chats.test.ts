import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as Chats from '../../../src/db/operations/chats.js';
import * as Users from '../../../src/db/operations/users.js';
import * as Folders from '../../../src/db/operations/folders.js';
import * as Files from '../../../src/db/operations/files.js';
import type { ChatImportForm, ChatObject, FlattenedMessage } from '../../../src/routes/types.js';
import { currentUnixTimestamp } from '../../../src/db/utils.js';
import { chatFiles } from '../../../src/db/schema.js';

import { 
    createTestDatabase, 
    newUserParams, 
    createTestFileForm, 
    createTestChatObject,
    createTestChatData,
    type TestDatabase 
} from '../../helpers.js';

/* -------------------- TEST HELPERS -------------------- */

/**
 * Creates a chat with a message in its history.
 */
function createChatWithMessage(title: string = 'Test Chat'): Chats.NewChat {
    const messageId = crypto.randomUUID();
    return {
        title: title,
        chat: {
            title: title,
            model: 'test-model',
            history: {
                messages: {
                    [messageId]: {
                        id: messageId,
                        role: 'user',
                        content: 'Hello world',
                        timestamp: currentUnixTimestamp(),
                        parentId: null,
                        childrenIds: [],
                        files: [],
                    },
                },
                currentId: messageId,
            },
            files: [],
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
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
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
            const shared = await Chats.shareChat(created.id, db);
            assert.ok(shared.shareId);

            const retrieved = await Chats.getChatByShareId(shared.shareId, db);

            assert.ok(retrieved);
            assert.strictEqual(retrieved.id, created.id);
            assert.strictEqual(retrieved.shareId, shared.shareId);
        });

        it('should return null for non-existent share_id', async () => {
            const retrieved = await Chats.getChatByShareId('non-existent-share-id', db);

            assert.strictEqual(retrieved, null);
        });
    });

    describe('getChatsByUserId', () => {
        it('should retrieve all chats for user', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);

            const result = await Chats.getChatsByUserId(userId, db);

            assert.ok(result.length == 2);
        });

        it('should sort by updatedAt DESC', async () => {
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

            const result = await Chats.getChatsByUserId(userId, db);
            assert.strictEqual(result[0]!.id, chat2.id);
            assert.strictEqual(result[1]!.id, chat1.id);
        });
    });

    describe('getChatTitleListByUserId', () => {
        it('should retrieve minimal chat info (title, id, timestamps)', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);

            const chats = await Chats.getChatTitleListByUserId(userId, {}, db);

            assert.ok(chats.length >= 2);
            assert.ok(chats[0]!.id);
            assert.ok(chats[0]!.title);
            assert.ok(chats[0]!.updatedAt);
            assert.ok(chats[0]!.createdAt);
        });

        // TODO - uncomment when archival operations are implemented
        // it('should exclude archived chats by default', async () => {
        //     const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
        //     const chat2 = await Chats.createChat(userId, createTestChatData('Archived Chat'), db);
        //     await Chats.updateChatArchivedById(chat2.id, db);

        //     const chats = await Chats.getChatTitleListByUserId(userId, {}, db);

        //     assert.ok(chats.some(c => c.id === chat1.id));
        //     assert.ok(!chats.some(c => c.id === chat2.id));
        // });

        // it('should include archived chats when requested', async () => {
        //     const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
        //     const chat2 = await Chats.createChat(userId, createTestChatData('Archived Chat'), db);
        //     await Chats.updateChatArchivedById(chat2.id, db);

        //     const chats = await Chats.getChatTitleListByUserId(userId, {
        //         includeArchived: true
        //     }, db);

        //     assert.ok(chats.some(c => c.id === chat1.id));
        //     assert.ok(chats.some(c => c.id === chat2.id));
        // });

        it('should exclude chats in folders by default', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            const chat1 = await Chats.createChat(userId, createTestChatData('Root Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Folder Chat', folder.id), db);

            const chats = await Chats.getChatTitleListByUserId(userId, {}, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(!chats.some(c => c.id === chat2.id));
        });

        it('should include chats in folders when requested', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            const chat1 = await Chats.createChat(userId, createTestChatData('Root Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Folder Chat', folder.id), db);

            const chats = await Chats.getChatTitleListByUserId(userId, {
                includeFolders: true
            }, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(chats.some(c => c.id === chat2.id));
        });

        // TODO - uncomment when pinning is implemented
        // it('should exclude pinned chats by default', async () => {
        //     const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
        //     const chat2 = await Chats.createChat(userId, createTestChatData('Pinned Chat'), db);
        //     await Chats.updateChatPinnedById(chat2.id, db);

        //     const chats = await Chats.getChatTitleListByUserId(userId, {}, db);

        //     assert.ok(chats.some(c => c.id === chat1.id));
        //     assert.ok(!chats.some(c => c.id === chat2.id));
        // });

        // it('should include pinned chats when requested', async () => {
        //     const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
        //     const chat2 = await Chats.createChat(userId, createTestChatData('Pinned Chat'), db);
        //     await Chats.updateChatPinnedById(chat2.id, db);

        //     const chats = await Chats.getChatTitleListByUserId(userId, {
        //         includePinned: true
        //     }, db);

        //     assert.ok(chats.some(c => c.id === chat1.id));
        //     assert.ok(chats.some(c => c.id === chat2.id));
        // });

        it('should support pagination', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);
            await Chats.createChat(userId, createTestChatData('Chat 3'), db);

            const page1 = await Chats.getChatTitleListByUserId(userId, {
                skip: 0,
                limit: 2
            }, db);

            assert.strictEqual(page1.length, 2);
        });
    });

    describe('getChatsByFolderIdAndUserId', () => {
        it('should retrieve chats in specific folder', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            const chat1 = await Chats.createChat(userId, createTestChatData('Chat in Folder', folder.id), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Chat in Root'), db);

            const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);

            assert.ok(chats.some(c => c.id === chat1.id));
            assert.ok(!chats.some(c => c.id === chat2.id));
        });

        // TODO - uncomment when archiving/pinning is supported
        // it('should exclude archived chats', async () => {
        //     const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
        //     const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);
        //     await Chats.updateChatArchivedById(chat.id, db);

        //     const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);

        //     assert.ok(!chats.some(c => c.id === chat.id));
        // });

        // it('should exclude pinned chats', async () => {
        //     const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
        //     const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);
        //     await Chats.updateChatPinnedById(chat.id, db);

        //     const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);

        //     assert.ok(!chats.some(c => c.id === chat.id));
        // });

        it('should verify user ownership', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            const chats = await Chats.getChatsByFolderIdAndUserId([folder.id], otherUser.id, {}, db);

            assert.strictEqual(chats.length, 0);
        });

        it('should support pagination', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
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

            const updatedData: Chats.UpdateChat = {
                chat: {
                    title: 'Updated Title'
                }
            }
            const updated = await Chats.updateChat(chat.id, updatedData, db);

            assert.ok(updated);
            assert.strictEqual(updated.title, 'Updated Title');
            assert.ok(updated.updatedAt > originalUpdatedAt);
        });

        it('should merge chat data', async () => {
            const chat = await Chats.createChat(userId, createChatWithMessage('Original'), db);
            const originalChat = chat.chat;

            const messageId = Object.keys(originalChat.history!.messages)[0]!;
            const updatedData: Chats.UpdateChat = {
                chat: createTestChatObject('Updated', 'new-model'),
                folderId: null,
            };
            updatedData.chat.history = originalChat.history;

            const updated = await Chats.updateChat(chat.id, updatedData, db);

            assert.ok(updated);
            const updatedChat = updated.chat;
            assert.strictEqual(updatedChat.title, 'Updated');
            assert.deepStrictEqual(updatedChat.model, 'new-model');
            // Original message should still exist
            assert.ok(updatedChat.history!.messages[messageId]);
        });

        it('should update folder_id when provided', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const updatedData: Chats.UpdateChat = {
                chat: {},
                folderId: folder.id,
            };

            const updated = await Chats.updateChat(chat.id, updatedData, db);

            assert.ok(updated);
            assert.strictEqual(updated.folderId, folder.id);
        });

        it('should throw for non-existent chat', async () => {
            await assert.rejects(
                async () => await Chats.updateChat('non-existent-id', { chat: {} }, db),
                { message: `chat record with id 'non-existent-id' not found` }
            );
        });
    });

    describe('updateChatFolder', () => {
        it('should move chat to folder', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const updated = await Chats.updateChatFolder(chat.id, userId, folder.id, db);

            assert.ok(updated);
            assert.strictEqual(updated.folderId, folder.id);
        });

        it('should clear folder_id when set to null', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

            const updated = await Chats.updateChatFolder(chat.id, userId, null, db);

            assert.ok(updated);
            assert.strictEqual(updated.folderId, null);
        });

        // TODO - uncomment when pinned implemented
        // it('should clear pinned status when moving to folder', async () => {
        //     const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
        //     const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
        //     await Chats.updateChatPinnedById(chat.id, db);

        //     const updated = await Chats.updateChatFolder(chat.id, userId, folder.id, db);

        //     assert.ok(updated);
        //     assert.strictEqual(updated.pinned, false);
        // });

        it('should throw if user does not own chat', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            await assert.rejects(
                async () => await Chats.updateChatFolder(chat.id, otherUser.id, folder.id, db),
                { message: `chat record with id '${chat.id}' not found` }
            );
        });
    });

    // TODO - uncomment when pin/archive implemented
    // describe('updateChatPinnedById', () => {
    //     it('should toggle pinned from false to true', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

    //         const updated = await Chats.updateChatPinnedById(chat.id, db);

    //         assert.ok(updated);
    //         assert.strictEqual(updated.pinned, true);
    //     });

    //     it('should toggle pinned from true to false', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         await Chats.updateChatPinnedById(chat.id, db);

    //         const updated = await Chats.updateChatPinnedById(chat.id, db);

    //         assert.ok(updated);
    //         assert.strictEqual(updated.pinned, false);
    //     });

    //     it('should convert null to false before toggling', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         // Pinned defaults to false (or null in schema)

    //         const updated = await Chats.updateChatPinnedById(chat.id, db);

    //         assert.ok(updated);
    //         assert.strictEqual(updated.pinned, true);
    //     });

    //     it('should return null for non-existent chat', async () => {
    //         const updated = await Chats.updateChatPinnedById('non-existent-id', db);

    //         assert.strictEqual(updated, null);
    //     });
    // });

    // describe('updateChatArchivedById', () => {
    //     it('should toggle archived from false to true', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

    //         const updated = await Chats.updateChatArchivedById(chat.id, db);

    //         assert.ok(updated);
    //         assert.strictEqual(updated.archived, true);
    //     });

    //     it('should toggle archived from true to false', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         await Chats.updateChatArchivedById(chat.id, db);

    //         const updated = await Chats.updateChatArchivedById(chat.id, db);

    //         assert.ok(updated);
    //         assert.strictEqual(updated.archived, false);
    //     });

    //     it('should clear folder_id when archiving', async () => {
    //         const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

    //         const updated = await Chats.updateChatArchivedById(chat.id, db);

    //         assert.ok(updated);
    //         assert.strictEqual(updated.archived, true);
    //         assert.strictEqual(updated.folderId, null);
    //     });

    //     it('should restore folder_id when unarchiving', async () => {
    //         const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);
    //         await Chats.updateChatArchivedById(chat.id, db); // Archive (clears folderId)

    //         const updated = await Chats.updateChatArchivedById(chat.id, db); // Unarchive

    //         assert.ok(updated);
    //         assert.strictEqual(updated.archived, false);
    //         // Note: folderId is not restored automatically
    //         assert.strictEqual(updated.folderId, null);
    //     });

    //     it('should return null for non-existent chat', async () => {
    //         const updated = await Chats.updateChatArchivedById('non-existent-id', db);

    //         assert.strictEqual(updated, null);
    //     });
    // });

    describe('deleteChat', () => {
        it('should delete chat with ownership verification', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            await Chats.deleteChat(chat.id, userId, db);

            const retrieved = await Chats.getChatById(chat.id, db);
            assert.strictEqual(retrieved, null);
        });

        it('should throw when attempting to delete chat owned by different user', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            await assert.rejects(
                async () => await Chats.deleteChat(chat.id, otherUser.id, db),
                { message: `chat record with id '${chat.id}' not found` }
            );

            const retrieved = await Chats.getChatById(chat.id, db);
            assert.ok(retrieved);
        });

        it('should return throw for non-existent chat', async () => {
            await assert.rejects(
                async () => await Chats.deleteChat('non-existent-id', userId, db),
                { message: `chat record with id 'non-existent-id' not found` }
            );
        });
    });

    describe('deleteAllChatsByUserId', () => {
        it('should delete all chats for user', async () => {
            await Chats.createChat(userId, createTestChatData('Chat 1'), db);
            await Chats.createChat(userId, createTestChatData('Chat 2'), db);
            await Chats.createChat(userId, createTestChatData('Chat 3'), db);

            await Chats.deleteAllChatsByUserId(userId, db);

            const chats = await Chats.getChatsByUserId(userId, db);
            assert.strictEqual(chats.length, 0);
        });

        it('should not delete chats of other users', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            await Chats.createChat(userId, createTestChatData('User 1 Chat'), db);
            await Chats.createChat(otherUser.id, createTestChatData('User 2 Chat'), db);

            await Chats.deleteAllChatsByUserId(userId, db);

            const user1Chats = await Chats.getChatsByUserId(userId, db);
            const user2Chats = await Chats.getChatsByUserId(otherUser.id, db);

            assert.strictEqual(user1Chats.length, 0);
            assert.strictEqual(user2Chats.length, 1);
        });

        it('should still succeed if user has no chats', async () => {
            const chats = await Chats.getChatsByUserId(userId, db);
            assert.strictEqual(chats.length, 0);

            await Chats.deleteAllChatsByUserId(userId, db);
        });
    });

    /* -------------------- SEARCH & FILTERING -------------------- */

    // TODO - uncomment when search/archive is implemented
    // describe('getChatsByUserIdAndSearchText', () => {
    //     it('should search chats by title', async () => {
    //         await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
    //         await Chats.createChat(userId, createTestChatData('Project Beta'), db);
    //         await Chats.createChat(userId, createTestChatData('Meeting Notes'), db);

    //         const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {}, db);

    //         assert.ok(chats.length >= 2);
    //         assert.ok(chats.every(c => c.title.includes('Project')));
    //     });

    //     it('should exclude archived chats by default', async () => {
    //         const chat1 = await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
    //         const chat2 = await Chats.createChat(userId, createTestChatData('Project Beta'), db);
    //         await Chats.updateChatArchivedById(chat2.id, db);

    //         const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {}, db);

    //         assert.ok(chats.some(c => c.id === chat1.id));
    //         assert.ok(!chats.some(c => c.id === chat2.id));
    //     });

    //     it('should include archived chats when requested', async () => {
    //         const chat1 = await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
    //         const chat2 = await Chats.createChat(userId, createTestChatData('Project Beta'), db);
    //         await Chats.updateChatArchivedById(chat2.id, db);

    //         const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {
    //             includeArchived: true
    //         }, db);

    //         assert.ok(chats.some(c => c.id === chat1.id));
    //         assert.ok(chats.some(c => c.id === chat2.id));
    //     });

    //     it('should support pagination', async () => {
    //         await Chats.createChat(userId, createTestChatData('Project Alpha'), db);
    //         await Chats.createChat(userId, createTestChatData('Project Beta'), db);
    //         await Chats.createChat(userId, createTestChatData('Project Gamma'), db);

    //         const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {
    //             skip: 0,
    //             limit: 2
    //         }, db);

    //         assert.ok(chats.length <= 2);
    //     });

    //     it('should return empty array for no matches', async () => {
    //         await Chats.createChat(userId, createTestChatData('Meeting Notes'), db);

    //         const chats = await Chats.getChatsByUserIdAndSearchText(userId, 'Project', {}, db);

    //         assert.strictEqual(chats.length, 0);
    //     });
    // });

    /* -------------------- FILE OPERATIONS -------------------- */

    describe('insertChatFiles', () => {
        it('should associate files with chat', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const file1 = await Files.createFile(createTestFileForm(userId), db);
            const file2 = await Files.createFile(createTestFileForm(userId), db);

            const cfs = await Chats.insertChatFiles(chat.id, null, [file1.id, file2.id], userId, db);

            assert.ok(cfs.length == 2);
            assert.strictEqual(cfs[0]!.fileId, file1.id);
            assert.strictEqual(cfs[1]!.fileId, file2.id);
        });

        it('should associate files with specific message', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const messageId = crypto.randomUUID();
            const file = await Files.createFile(createTestFileForm(userId), db);

            const cfs = await Chats.insertChatFiles(chat.id, messageId, [file.id], userId, db);

            assert.ok(cfs.length == 1);
            assert.strictEqual(cfs[0]!.messageId, messageId);
        });

        it('should prevent duplicate file associations', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const file = await Files.createFile(createTestFileForm(userId), db);

            let cfs = await Chats.insertChatFiles(chat.id, null, [file.id], userId, db);
            assert.strictEqual(cfs.length, 1);
            assert.strictEqual(cfs[0]!.fileId, file.id);

            cfs = await Chats.insertChatFiles(chat.id, null, [file.id], userId, db);
            // Result should be unchanged
            assert.strictEqual(cfs.length, 1);
            assert.strictEqual(cfs[0]!.fileId, file.id);
        });

        it('should return empty array for empty file list', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            const cfs = await Chats.insertChatFiles(chat.id, null, [], userId, db);
            assert.strictEqual(cfs.length, 0);
        });

        it('should throw if attempting to insert a file the user does not own', async () => {
            const otherUser = await Users.createUser(newUserParams(), db);
            const otherUserFile = await Files.createFile(createTestFileForm(otherUser.id), db);
            
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);

            await assert.rejects(
                async () => await Chats.insertChatFiles(chat.id, null, [otherUserFile.id], userId, db),
                { message: `user does not own requested files` }
            );
        });
    });

    
    describe('getChatFiles', () => {
        it('should retrieve files for specific message', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const messageId = crypto.randomUUID();
            const file1 = await Files.createFile(createTestFileForm(userId), db);
            const file2 = await Files.createFile(createTestFileForm(userId), db);

            await Chats.insertChatFiles(chat.id, messageId, [file1.id, file2.id], userId, db);

            const cfs = await Chats.getChatFiles(chat.id, messageId, db);
            assert.ok(cfs.length == 2);
            assert.strictEqual(cfs[0]!.fileId, file1.id);
            assert.strictEqual(cfs[1]!.fileId, file2.id);
        });

        it('should return empty array if no files', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const messageId = crypto.randomUUID();

            const cfs = await Chats.getChatFiles(chat.id, messageId, db);
            assert.strictEqual(cfs.length, 0);
        });

        it('should return files sorted by createdAt ascending', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const messageId = crypto.randomUUID();
            const file1 = await Files.createFile(createTestFileForm(userId), db);
            const file2 = await Files.createFile(createTestFileForm(userId), db);

            // Manually insert old file
            const now = currentUnixTimestamp();
            await db
                .insert(chatFiles)
                .values({
                    id: crypto.randomUUID(),
                    userId: userId,
                    chatId: chat.id,
                    messageId: messageId,
                    fileId: file1.id,
                    createdAt: now - 1000,
                    updatedAt: now - 1000,
                });

            await Chats.insertChatFiles(chat.id, messageId, [file2.id], userId, db);

            const cfs = await Chats.getChatFiles(chat.id, messageId, db);
            assert.ok(cfs[0]!.createdAt <= cfs[1]!.createdAt);
        });
    });

    describe('getSharedChatsByFileId', () => {
        it('should retrieve shared chats using specific file', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            const file = await Files.createFile(createTestFileForm(userId), db);
            await Chats.insertChatFiles(chat.id, null, [file.id], userId, db);
            await Chats.shareChat(chat.id, db);

            const sharedChats = await Chats.getSharedChatsByFileId(file.id, db);

            assert.ok(sharedChats.some(c => c.id === chat.id));
        });

        it('should only return chats with shareId set', async () => {
            const chat1 = await Chats.createChat(userId, createTestChatData('Shared Chat'), db);
            const chat2 = await Chats.createChat(userId, createTestChatData('Private Chat'), db);
            const file = await Files.createFile(createTestFileForm(userId), db);

            await Chats.insertChatFiles(chat1.id, null, [file.id], userId, db);
            await Chats.insertChatFiles(chat2.id, null, [file.id], userId, db);

            await Chats.shareChat(chat1.id, db);

            const sharedChats = await Chats.getSharedChatsByFileId(file.id, db);

            assert.ok(sharedChats.some(c => c.id === chat1.id));
            assert.ok(!sharedChats.some(c => c.id === chat2.id));
        });

        it('should return empty array if file not used', async () => {
            const file = await Files.createFile(createTestFileForm(userId), db);

            const sharedChats = await Chats.getSharedChatsByFileId(file.id, db);
            assert.strictEqual(sharedChats.length, 0);
        });
    });

    /* -------------------- SHARING OPERATIONS -------------------- */

    describe('shareChat', () => {
        it('should set shareId', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            assert.strictEqual(chat.shareId, null);
            
            const shared = await Chats.shareChat(chat.id, db);
            assert.ok(shared.shareId);
        });

        it('should return throw for non-existent chat', async () => {
            await assert.rejects(
                async () => await Chats.shareChat('non-existent-id', db),
                { message: `chat record with id 'non-existent-id' not found` }
            );
        });
    });

    describe('unshareChat', () => {
        it('should set shareId to null', async () => {
            const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
            assert.strictEqual(chat.shareId, null);
            
            const shared = await Chats.shareChat(chat.id, db);
            assert.ok(shared.shareId);

            await Chats.unshareChat(chat.id, db);
            const unshared = await Chats.getChatById(chat.id, db);
            assert.ok(unshared);
            assert.strictEqual(unshared.shareId, null);
        });

        it('should return throw for non-existent chat', async () => {
            await assert.rejects(
                async () => await Chats.shareChat('non-existent-id', db),
                { message: `chat record with id 'non-existent-id' not found` }
            );
        });
    });

    /* -------------------- ARCHIVING & PINNING -------------------- */

    // TODO - uncomment when archiving/pinning implemented
    // describe('archiveAllChatsByUserId', () => {
    //     it('should archive all chats for user', async () => {
    //         await Chats.createChat(userId, createTestChatData('Chat 1'), db);
    //         await Chats.createChat(userId, createTestChatData('Chat 2'), db);

    //         const success = await Chats.archiveAllChatsByUserId(userId, db);

    //         assert.strictEqual(success, true);

    //         const result = await Chats.getChatsByUserId(userId, {}, db);
    //         assert.ok(result.items.every(c => c.archived === true));
    //     });

    //     it('should clear folder_id for all archived chats', async () => {
    //         const folder = await Folders.createFolder(userId, { name: 'Test Folder' }, null, db);
    //         await Chats.createChat(userId, createTestChatData('Chat', folder.id), db);

    //         await Chats.archiveAllChatsByUserId(userId, db);

    //         const result = await Chats.getChatsByUserId(userId, {}, db);
    //         assert.ok(result.items.every(c => c.folderId === null));
    //     });

    //     it('should return false if user has no chats', async () => {
    //         const success = await Chats.archiveAllChatsByUserId(userId, db);

    //         assert.strictEqual(success, false);
    //     });
    // });

    // describe('unarchiveAllChatsByUserId', () => {
    //     it('should unarchive all chats for user', async () => {
    //         await Chats.createChat(userId, createTestChatData('Chat 1'), db);
    //         await Chats.createChat(userId, createTestChatData('Chat 2'), db);
    //         await Chats.archiveAllChatsByUserId(userId, db);

    //         const success = await Chats.unarchiveAllChatsByUserId(userId, db);

    //         assert.strictEqual(success, true);

    //         const result = await Chats.getChatsByUserId(userId, {}, db);
    //         assert.ok(result.items.every(c => c.archived === false));
    //     });

    //     it('should return false if user has no chats', async () => {
    //         const success = await Chats.unarchiveAllChatsByUserId(userId, db);

    //         assert.strictEqual(success, false);
    //     });
    // });

    // describe('getArchivedChats', () => {
    //     it('should retrieve only archived chats', async () => {
    //         const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
    //         const chat2 = await Chats.createChat(userId, createTestChatData('Archived Chat'), db);
    //         await Chats.updateChatArchivedById(chat2.id, db);

    //         const archivedChats = await Chats.getArchivedChats(userId, {}, db);

    //         assert.ok(archivedChats.some(c => c.id === chat2.id));
    //         assert.ok(!archivedChats.some(c => c.id === chat1.id));
    //     });

    //     it('should support pagination', async () => {
    //         await Chats.createChat(userId, createTestChatData('Chat 1'), db);
    //         await Chats.createChat(userId, createTestChatData('Chat 2'), db);
    //         await Chats.createChat(userId, createTestChatData('Chat 3'), db);
    //         await Chats.archiveAllChatsByUserId(userId, db);

    //         const page1 = await Chats.getArchivedChats(userId, {
    //             skip: 0,
    //             limit: 2
    //         }, db);

    //         assert.strictEqual(page1.length, 2);
    //     });

    //     it('should return empty array if no archived chats', async () => {
    //         await Chats.createChat(userId, createTestChatData('Chat'), db);

    //         const archivedChats = await Chats.getArchivedChats(userId, {}, db);

    //         assert.strictEqual(archivedChats.length, 0);
    //     });
    // });

    // describe('getPinnedChats', () => {
    //     it('should retrieve only pinned chats', async () => {
    //         const chat1 = await Chats.createChat(userId, createTestChatData('Normal Chat'), db);
    //         const chat2 = await Chats.createChat(userId, createTestChatData('Pinned Chat'), db);
    //         await Chats.updateChatPinnedById(chat2.id, db);

    //         const pinnedChats = await Chats.getPinnedChats(userId, db);

    //         assert.ok(pinnedChats.some(c => c.id === chat2.id));
    //         assert.ok(!pinnedChats.some(c => c.id === chat1.id));
    //     });

    //     it('should exclude archived chats', async () => {
    //         const chat = await Chats.createChat(userId, createTestChatData('Chat'), db);
    //         await Chats.updateChatPinnedById(chat.id, db);
    //         await Chats.updateChatArchivedById(chat.id, db);

    //         const pinnedChats = await Chats.getPinnedChats(userId, db);

    //         assert.ok(!pinnedChats.some(c => c.id === chat.id));
    //     });

    //     it('should return empty array if no pinned chats', async () => {
    //         await Chats.createChat(userId, createTestChatData('Chat'), db);

    //         const pinnedChats = await Chats.getPinnedChats(userId, db);

    //         assert.strictEqual(pinnedChats.length, 0);
    //     });
    // });

    /* -------------------- FOLDER OPERATIONS -------------------- */

    describe('deleteChatsInFolder', () => {
        it('should delete all chats in folder', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);
            await Chats.createChat(userId, createTestChatData('Chat 1', folder.id), db);
            await Chats.createChat(userId, createTestChatData('Chat 2', folder.id), db);

            await Chats.deleteChatsInFolder(userId, folder.id, db);

            const chatsInFolder = await Chats.getChatsByFolderIdAndUserId([folder.id], userId, {}, db);
            assert.strictEqual(chatsInFolder.length, 0);
        });

        it('should not delete chats in other folders', async () => {
            const folder1 = await Folders.createFolder({ userId, name: 'Test Folder 1' }, db);
            const folder2 = await Folders.createFolder({ userId, name: 'Test Folder 2' }, db);
            await Chats.createChat(userId, createTestChatData('Chat 1', folder1.id), db);
            await Chats.createChat(userId, createTestChatData('Chat 2', folder2.id), db);

            await Chats.deleteChatsInFolder(userId, folder1.id, db);

            const chatsInFolder2 = await Chats.getChatsByFolderIdAndUserId([folder2.id], userId, {}, db);
            assert.ok(chatsInFolder2.length > 0);
        });

        it('should still succeed if folder is empty', async () => {
            const folder = await Folders.createFolder({ userId, name: 'Test Folder' }, db);

            await Chats.deleteChatsInFolder(userId, folder.id, db);
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
