import { describe, test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';

import { assertInMemoryDatabase, newUserParams, TEST_PASSWORD } from '../helpers.js';
import { db } from '../../src/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.js';
import * as Users from '../../src/db/operations/users.js';
import * as Auths from '../../src/db/operations/auths.js';
import * as Chats from '../../src/db/operations/chats.js';
import * as JWT from '../../src/routes/jwt.js';
import { type UserRole, type ChatForm, type ChatObject, type FlattenedMessage } from '../../src/routes/types.js';
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
 * Create a test user and return JWT token
 */
async function createUserWithToken(role: UserRole = 'user'): Promise<{ userId: string; token: string }> {
    const userParams = newUserParams(role);
    const user = await Users.createUser(userParams, db);
    await Auths.createAuth(userParams.id, userParams.username, TEST_PASSWORD, db);
    const token = JWT.createToken(userParams.id);

    assert.strictEqual(user.role, role);
    return { userId: userParams.id, token };
}

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
        system: null,
        history: {
            messages: {},
            currentId: null,
        },
        messages: [],
    };
}

/**
 * Create a test chat with full message history
 */
async function createTestChat(userId: string, title: string = 'Test Chat'): Promise<schema.Chat> {
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
        models: [model],
        system: 'You are a helpful assistant.',
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
        messages: [msg1, msg2],
        timestamp: now,
    };

    const chatForm: ChatForm = {
        chat: chatObject,
        folder_id: null,
    };

    return await Chats.createChat(userId, chatForm, db);
}

/**
 * Create multiple test chats for pagination testing
 */
