import { describe, test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { assertInMemoryDatabase, createUserWithToken, createTestFolderForm } from '../helpers.js';
import { db } from '../../src/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.js';
import * as Chats from '../../src/db/operations/chats.js';
import { type Chat } from '../../src/db/operations/chats.js';
import * as Folders from '../../src/db/operations/folders.js';
import { type ChatForm, type ChatObject, type FlattenedMessage, type ChatResponse, type NewChatForm } from '../../src/routes/types.js';
import chatsRouter from '../../src/routes/chats.js';
import { currentUnixTimestamp } from '../../src/db/utils.js';

/* -------------------- TEST SETUP -------------------- */

// Ensure tests use in-memory database
assertInMemoryDatabase();

// Apply migrations to the in-memory database
await migrate(db, { migrationsFolder: './drizzle' });

// Helper function to clear database tables
async function clearDatabase() {
    await db.delete(schema.chats);
    await db.delete(schema.folders);
    await db.delete(schema.auths);
    await db.delete(schema.users);
}

// Create Express app with chats routes
const app: Express = express();
app.use(express.json());
app.use(cookieParser());
app.use('/api/v1/chats', chatsRouter);

/* -------------------- HELPER FUNCTIONS -------------------- */


/**
 * Creates a minimal ChatObject for testing.
 */
function createTestChatObject(
    title: string = 'Test Chat',
    model: string = 'test-model',
): ChatObject {
    return {
        title: title,
        model: model,
        history: {
            messages: {},
            currentId: null,
        },
        files: [],
        messages: [],
        timestamp: currentUnixTimestamp(),
    };
}

function createNewChatForm(
    title: string = 'Test Chat',
    model: string = 'gpt-4',
    folderId?: string,
): NewChatForm {
    const chat: ChatObject = {
        title: title,
        model: model,
        history: {
            messages: {},
            currentId: null,
        },
        files: [],
        messages: [],
        timestamp: currentUnixTimestamp(),
    };

    return {
        chat: chat,
        folder_id: folderId ?? null,
    };
}

/**
 * Create a test chat with full message history
 */
async function createTestChat(userId: string, title: string = 'Test Chat'): Promise<Chat> {
    const now = currentUnixTimestamp();
    const model = 'gpt-4';

    const msgId1 = crypto.randomUUID();
    const msg1: FlattenedMessage & { timestamp: number } = {
        role: 'user',
        content: 'Hello',
        timestamp: now - 2000,
        model: model,
    };

    const msgId2 = crypto.randomUUID();
    const msg2: FlattenedMessage & { timestamp: number } = {
        role: 'assistant',
        content: 'Hi there!',
        timestamp: now - 1000,
        model: model,
    };

    const chatObject: ChatObject = {
        title: title,
        model: model,
        params: { temperature: 0.7 },
        history: {
            messages: {
                msgId1: {
                    ...msg1,
                    id: msgId1,
                    parentId: null,
                    childrenIds: [msgId2],
                },
                msgId2: {
                    ...msg2,
                    id: msgId2,
                    parentId: msgId1,
                    childrenIds: [],
                },
            },
            currentId: msgId2,
        },
        files: [],
        messages: [msg1, msg2],
        timestamp: now,
    };

    return await Chats.createChat(userId, {
        title: chatObject.title,
        chat: chatObject,
        folderId: null,
    }, db);
}

/**
 * Create multiple test chats for pagination testing
 */
async function createMultipleChats(userId: string, count: number): Promise<Chat[]> {
    const chats: Chat[] = [];
    for (let i = 0; i < count; i++) {
        const chat = await createTestChat(userId, `Chat ${i + 1}`);
        chats.push(chat);
    }
    return chats;
}

function toApiChatResponse(chat: Chat): ChatResponse {
    const response: any = {
        id: chat.id,
        user_id: chat.userId,
        title: chat.title,
        chat: chat.chat,
        updated_at: chat.updatedAt,
        created_at: chat.createdAt,
        archived: chat.archived,
        pinned: chat.pinned ?? false,
        meta: chat.meta ?? {},
    };

    if (chat.shareId != null) response.share_id = chat.shareId;
    if (chat.folderId != null) response.folder_id = chat.folderId;

    return response;
}

/* -------------------- TESTS -------------------- */

describe('Chat Routes', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    describe('GET /api/v1/chats/', () => {
        test('should list user chats with pagination', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleChats(userId, 5);

            const response = await request(app)
                .get('/api/v1/chats/')
                .query({ page: 1 })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(Array.isArray(response.body));
            assert.strictEqual(response.body.length, 5);

            // Verify response structure (minimal chat info)
            const chat = response.body[0];
            assert.ok(chat.id);
            assert.ok(chat.title);
            assert.ok(typeof chat.updated_at === 'number');
            assert.ok(typeof chat.created_at === 'number');

            // Should not include full chat data
            assert.strictEqual(chat.chat, undefined);
        });

        test('should return all chats when page not provided', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleChats(userId, 65); // More than page size

            const response = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 65);
        });

        test('should support pagination with 60 items per page', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleChats(userId, 65);

            // Page 1
            const page1Response = await request(app)
                .get('/api/v1/chats/')
                .query({ page: 1 })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(page1Response.body.length, 60);

            // Page 2
            const page2Response = await request(app)
                .get('/api/v1/chats/')
                .query({ page: 2 })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(page2Response.body.length, 5);
        });

        // TODO - uncomment when pins implemented
        // test('should filter by include_pinned flag', async () => {
        //     const { userId, token } = await createUserWithToken('user');
        //     const chat1 = await createTestChat(userId, 'Normal Chat');
        //     const chat2 = await createTestChat(userId, 'Pinned Chat');

        //     // Pin second chat
        //     await Chats.updateChatPinnedById(chat2.id, db);

        //     // Without include_pinned (default: false)
        //     const response1 = await request(app)
        //         .get('/api/v1/chats/')
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response1.body.length, 1);
        //     assert.strictEqual(response1.body[0].id, chat1.id);

        //     // With include_pinned = true
        //     const response2 = await request(app)
        //         .get('/api/v1/chats/')
        //         .query({ include_pinned: true })
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response2.body.length, 2);
        // });

        test('should filter by include_folders flag', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat1 = await createTestChat(userId, 'Normal Chat');
            const chat2 = await createTestChat(userId, 'Folder Chat');

            // Move second chat to folder
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            await Chats.updateChatFolder(chat2.id, userId, folder.id, db);

            // Without include_folders (default: false)
            const response1 = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response1.body.length, 1);
            assert.strictEqual(response1.body[0].id, chat1.id);

            // With include_folders = true
            const response2 = await request(app)
                .get('/api/v1/chats/')
                .query({ include_folders: true })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response2.body.length, 2);
        });

        // TODO - uncomment when archival is implemented
        // test('should exclude archived chats by default', async () => {
        //     const { userId, token } = await createUserWithToken('user');
        //     const chat1 = await createTestChat(userId, 'Normal Chat');
        //     const chat2 = await createTestChat(userId, 'Archived Chat');

        //     // Archive second chat
        //     await Chats.updateChatArchivedById(chat2.id, db);

        //     const response = await request(app)
        //         .get('/api/v1/chats/')
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response.body.length, 1);
        //     assert.strictEqual(response.body[0].id, chat1.id);
        // });

        test('should return empty array for user with no chats', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.deepStrictEqual(response.body, []);
        });

        test('should only return chats owned by authenticated user', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');

            await createTestChat(user1Id, 'User 1 Chat');
            await createTestChat(user2Id, 'User 2 Chat');

            const response = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            assert.strictEqual(response.body.length, 1);
            assert.strictEqual(response.body[0].title, 'User 1 Chat');
        });

        test('should sort by updated_at DESC (most recent first)', async () => {
            const { userId, token } = await createUserWithToken('user');
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

            const chat2 = await createTestChat(userId, 'New Chat');

            const response = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body[0].id, chat2.id);
            assert.strictEqual(response.body[1].id, chat1.id);
        });

        test('should fail without authentication token', async () => {
            await request(app)
                .get('/api/v1/chats/')
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });

        test('should validate query parameters and return 400 for invalid input', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .get('/api/v1/chats/')
                .query({ page: 'not_a_number' })
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });
    });

    describe('GET /api/v1/chats/list', () => {
        test('should be an alias for GET /api/v1/chats/', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleChats(userId, 3);

            const response = await request(app)
                .get('/api/v1/chats/list')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 3);
        });

        test('should support pagination like /api/v1/chats/', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleChats(userId, 65);

            const response = await request(app)
                .get('/api/v1/chats/list')
                .query({ page: 1 })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 60);
        });
    });

    describe('GET /api/v1/chats/all', () => {
        test('should return all user chats without pagination', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleChats(userId, 65);

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 65);
        });

        test('should return full chat objects with all fields', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            const chat = response.body[0];
            assert.ok(chat.id);
            assert.ok(chat.user_id);
            assert.ok(chat.title);
            assert.ok(chat.chat);
            assert.ok(typeof chat.updated_at === 'number');
            assert.ok(typeof chat.created_at === 'number');
            assert.ok(typeof chat.archived === 'boolean');
            assert.ok(typeof chat.pinned === 'boolean');
            assert.ok(typeof chat.meta === 'object');
        });

        test('should translate field names (userId -> user_id, etc.)', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            const chat = response.body[0];
            assert.strictEqual(chat.user_id, userId);
            assert.strictEqual(chat.userId, undefined);
        });

        // TODO - uncomment when impled
        // test('should include archived chats', async () => {
        //     const { userId, token } = await createUserWithToken('user');
        //     const chat1 = await createTestChat(userId, 'Normal Chat');
        //     const chat2 = await createTestChat(userId, 'Archived Chat');
        //     await Chats.updateChatArchivedById(chat2.id, db);

        //     const response = await request(app)
        //         .get('/api/v1/chats/all')
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response.body.length, 2);
        // });

        // test('should include pinned chats', async () => {
        //     const { userId, token } = await createUserWithToken('user');
        //     const chat = await createTestChat(userId, 'Pinned Chat');
        //     await Chats.updateChatPinnedById(chat.id, db);

        //     const response = await request(app)
        //         .get('/api/v1/chats/all')
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response.body[0].pinned, true);
        // });

        test('should include folder chats', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Folder Chat');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            await Chats.updateChatFolder(chat.id, userId, folder.id, db);

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body[0].folder_id, folder.id);
        });

        test('should return empty array for user with no chats', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.deepStrictEqual(response.body, []);
        });

        test('should only return chats owned by authenticated user', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');

            await createTestChat(user1Id, 'User 1 Chat');
            await createTestChat(user2Id, 'User 2 Chat');

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            assert.strictEqual(response.body.length, 1);
            assert.strictEqual(response.body[0].user_id, user1Id);
        });

        test('should fail without authentication token', async () => {
            await request(app)
                .get('/api/v1/chats/all')
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('GET /api/v1/chats/:id', () => {
        test('should return single chat with full details', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .get(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.id, chat.id);
            assert.strictEqual(response.body.title, 'Test Chat');
            assert.ok(response.body.chat);
            assert.ok(response.body.chat.history);
        });

        test('should return 404 when chat not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .get(`/api/v1/chats/${nonExistentId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 when user does not own the chat', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const chat = await createTestChat(user1Id, 'User 1 Chat');

            const response = await request(app)
                .get(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should translate field names in response', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .get(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.user_id, userId);
            assert.strictEqual(response.body.userId, undefined);
        });

        test('should handle optional fields correctly', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .get(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            // Optional fields should be null
            assert.strictEqual(response.body.share_id, undefined);
            assert.strictEqual(response.body.folder_id, undefined);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .get(`/api/v1/chats/${chat.id}`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .get(`/api/v1/chats/${chat.id}`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('POST /api/v1/chats/new', () => {
        test('should create new chat with valid data', async () => {
            const { userId, token } = await createUserWithToken('user');

            const chatData: ChatForm = createNewChatForm('New Chat', 'gpt-4');

            const response = await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', `Bearer ${token}`)
                .send(chatData)
                .expect(200);

            assert.ok(response.body.id);
            assert.strictEqual(response.body.title, 'New Chat');
            assert.strictEqual(response.body.user_id, userId);
            assert.ok(response.body.created_at);
            assert.ok(response.body.updated_at);
        });

        test('should set default values for optional fields', async () => {
            const { token } = await createUserWithToken('user');

            const chatData: ChatForm = createNewChatForm('New Chat', 'gpt-4');

            const response = await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', `Bearer ${token}`)
                .send(chatData)
                .expect(200);

            assert.strictEqual(response.body.archived, false);
            assert.strictEqual(response.body.pinned, false);
            assert.deepStrictEqual(response.body.meta, {});
            assert.strictEqual(response.body.share_id, undefined);
        });

        test('should accept folder_id in request', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            const chatData: ChatForm = createNewChatForm('Folder Chat', 'gpt-4', folder.id);

            const response = await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', `Bearer ${token}`)
                .send(chatData)
                .expect(200);

            assert.strictEqual(response.body.folder_id, folder.id);
        });

        test('should extract title from chat.title', async () => {
            const { token } = await createUserWithToken('user');

            const chatData: ChatForm = createNewChatForm('Extracted Title', 'gpt-4');

            const response = await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', `Bearer ${token}`)
                .send(chatData)
                .expect(200);

            assert.strictEqual(response.body.title, 'Extracted Title');
        });

        test('should create chat with complex history structure', async () => {
            const { token } = await createUserWithToken('user');

            const msgId = crypto.randomUUID();
            const now = currentUnixTimestamp();
            const chatData: NewChatForm = {
                chat: {
                    title: 'Complex Chat',
                    model: 'gpt-4',
                    history: {
                        messages: {
                            [msgId]: {
                                id: msgId,
                                role: 'user',
                                content: 'Hello',
                                parentId: null,
                                timestamp: Date.now(),
                                childrenIds: [],
                            },
                        },
                        currentId: msgId,
                    },
                    files: [],
                    messages: [],
                    timestamp: currentUnixTimestamp(),
                },
                folder_id: null,
            };

            const response = await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', `Bearer ${token}`)
                .send(chatData)
                .expect(200);

            assert.ok(response.body.chat.history);
            assert.ok(response.body.chat.history.messages[msgId]);
        });

        test('should fail with invalid request body', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', `Bearer ${token}`)
                .send({ invalid: 'data' })
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });

        test('should fail without authentication token', async () => {
            const chatData: ChatForm = createNewChatForm();

            await request(app)
                .post('/api/v1/chats/new')
                .send(chatData)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const chatData: ChatForm = createNewChatForm();

            await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', 'Bearer invalid_token')
                .send(chatData)
                .expect(401);
        });
    });

    describe('POST /api/v1/chats/:id', () => {
        test('should update existing chat with valid data', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Original Title');

            const updateData: ChatForm = {
                chat: {
                    title: 'Updated Title'
                }
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(200);

            assert.strictEqual(response.body.id, chat.id);
            assert.strictEqual(response.body.title, 'Updated Title');
        });

        test('should merge chat data with existing chat', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const updateData: ChatForm = {
                chat: {
                    title: 'Updated Title',
                    model: 'gpt-3.5-turbo',
                }
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(200);

            assert.strictEqual(response.body.chat.title, 'Updated Title');
            assert.strictEqual(response.body.chat.model, 'gpt-3.5-turbo');
        });

        test('should update updatedAt timestamp', async () => {
            const { userId, token } = await createUserWithToken('user');
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
            const updateData: ChatForm = {
                chat: {
                    title: 'Updated Title'
                }
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(200);

            assert.ok(response.body.updated_at > originalUpdatedAt);
        });

        test('should return 404 when chat not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const updateData: ChatForm = {
                chat: {
                    title: 'Updated Title'
                }
            };

            const response = await request(app)
                .post(`/api/v1/chats/${nonExistentId}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 when user does not own the chat', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const chat = await createTestChat(user1Id, 'User 1 Chat');

            const updateData: ChatForm = {
                chat: {
                    title: 'Updated Title'
                }
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token2}`)
                .send(updateData)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should fail with invalid request body', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ invalid: 'data' })
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const updateData: ChatForm = {
                chat: {
                    title: 'Updated Title'
                }
            };

            await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .send(updateData)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const updateData: ChatForm = {
                chat: {
                    title: 'Updated Title'
                }
            };

            await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', 'Bearer invalid_token')
                .send(updateData)
                .expect(401);
        });
    });

    /* -------------------- PARTIAL CHAT UPDATES -------------------- */

    describe('Partial Chat Updates', () => {
        test('should preserve model when updating only title', async () => {
            const { userId, token } = await createUserWithToken('user');

            // Create chat with model and messages
            const chat = await createTestChat(userId, 'Original Title');

            // Verify initial state
            assert.strictEqual(chat.chat.model, 'gpt-4');
            assert.strictEqual(chat.chat.messages.length, 2);

            // Update only title
            const updateData: ChatForm = {
                chat: {
                    title: 'New Title'
                }
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(200);

            // Verify title was updated
            assert.strictEqual(response.body.title, 'New Title');
            assert.strictEqual(response.body.chat.title, 'New Title');

            // Verify model was preserved (should NOT be cleared)
            assert.strictEqual(response.body.chat.model, 'gpt-4');
        });

        test('should preserve messages array when updating only title', async () => {
            const { userId, token } = await createUserWithToken('user');

            // Create chat with messages
            const chat = await createTestChat(userId, 'Original Title');

            // Verify initial state
            assert.strictEqual(chat.chat.messages.length, 2);
            assert.strictEqual(chat.chat.messages[0]!.content, 'Hello');

            // Update only title
            const updateData: ChatForm = {
                chat: {
                    title: 'New Title'
                }
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(200);

            // Verify title was updated
            assert.strictEqual(response.body.title, 'New Title');

            // Verify messages array was preserved (should NOT be cleared)
            assert.strictEqual(response.body.chat.messages.length, 2);
            assert.strictEqual(response.body.chat.messages[0].content, 'Hello');
        });

        test('should preserve model when updating history and messages', async () => {
            const { userId, token } = await createUserWithToken('user');

            // Create chat with model
            const chat = await createTestChat(userId, 'Test Chat');

            // Verify initial state
            assert.strictEqual(chat.chat.model, 'gpt-4');

            // Update history and messages (but not model)
            const msgId = crypto.randomUUID();
            const now = currentUnixTimestamp();
            const updateData: ChatForm = {
                chat: {
                    history: {
                        messages: {
                            [msgId]: {
                                id: msgId,
                                role: 'user',
                                content: 'Updated message',
                                parentId: null,
                                timestamp: now,
                                childrenIds: [],
                            },
                        },
                        currentId: msgId,
                    },
                    messages: [{
                        role: 'user',
                        content: 'Updated message',
                        timestamp: now,
                    }],
                },
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(200);

            // Verify messages were updated
            assert.strictEqual(response.body.chat.messages.length, 1);
            assert.strictEqual(response.body.chat.messages[0].content, 'Updated message');

            // Verify model was preserved (should NOT be cleared)
            assert.strictEqual(response.body.chat.model, 'gpt-4');
        });
    });

    describe('DELETE /api/v1/chats/:id', () => {
        test('should delete chat successfully when user owns it', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .delete(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body, true);

            // Verify chat was deleted
            const deletedChat = await Chats.getChatById(chat.id, db);
            assert.strictEqual(deletedChat, null);
        });

        test('should return 400 when chat not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .delete(`/api/v1/chats/${nonExistentId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.ok(response.body.detail);
        });

        test('should return 400 when user does not own the chat', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const chat = await createTestChat(user1Id, 'User 1 Chat');

            const response = await request(app)
                .delete(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(400);

            assert.ok(response.body.detail);

            // Verify chat was not deleted
            const existingChat = await Chats.getChatById(chat.id, db);
            assert.ok(existingChat);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .delete(`/api/v1/chats/${chat.id}`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .delete(`/api/v1/chats/${chat.id}`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('DELETE /api/v1/chats/', () => {
        test('should delete all chats for current user', async () => {
            const { userId, token } = await createUserWithToken('user');
            await createMultipleChats(userId, 5);

            const response = await request(app)
                .delete('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body, true);

            // Verify all chats were deleted
            const chats = await Chats.getChatsByUserId(userId, db);
            assert.strictEqual(chats.length, 0);
        });

        test('should only delete current user chats, not other users', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');

            await createMultipleChats(user1Id, 3);
            await createMultipleChats(user2Id, 2);

            await request(app)
                .delete('/api/v1/chats/')
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            // Verify user 1 chats deleted
            const user1Chats = await Chats.getChatsByUserId(user1Id, db);
            assert.strictEqual(user1Chats.length, 0);

            // Verify user 2 chats still exist
            const user2Chats = await Chats.getChatsByUserId(user2Id, db);
            assert.strictEqual(user2Chats.length, 2);
        });

        test('should return true even when user has no chats', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .delete('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body, true);
        });

        test('should fail without authentication token', async () => {
            await request(app)
                .delete('/api/v1/chats/')
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            await request(app)
                .delete('/api/v1/chats/')
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('POST /api/v1/chats/:id/folder', () => {
        test('should move chat to folder', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const chat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .set('Authorization', `Bearer ${token}`)
                .send({ folder_id: folder.id })
                .expect(200);

            assert.strictEqual(response.body.folder_id, folder.id);
            assert.strictEqual(response.body.pinned, false);

            // Verify in database
            const updatedChat = await Chats.getChatById(chat.id, db);
            assert.strictEqual(updatedChat?.folderId, folder.id);
        });

        // TODO
        // test('should set pinned to false when moving to folder', async () => {
        //     const { userId, token } = await createUserWithToken('user');
        //     const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
        //     const chat = await createTestChat(userId, 'Pinned Chat');

        //     // Pin the chat first
        //     await Chats.updateChatPinnedById(chat.id, db);
        //     const pinnedChat = await Chats.getChatById(chat.id, db);
        //     assert.strictEqual(pinnedChat?.pinned, true);

        //     // Move to folder - should unpin
        //     const response = await request(app)
        //         .post(`/api/v1/chats/${chat.id}/folder`)
        //         .set('Authorization', `Bearer ${token}`)
        //         .send({ folder_id: folder.id })
        //         .expect(200);

        //     assert.strictEqual(response.body.folder_id, folder.id);
        //     assert.strictEqual(response.body.pinned, false);
        // });

        test('should remove chat from folder when folder_id is null', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const chat = await createTestChat(userId, 'Test Chat');

            // Move to folder first
            await Chats.updateChatFolder(chat.id, userId, folder.id, db);

            // Remove from folder
            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .set('Authorization', `Bearer ${token}`)
                .send({ folder_id: null })
                .expect(200);

            assert.strictEqual(response.body.folder_id, undefined);
        });

        test('should return 404 when chat not found', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .post(`/api/v1/chats/${nonExistentId}/folder`)
                .set('Authorization', `Bearer ${token}`)
                .send({ folder_id: folder.id })
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 when user does not own chat', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { userId: user2Id, token: token2 } = await createUserWithToken('user');

            const folder = await Folders.createFolder(createTestFolderForm(user2Id, 'Test Folder'), db);
            const chat = await createTestChat(user1Id, 'User 1 Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .set('Authorization', `Bearer ${token2}`)
                .send({ folder_id: folder.id })
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should update updatedAt timestamp', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const now = currentUnixTimestamp();

            // Create old chat
            const [chat] = await Chats.importChats(userId, [{
                chat: createTestChatObject('Old Chat'),
                meta: {},
                pinned: false,
                created_at: now - 1000,
                updated_at: now - 1000,
            }], db);
            assert.ok(chat);

            const originalUpdatedAt = chat.updatedAt;

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .set('Authorization', `Bearer ${token}`)
                .send({ folder_id: folder.id })
                .expect(200);

            assert.ok(response.body.updated_at > originalUpdatedAt);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .send({ folder_id: folder.id })
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .set('Authorization', 'Bearer invalid_token')
                .send({ folder_id: folder.id })
                .expect(401);
        });
    });

    describe('GET /api/v1/chats/folder/:folder_id', () => {
        test('should return all chats in folder with full data', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            let chat1 = await createTestChat(userId, 'Chat 1');
            let chat2 = await createTestChat(userId, 'Chat 2');
            const chat3 = await createTestChat(userId, 'Chat 3');

            // Move chats to folder
            chat1 = await Chats.updateChatFolder(chat1.id, userId, folder.id, db);
            chat2 = await Chats.updateChatFolder(chat2.id, userId, folder.id, db);

            const response = await request(app)
                .get(`/api/v1/chats/folder/${folder.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(Array.isArray(response.body));
            assert.strictEqual(response.body.length, 2);

            const chats = [chat1, chat2].map(c => toApiChatResponse(c));
            const chatResponses = response.body as ChatResponse[];

            // Verify full chat data is returned
            for (const chat of chats) {
                const chatResponse = chatResponses.find(c => c.id === chat.id);

                assert.ok(chatResponse);
                console.log(`chat: ${JSON.stringify(chat, null, 2)}`);
                console.log('======')
                console.log(`chatResponse: ${JSON.stringify(chatResponse, null, 2)}`);
                assert.deepStrictEqual(chat, chatResponse);
            }
        });

        test('should return chats in subfolders', async () => {
            const { userId, token } = await createUserWithToken('user');

            const parentFolder = await Folders.createFolder(createTestFolderForm(userId, 'Parent Folder'), db);
            const childFolder1 = await Folders.createFolder(createTestFolderForm(userId, 'Child1 Folder', parentFolder.id), db);
            const childFolder2 = await Folders.createFolder(createTestFolderForm(userId, 'Child2 Folder', parentFolder.id), db);
            const childChildFolder1 = await Folders.createFolder(createTestFolderForm(userId, 'Child1Child Folder', childFolder1.id), db);

            let parentChat = await createTestChat(userId, 'Chat 1');
            let child1Chat = await createTestChat(userId, 'Chat 2');
            let child2Chat = await createTestChat(userId, 'Chat 3');
            let childChildChat = await createTestChat(userId, 'Chat 4');

            // Move chats to folder
            parentChat = await Chats.updateChatFolder(parentChat.id, userId, parentFolder.id, db);
            child1Chat = await Chats.updateChatFolder(child1Chat.id, userId, childFolder1.id, db);
            child2Chat = await Chats.updateChatFolder(child2Chat.id, userId, childFolder2.id, db);
            childChildChat = await Chats.updateChatFolder(childChildChat.id, userId, childChildFolder1.id, db);

            const response = await request(app)
                .get(`/api/v1/chats/folder/${parentFolder.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(Array.isArray(response.body));
            assert.strictEqual(response.body.length, 4);

            const chats = [parentChat, child1Chat, child2Chat, childChildChat].map(c => toApiChatResponse(c));
            const chatResponses = response.body as ChatResponse[];

            // Verify full chat data is returned
            for (const chat of chats) {
                const chatResponse = chatResponses.find(c => c.id === chat.id);

                assert.ok(chatResponse);
                assert.deepStrictEqual(chat, chatResponse);
            }
        });

        test('should return empty array for folder with no chats', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            const response = await request(app)
                .get(`/api/v1/chats/folder/${folder.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.deepStrictEqual(response.body, []);
        });

        test('should only return chats owned by authenticated user', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { userId: user2Id } = await createUserWithToken('user');

            const folder1 = await Folders.createFolder(createTestFolderForm(user1Id, 'Test Folder'), db);
            const folder2 = await Folders.createFolder(createTestFolderForm(user2Id, 'Test Folder'), db);

            const chat1 = await createTestChat(user1Id, 'User 1 Chat');
            const chat2 = await createTestChat(user2Id, 'User 2 Chat');

            await Chats.updateChatFolder(chat1.id, user1Id, folder1.id, db);
            await Chats.updateChatFolder(chat2.id, user2Id, folder2.id, db);

            const response = await request(app)
                .get(`/api/v1/chats/folder/${folder1.id}`)
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            assert.strictEqual(response.body.length, 1);
            assert.strictEqual(response.body[0].user_id, user1Id);
        });

        // TODO
        // test('should exclude archived chats from folder', async () => {
        //     const { userId, token } = await createUserWithToken('user');
        //     const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

        //     const chat1 = await createTestChat(userId, 'Normal Chat');
        //     const chat2 = await createTestChat(userId, 'Archived Chat');

        //     await Chats.updateChatFolder(chat1.id, userId, folder.id, db);
        //     await Chats.updateChatFolder(chat2.id, userId, folder.id, db);

        //     // Archive second chat
        //     await Chats.updateChatArchivedById(chat2.id, db);

        //     const response = await request(app)
        //         .get(`/api/v1/chats/folder/${folder.id}`)
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response.body.length, 1);
        //     assert.strictEqual(response.body[0].id, chat1.id);
        // });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            await request(app)
                .get(`/api/v1/chats/folder/${folder.id}`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            await request(app)
                .get(`/api/v1/chats/folder/${folder.id}`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('GET /api/v1/chats/folder/:folder_id/list', () => {
        test('should return paginated chat list with minimal data', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            // Create 12 chats in folder
            for (let i = 0; i < 12; i++) {
                const chat = await createTestChat(userId, `Chat ${i + 1}`);
                await Chats.updateChatFolder(chat.id, userId, folder.id, db);
            }

            // Page 1 - should return 10 items
            const page1Response = await request(app)
                .get(`/api/v1/chats/folder/${folder.id}/list`)
                .query({ page: 1 })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(page1Response.body.length, 10);

            // Verify minimal response structure
            const chatItem = page1Response.body[0];
            assert.ok(chatItem.id);
            assert.ok(chatItem.title);
            assert.ok(typeof chatItem.updated_at === 'number');

            // Should NOT include created_at
            assert.strictEqual(chatItem.created_at, undefined);

            // Should NOT include full chat data
            assert.strictEqual(chatItem.chat, undefined);

            // Page 2 - should return remaining 2 items
            const page2Response = await request(app)
                .get(`/api/v1/chats/folder/${folder.id}/list`)
                .query({ page: 2 })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(page2Response.body.length, 2);
        });

        test('should default to page 1 when not specified', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            // Create 5 chats
            for (let i = 0; i < 5; i++) {
                const chat = await createTestChat(userId, `Chat ${i + 1}`);
                await Chats.updateChatFolder(chat.id, userId, folder.id, db);
            }

            const response = await request(app)
                .get(`/api/v1/chats/folder/${folder.id}/list`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 5);
        });

        test('should return empty array for empty folder', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            const response = await request(app)
                .get(`/api/v1/chats/folder/${folder.id}/list`)
                .query({ page: 1 })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.deepStrictEqual(response.body, []);
        });

        test('should validate query parameters', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            const response = await request(app)
                .get(`/api/v1/chats/folder/${folder.id}/list`)
                .query({ page: 'invalid' })
                .set('Authorization', `Bearer ${token}`)
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.errors);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            await request(app)
                .get(`/api/v1/chats/folder/${folder.id}/list`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);

            await request(app)
                .get(`/api/v1/chats/folder/${folder.id}/list`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    /* -------------------- PHASE 2: SHARING OPERATIONS -------------------- */

    describe('POST /api/v1/chats/:id/share', () => {
        test('should share chat and generate share_id', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.ok(response.body.share_id);
            assert.strictEqual(response.body.id, chat.id);

            // Verify share_id is UUID v4 format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            assert.ok(uuidRegex.test(response.body.share_id));

            // Verify in database
            const sharedChat = await Chats.getChatById(chat.id, db);
            assert.ok(sharedChat?.shareId);
        });

        test('should disallow re-sharing if chat already shared', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            // First share
            const response1 = await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            const firstShareId = response1.body.share_id;
            assert.ok(firstShareId);

            // Second share - should update timestamp
            const response2 = await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(400);
        });

        test('should return 404 when chat not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .post(`/api/v1/chats/${nonExistentId}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 when user does not own chat', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const chat = await createTestChat(user1Id, 'User 1 Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('GET /api/v1/chats/share/:share_id', () => {
        test('should return shared chat with full data', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Shared Chat');

            // Share the chat
            const shareResponse = await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            const shareId = shareResponse.body.share_id;

            // Any authenticated user can access shared chat
            const { token: otherUserToken } = await createUserWithToken('user');

            const response = await request(app)
                .get(`/api/v1/chats/share/${shareId}`)
                .set('Authorization', `Bearer ${otherUserToken}`)
                .expect(200);

            assert.strictEqual(response.body.id, chat.id);
            assert.strictEqual(response.body.share_id, shareId);
            assert.ok(response.body.chat);
            assert.ok(response.body.title);
        });

        test('should allow public access to shared chat', async () => {
            const { userId, token: ownerToken } = await createUserWithToken('user');
            const { token: viewerToken } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Public Shared Chat');

            // Share the chat
            const shareResponse = await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${ownerToken}`)
                .expect(200);

            const shareId = shareResponse.body.share_id;

            // Different user can access
            const response = await request(app)
                .get(`/api/v1/chats/share/${shareId}`)
                .set('Authorization', `Bearer ${viewerToken}`)
                .expect(200);

            assert.strictEqual(response.body.id, chat.id);
        });

        test('should return 404 for non-existent share_id', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentShareId = crypto.randomUUID();

            const response = await request(app)
                .get(`/api/v1/chats/share/${nonExistentShareId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 for chat that is not shared', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Unshared Chat');
            const fakeShareId = crypto.randomUUID();

            const response = await request(app)
                .get(`/api/v1/chats/share/${fakeShareId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const shareResponse = await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            await request(app)
                .get(`/api/v1/chats/share/${shareResponse.body.share_id}`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const shareResponse = await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            await request(app)
                .get(`/api/v1/chats/share/${shareResponse.body.share_id}`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('DELETE /api/v1/chats/:id/share', () => {
        test('should unshare chat successfully', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Shared Chat');

            // Share the chat
            await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            // Verify it's shared
            const sharedChat = await Chats.getChatById(chat.id, db);
            assert.ok(sharedChat?.shareId);

            // Unshare
            const response = await request(app)
                .delete(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body, true);

            // Verify shareId is cleared
            const unsharedChat = await Chats.getChatById(chat.id, db);
            assert.strictEqual(unsharedChat?.shareId, null);
        });

        test('should return false when chat is not currently shared', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Unshared Chat');

            const response = await request(app)
                .delete(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body, false);
        });

        test('should return 404 when chat not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .delete(`/api/v1/chats/${nonExistentId}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 when user does not own chat', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const chat = await createTestChat(user1Id, 'User 1 Chat');

            // User 1 shares the chat
            await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            // User 2 tries to unshare
            const response = await request(app)
                .delete(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .delete(`/api/v1/chats/${chat.id}/share`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .delete(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    /* -------------------- PHASE 2: CLONING OPERATIONS -------------------- */

    describe('POST /api/v1/chats/:id/clone/shared', () => {
        test('should clone shared chat to current user', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { userId: user2Id, token: token2 } = await createUserWithToken('user');

            const originalChat = await createTestChat(user1Id, 'Shared Chat');

            // User 1 shares the chat
            const shareResponse = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/share`)
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            const shareId = shareResponse.body.share_id;

            // User 2 clones the shared chat
            const cloneResponse = await request(app)
                .post(`/api/v1/chats/${shareId}/clone/shared`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(200);

            // Verify clone
            assert.notStrictEqual(cloneResponse.body.id, originalChat.id);
            assert.strictEqual(cloneResponse.body.user_id, user2Id);
            assert.strictEqual(cloneResponse.body.title, 'Shared Chat');
            assert.strictEqual(cloneResponse.body.share_id, undefined);
            assert.strictEqual(cloneResponse.body.folder_id, undefined);

            // Verify chat content is copied
            assert.ok(cloneResponse.body.chat);
            assert.ok(cloneResponse.body.chat.history);
        });

        test('should create new ID for cloned chat', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const originalChat = await createTestChat(user1Id, 'Original Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/share`)
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            const shareId = response.body.share_id;

            const cloneResponse = await request(app)
                .post(`/api/v1/chats/${shareId}/clone/shared`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(200);

            assert.notStrictEqual(cloneResponse.body.id, originalChat.id);
        });

        test('should clear share_id on cloned chat', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const originalChat = await createTestChat(user1Id, 'Shared Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/share`)
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            const shareId = response.body.share_id;

            const cloneResponse = await request(app)
                .post(`/api/v1/chats/${shareId}/clone/shared`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(200);

            assert.strictEqual(cloneResponse.body.share_id, undefined);
        });

        test('should clear folder_id on cloned chat', async () => {
            const { userId: user1Id, token: token1 } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const folder = await Folders.createFolder(createTestFolderForm(user1Id, 'Test Folder'), db);
            const originalChat = await createTestChat(user1Id, 'Chat in Folder');

            await Chats.updateChatFolder(originalChat.id, user1Id, folder.id, db);
            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/share`)
                .set('Authorization', `Bearer ${token1}`)
                .expect(200);

            const shareId = response.body.share_id;

            const cloneResponse = await request(app)
                .post(`/api/v1/chats/${shareId}/clone/shared`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(200);

            assert.strictEqual(cloneResponse.body.folder_id, undefined);
        });

        test('should return 404 when chat not shared', async () => {
            const { userId, token: ownerToken } = await createUserWithToken('user');
            const { token: otherToken } = await createUserWithToken('user');

            const chat = await createTestChat(userId, 'Unshared Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/clone/shared`)
                .set('Authorization', `Bearer ${otherToken}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 when chat not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .post(`/api/v1/chats/${nonExistentId}/clone/shared`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            await request(app)
                .post(`/api/v1/chats/${chat.id}/clone/shared`)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            await request(app)
                .post(`/api/v1/chats/${chat.id}/clone/shared`)
                .set('Authorization', 'Bearer invalid_token')
                .expect(401);
        });
    });

    describe('POST /api/v1/chats/:id/clone', () => {
        test('should clone own chat', async () => {
            const { userId, token } = await createUserWithToken('user');
            const originalChat = await createTestChat(userId, 'Original Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/clone`)
                .set('Authorization', `Bearer ${token}`)
                .send({})
                .expect(200);

            assert.notStrictEqual(response.body.id, originalChat.id);
            assert.strictEqual(response.body.user_id, userId);
            assert.strictEqual(response.body.title, 'Original Chat');
            assert.strictEqual(response.body.share_id, undefined);
            assert.strictEqual(response.body.folder_id, undefined);
        });

        test('should clone with custom title', async () => {
            const { userId, token } = await createUserWithToken('user');
            const originalChat = await createTestChat(userId, 'Original Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/clone`)
                .set('Authorization', `Bearer ${token}`)
                .send({ title: 'Cloned Chat' })
                .expect(200);

            assert.strictEqual(response.body.title, 'Cloned Chat');
            assert.strictEqual(response.body.chat.title, 'Cloned Chat');
        });

        test('should preserve chat content and history', async () => {
            const { userId, token } = await createUserWithToken('user');
            const originalChat = await createTestChat(userId, 'Chat with History');

            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/clone`)
                .set('Authorization', `Bearer ${token}`)
                .send({})
                .expect(200);

            assert.ok(response.body.chat);
            assert.ok(response.body.chat.history);
            assert.ok(response.body.chat.messages);
        });

        test('should create new ID for cloned chat', async () => {
            const { userId, token } = await createUserWithToken('user');
            const originalChat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/clone`)
                .set('Authorization', `Bearer ${token}`)
                .send({})
                .expect(200);

            assert.notStrictEqual(response.body.id, originalChat.id);

            // Verify both chats exist
            const original = await Chats.getChatById(originalChat.id, db);
            const clone = await Chats.getChatById(response.body.id, db);
            assert.ok(original);
            assert.ok(clone);
        });

        test('should clear share_id on cloned chat', async () => {
            const { userId, token } = await createUserWithToken('user');
            const originalChat = await createTestChat(userId, 'Shared Chat');

            // Share original
            await request(app)
                .post(`/api/v1/chats/${originalChat.id}/share`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            // Clone
            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/clone`)
                .set('Authorization', `Bearer ${token}`)
                .send({})
                .expect(200);

            assert.strictEqual(response.body.share_id, undefined);
        });

        test('should clear folder_id on cloned chat', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const originalChat = await createTestChat(userId, 'Chat in Folder');

            await Chats.updateChatFolder(originalChat.id, userId, folder.id, db);

            const response = await request(app)
                .post(`/api/v1/chats/${originalChat.id}/clone`)
                .set('Authorization', `Bearer ${token}`)
                .send({})
                .expect(200);

            assert.strictEqual(response.body.folder_id, undefined);
        });

        test('should return 404 when chat not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .post(`/api/v1/chats/${nonExistentId}/clone`)
                .set('Authorization', `Bearer ${token}`)
                .send({})
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 when user does not own chat', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const chat = await createTestChat(user1Id, 'User 1 Chat');

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/clone`)
                .set('Authorization', `Bearer ${token2}`)
                .send({})
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/clone`)
                .send({})
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/clone`)
                .set('Authorization', 'Bearer invalid_token')
                .send({})
                .expect(401);
        });
    });
});
