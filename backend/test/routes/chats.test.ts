import { describe, test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { assertInMemoryDatabase, createUserWithToken, createTestFolderForm } from '../helpers.js';
import { db, schema, Chats, Folders, currentUnixTimestamp, type Chat } from '../../src/db/index.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { type ChatForm, type ChatObject, type NewChatForm, type ChatImportForm } from '../../src/routes/types/index.js';
import chatsRouter from '../../src/routes/chats.js';

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
        timestamp: currentUnixTimestamp(),
    };

    return {
        chat: chat,
        folderId: folderId ?? null,
    };
}

/**
 * Create a test chat with full message history
 */
async function createTestChat(userId: string, title: string = 'Test Chat'): Promise<Chat> {
    const now = currentUnixTimestamp();
    const model = 'gpt-4';

    const msgId1 = crypto.randomUUID();
    const msgId2 = crypto.randomUUID();

    const chatObject: ChatObject = {
        title: title,
        model: model,
        history: {
            messages: {
                msgId1: {
                    id: msgId1,
                    parentId: null,
                    childrenIds: [msgId2],
                    role: 'user',
                    content: 'Hello',
                    done: false,
                    files: [],
                    timestamp: now - 2000,
                },
                msgId2: {
                    id: msgId2,
                    parentId: msgId1,
                    childrenIds: [],
                    role: 'assistant',
                    content: 'Hi there!',
                    done: false,
                    files: [],
                    timestamp: now - 1000,
                },
            },
            currentId: msgId2,
        },
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
            assert.ok(typeof chat.updatedAt === 'number');
            assert.ok(typeof chat.createdAt === 'number');

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
                .query({ includeFolders: true })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response2.body.length, 2);
        });

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
                createdAt: now - 1000,
                updatedAt: now - 1000,
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
            assert.ok(chat.userId);
            assert.ok(chat.title);
            assert.ok(chat.chat);
            assert.ok(typeof chat.updatedAt === 'number');
            assert.ok(typeof chat.createdAt === 'number');
            assert.ok(typeof chat.meta === 'object');
        });

        test('should include folder chats', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Folder Chat');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            await Chats.updateChatFolder(chat.id, userId, folder.id, db);

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body[0].folderId, folder.id);
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
            assert.strictEqual(response.body[0].userId, user1Id);
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

        test('should handle optional fields correctly', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Test Chat');

            const response = await request(app)
                .get(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            // Unset fields should be null
            assert.strictEqual(response.body.shareId, null);
            assert.strictEqual(response.body.folderId, null);
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
            assert.strictEqual(response.body.userId, userId);
            assert.ok(response.body.createdAt);
            assert.ok(response.body.updatedAt);
        });

        test('should set default values for optional fields', async () => {
            const { token } = await createUserWithToken('user');

            const chatData: ChatForm = createNewChatForm('New Chat', 'gpt-4');

            const response = await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', `Bearer ${token}`)
                .send(chatData)
                .expect(200);

            assert.deepStrictEqual(response.body.meta, {});
            assert.strictEqual(response.body.shareId, null);
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

            assert.strictEqual(response.body.folderId, folder.id);
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
                                done: false,
                                files: [],
                            },
                        },
                        currentId: msgId,
                    },
                    timestamp: currentUnixTimestamp(),
                },
                folderId: null,
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
                createdAt: now - 1000,
                updatedAt: now - 1000,
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

            assert.ok(response.body.updatedAt > originalUpdatedAt);
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

        test('should preserve model when updating history', async () => {
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
                                done: false,
                                files: [],
                            },
                        },
                        currentId: msgId,
                    },
                },
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(200);

            // Verify messages were updated
            assert.ok(response.body.chat.history.messages[msgId]);
            assert.strictEqual(response.body.chat.history.messages[msgId].content, 'Updated message');

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
                .send({ folderId: folder.id })
                .expect(200);

            assert.strictEqual(response.body.folderId, folder.id);

            // Verify in database
            const updatedChat = await Chats.getChatById(chat.id, db);
            assert.strictEqual(updatedChat?.folderId, folder.id);
        });

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
                .send({ folderId: null })
                .expect(200);

            assert.strictEqual(response.body.folderId, null);
        });

        test('should return 404 when chat not found', async () => {
            const { userId, token } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .post(`/api/v1/chats/${nonExistentId}/folder`)
                .set('Authorization', `Bearer ${token}`)
                .send({ folderId: folder.id })
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
                .send({ folderId: folder.id })
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
                createdAt: now - 1000,
                updatedAt: now - 1000,
            }], db);
            assert.ok(chat);

            const originalUpdatedAt = chat.updatedAt;

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .set('Authorization', `Bearer ${token}`)
                .send({ folderId: folder.id })
                .expect(200);

            assert.ok(response.body.updatedAt > originalUpdatedAt);
        });

        test('should fail without authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .send({ folderId: folder.id })
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const { userId } = await createUserWithToken('user');
            const folder = await Folders.createFolder(createTestFolderForm(userId, 'Test Folder'), db);
            const chat = await createTestChat(userId, 'Test Chat');

            await request(app)
                .post(`/api/v1/chats/${chat.id}/folder`)
                .set('Authorization', 'Bearer invalid_token')
                .send({ folderId: folder.id })
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

            const chats = [chat1, chat2];
            const chatResponses = response.body as Chat[];

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

            const chats = [parentChat, child1Chat, child2Chat, childChildChat];
            const chatResponses = response.body as Chat[];

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
            assert.strictEqual(response.body[0].userId, user1Id);
        });

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
            assert.ok(typeof chatItem.updatedAt === 'number');

            // Should NOT include created_at
            assert.strictEqual(chatItem.createdAt, undefined);

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

            assert.ok(response.body.shareId);
            assert.strictEqual(response.body.id, chat.id);

            // Verify share_id is UUID v4 format
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            assert.ok(uuidRegex.test(response.body.shareId));

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

            const firstShareId = response1.body.shareId;
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

            const shareId = shareResponse.body.shareId;

            // Any authenticated user can access shared chat
            const { token: otherUserToken } = await createUserWithToken('user');

            const response = await request(app)
                .get(`/api/v1/chats/share/${shareId}`)
                .set('Authorization', `Bearer ${otherUserToken}`)
                .expect(200);

            assert.strictEqual(response.body.id, chat.id);
            assert.strictEqual(response.body.shareId, shareId);
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

            const shareId = shareResponse.body.shareId;

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
                .get(`/api/v1/chats/share/${shareResponse.body.shareId}`)
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
                .get(`/api/v1/chats/share/${shareResponse.body.shareId}`)
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

            const shareId = shareResponse.body.shareId;

            // User 2 clones the shared chat
            const cloneResponse = await request(app)
                .post(`/api/v1/chats/${shareId}/clone/shared`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(200);

            // Verify clone
            assert.notStrictEqual(cloneResponse.body.id, originalChat.id);
            assert.strictEqual(cloneResponse.body.userId, user2Id);
            assert.strictEqual(cloneResponse.body.title, 'Shared Chat');
            assert.strictEqual(cloneResponse.body.shareId, null);
            assert.strictEqual(cloneResponse.body.folderId, null);

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

            const shareId = response.body.shareId;

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

            const shareId = response.body.shareId;

            const cloneResponse = await request(app)
                .post(`/api/v1/chats/${shareId}/clone/shared`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(200);

            assert.strictEqual(cloneResponse.body.shareId, null);
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

            const shareId = response.body.shareId;

            const cloneResponse = await request(app)
                .post(`/api/v1/chats/${shareId}/clone/shared`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(200);

            assert.strictEqual(cloneResponse.body.folderId, null);
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
            assert.strictEqual(response.body.userId, userId);
            assert.strictEqual(response.body.title, 'Original Chat');
            assert.strictEqual(response.body.shareId, null);
            assert.strictEqual(response.body.folderId, null);
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

            assert.strictEqual(response.body.shareId, null);
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

            assert.strictEqual(response.body.folderId, null);
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

    describe('POST /api/v1/chats/import', () => {
        function createImportForm(overrides: Partial<ChatImportForm> = {}): ChatImportForm {
            return {
                chat: createTestChatObject(),
                meta: {},
                folderId: null,
                ...overrides,
            };
        }

        test('should import a single chat and return it', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send([createImportForm()])
                .expect(200);

            assert.ok(Array.isArray(response.body));
            assert.strictEqual(response.body.length, 1);

            const imported = response.body[0];
            assert.ok(imported.id);
            assert.ok(imported.userId);
            assert.ok(imported.title);
            assert.ok(imported.chat);
        });

        test('should import multiple chats', async () => {
            const { token } = await createUserWithToken('user');

            const forms = [
                createImportForm({ chat: createTestChatObject('Chat A') }),
                createImportForm({ chat: createTestChatObject('Chat B') }),
                createImportForm({ chat: createTestChatObject('Chat C') }),
            ];

            const response = await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send(forms)
                .expect(200);

            assert.strictEqual(response.body.length, 3);
            const titles = response.body.map((c: Chat) => c.title).sort();
            assert.deepStrictEqual(titles, ['Chat A', 'Chat B', 'Chat C']);
        });

        test('should preserve provided timestamps', async () => {
            const { token } = await createUserWithToken('user');
            const createdAt = 1700000000;
            const updatedAt = 1700001000;

            const response = await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send([createImportForm({ createdAt: createdAt, updatedAt: updatedAt })])
                .expect(200);

            assert.strictEqual(response.body[0].createdAt, createdAt);
            assert.strictEqual(response.body[0].updatedAt, updatedAt);
        });

        test('should use current time when timestamps are not provided', async () => {
            const { token } = await createUserWithToken('user');
            const before = currentUnixTimestamp();

            const response = await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send([createImportForm()])
                .expect(200);

            const after = currentUnixTimestamp();
            assert.ok(response.body[0].createdAt >= before);
            assert.ok(response.body[0].createdAt <= after);
        });

        test('imported chats should appear in the chat list', async () => {
            const { token } = await createUserWithToken('user');

            await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send([
                    createImportForm({ chat: createTestChatObject('Imported A') }),
                    createImportForm({ chat: createTestChatObject('Imported B') }),
                ])
                .expect(200);

            const listResponse = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(listResponse.body.length, 2);
        });

        test('imported chats should be owned by the requesting user', async () => {
            const { token, userId } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send([createImportForm()])
                .expect(200);

            assert.strictEqual(response.body[0].userId, userId);
        });

        test('should return empty array for empty input', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send([])
                .expect(200);

            assert.deepStrictEqual(response.body, []);
        });

        test('should reject non-array body', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send({ chat: createTestChatObject() })
                .expect(400);

            assert.ok(response.body.detail);
        });

        test('should reject array containing an invalid item', async () => {
            const { token } = await createUserWithToken('user');

            const response = await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token}`)
                .send([
                    createImportForm({ chat: createTestChatObject('Valid') }),
                    { chat: 'not a chat object' },   // invalid
                ])
                .expect(400);

            assert.ok(response.body.detail);
            assert.ok(response.body.detail.includes('index 1'));
        });

        test('should not expose other users chats via import', async () => {
            const { token: token1 } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', `Bearer ${token1}`)
                .send([createImportForm()])
                .expect(200);

            const listResponse = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token2}`)
                .expect(200);

            assert.strictEqual(listResponse.body.length, 0);
        });

        test('should fail without authentication token', async () => {
            await request(app)
                .post('/api/v1/chats/import')
                .send([createImportForm()])
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            await request(app)
                .post('/api/v1/chats/import')
                .set('Authorization', 'Bearer invalid_token')
                .send([createImportForm()])
                .expect(401);
        });
    });
});