async function createMultipleChats(userId: string, count: number): Promise<schema.Chat[]> {
    const chats: schema.Chat[] = [];
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

        test('should filter by include_pinned flag', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat1 = await createTestChat(userId, 'Normal Chat');
            const chat2 = await createTestChat(userId, 'Pinned Chat');

            // Pin second chat
            await Chats.updateChatPinnedById(chat2.id, db);

            // Without include_pinned (default: false)
            const response1 = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response1.body.length, 1);
            assert.strictEqual(response1.body[0].id, chat1.id);

            // With include_pinned = true
            const response2 = await request(app)
                .get('/api/v1/chats/')
                .query({ include_pinned: true })
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response2.body.length, 2);
        });

        // TODO - fix when folder operations are implemented
        // test('should filter by include_folders flag', async () => {
        //     const { userId, token } = await createUserWithToken('user');
        //     const chat1 = await createTestChat(userId, 'Normal Chat');
        //     const chat2 = await createTestChat(userId, 'Folder Chat');

        //     // Move second chat to folder
        //     const folderId = crypto.randomUUID();
        //     await Chats.updateChatFolderIdByIdAndUserId(chat2.id, userId, folderId, db);

        //     // Without include_folders (default: false)
        //     const response1 = await request(app)
        //         .get('/api/v1/chats/')
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response1.body.length, 1);
        //     assert.strictEqual(response1.body[0].id, chat1.id);

        //     // With include_folders = true
        //     const response2 = await request(app)
        //         .get('/api/v1/chats/')
        //         .query({ include_folders: true })
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response2.body.length, 2);
        // });

        test('should exclude archived chats by default', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat1 = await createTestChat(userId, 'Normal Chat');
            const chat2 = await createTestChat(userId, 'Archived Chat');

            // Archive second chat
            await Chats.updateChatArchivedById(chat2.id, db);

            const response = await request(app)
                .get('/api/v1/chats/')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 1);
            assert.strictEqual(response.body[0].id, chat1.id);
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

        test('should include archived chats', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat1 = await createTestChat(userId, 'Normal Chat');
            const chat2 = await createTestChat(userId, 'Archived Chat');
            await Chats.updateChatArchivedById(chat2.id, db);

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body.length, 2);
        });

        test('should include pinned chats', async () => {
            const { userId, token } = await createUserWithToken('user');
            const chat = await createTestChat(userId, 'Pinned Chat');
            await Chats.updateChatPinnedById(chat.id, db);

            const response = await request(app)
                .get('/api/v1/chats/all')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            assert.strictEqual(response.body[0].pinned, true);
        });

        // TODO - fix when folders are implemented
        // test('should include folder chats', async () => {
        //     const { userId, token } = await createUserWithToken('user');
        //     const chat = await createTestChat(userId, 'Folder Chat');
        //     const folderId = crypto.randomUUID();
        //     await Chats.updateChatFolderIdByIdAndUserId(chat.id, userId, folderId, db);

        //     const response = await request(app)
        //         .get('/api/v1/chats/all')
        //         .set('Authorization', `Bearer ${token}`)
        //         .expect(200);

        //     assert.strictEqual(response.body[0].folder_id, folderId);
        // });

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

            // Optional fields should be undefined when null
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

            const chatData: ChatForm = {
                chat: {
                    title: 'New Chat',
                    models: ['gpt-4'],
                    messages: [],
                },
            };

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

            const chatData: ChatForm = {
                chat: {
                    title: 'New Chat',
                    models: [],
                    messages: [],
                },
            };

            const response = await request(app)
                .post('/api/v1/chats/new')
                .set('Authorization', `Bearer ${token}`)
                .send(chatData)
                .expect(200);

            assert.strictEqual(response.body.archived, false);
            assert.strictEqual(response.body.pinned, false);
            assert.deepStrictEqual(response.body.meta, {});
            assert.strictEqual(response.body.share_id, null);
        });

        // TODO - fix when folder operations are implemented
        // test('should accept folder_id in request', async () => {
        //     const { token } = await createUserWithToken('user');
        //     const folderId = crypto.randomUUID();

        //     const chatData: ChatForm = {
        //         chat: {
        //             title: 'Folder Chat',
        //             models: [],
        //             messages: [],
        //         },
        //         folder_id: folderId,
        //     };

        //     const response = await request(app)
        //         .post('/api/v1/chats/new')
        //         .set('Authorization', `Bearer ${token}`)
        //         .send(chatData)
        //         .expect(200);

        //     assert.strictEqual(response.body.folder_id, folderId);
        // });

        test('should extract title from chat.title', async () => {
            const { token } = await createUserWithToken('user');

            const chatData: ChatForm = {
                chat: {
                    title: 'Extracted Title',
                    models: [],
                    messages: [],
                },
            };

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
            const chatData: ChatForm = {
                chat: {
                    title: 'Complex Chat',
                    models: ['gpt-4'],
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
                    messages: [],
                },
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
            const chatData: ChatForm = {
                chat: {
                    title: 'New Chat',
                    models: [],
                    messages: [],
                },
            };

            await request(app)
                .post('/api/v1/chats/new')
                .send(chatData)
                .expect(401);
        });

        test('should fail with invalid authentication token', async () => {
            const chatData: ChatForm = {
                chat: {
                    title: 'New Chat',
                    models: [],
                    messages: [],
                },
            };

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
                    title: 'Updated Title',
                    models: ['gpt-4'],
                    messages: [],
                },
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
                    models: ['gpt-3.5-turbo'], // Different from original
                    messages: [],
                },
            };

            const response = await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send(updateData)
                .expect(200);

            assert.strictEqual(response.body.chat.title, 'Updated Title');
            assert.deepStrictEqual(response.body.chat.models, ['gpt-3.5-turbo']);
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
                    title: 'Updated Title',
                    models: [],
                    messages: [],
                },
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
                    title: 'Updated Title',
                    models: [],
                    messages: [],
                },
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
                    title: 'Updated Title',
                    models: [],
                    messages: [],
                },
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
                    title: 'Updated Title',
                    models: [],
                    messages: [],
                },
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
                    title: 'Updated Title',
                    models: [],
                    messages: [],
                },
            };

            await request(app)
                .post(`/api/v1/chats/${chat.id}`)
                .set('Authorization', 'Bearer invalid_token')
                .send(updateData)
                .expect(401);
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

        test('should return 404 when chat not found', async () => {
            const { token } = await createUserWithToken('user');
            const nonExistentId = crypto.randomUUID();

            const response = await request(app)
                .delete(`/api/v1/chats/${nonExistentId}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(404);

            assert.ok(response.body.detail);
        });

        test('should return 404 when user does not own the chat', async () => {
            const { userId: user1Id } = await createUserWithToken('user');
            const { token: token2 } = await createUserWithToken('user');

            const chat = await createTestChat(user1Id, 'User 1 Chat');

            const response = await request(app)
                .delete(`/api/v1/chats/${chat.id}`)
                .set('Authorization', `Bearer ${token2}`)
                .expect(404);

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
            const { items } = await Chats.getChatsByUserId(userId, {}, db);
            assert.strictEqual(items.length, 0);
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
            const { items: user1Chats } = await Chats.getChatsByUserId(user1Id, {}, db);
            assert.strictEqual(user1Chats.length, 0);

            // Verify user 2 chats still exist
            const { items: user2Chats } = await Chats.getChatsByUserId(user2Id, {}, db);
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
});
