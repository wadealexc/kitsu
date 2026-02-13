import { describe, test, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import express, { type Express } from 'express';

import { assertInMemoryDatabase, createUserWithToken } from '../helpers.js';
import { db } from '../../src/db/client.js';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../../src/db/schema.js';
import * as Models from '../../src/db/operations/models.js';
import { type Model } from '../../src/db/operations/models.js';
import { MockLlama } from '../mockLlama.js';
import modelsRouter from '../../src/routes/models.js';
import type { ModelForm, SyncModelsForm } from '../../src/routes/types.js';

/* -------------------- TEST SETUP -------------------- */

// Ensure tests use in-memory database
assertInMemoryDatabase();

// Apply migrations to the in-memory database
await migrate(db, { migrationsFolder: './drizzle' });

// Helper function to clear database tables
async function clearDatabase() {
    await db.delete(schema.models);
    await db.delete(schema.auths);
    await db.delete(schema.users);
}

// Create Express app with models routes
const app: Express = express();
app.use(express.json());

// Set up mock LlamaManager with test base models
const mockLlama = new MockLlama(['qwen3-vl-30b', 'llama3-70b']);
app.locals.llama = mockLlama;

// Mount router
app.use('/api/v1/models', modelsRouter);

/* -------------------- HELPER FUNCTIONS -------------------- */

/**
 * Create a custom model for testing
 */
async function createCustomModel(
    userId: string,
    overrides?: {
        id?: string;
        name?: string;
        baseModelId?: string;
        accessControl?: any;
        isActive?: boolean;
    }
) {
    const modelId = overrides?.id || `custom-model-${crypto.randomUUID()}`;
    const model = await Models.insertNewModel(
        {
            id: modelId,
            userId,
            name: overrides?.name || 'Test Custom Model',
            baseModelId: overrides?.baseModelId || 'qwen3-vl-30b',
            params: { temperature: 0.7 },
            meta: {
                profile_image_url: '/static/favicon.png',
                description: 'Test model',
                capabilities: null,
            },
            accessControl: overrides?.accessControl || null,
            isActive: overrides?.isActive ?? true,
        },
        db
    );
    return model!;
}

async function getAllModels(_db: typeof db): Promise<Model[]> {
    return await _db
        .select()
        .from(schema.models);
}

/* -------------------- TESTS -------------------- */

describe('GET /api/v1/models/', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should accessible custom models for non-admin', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId);

        const response = await request(app)
            .get('/api/v1/models/')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.data);
        assert.ok(Array.isArray(response.body.data));
        assert.strictEqual(response.body.data.length, 1);
        assert.strictEqual(response.body.data[0].base_model_id, 'qwen3-vl-30b');
    });

    test('should accessible custom models and base models for admin', async () => {
        const { userId, token } = await createUserWithToken('admin');
        await createCustomModel(userId);

        const response = await request(app)
            .get('/api/v1/models/')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.data);
        assert.ok(Array.isArray(response.body.data));
        assert.strictEqual(response.body.data.length, 3); // 2 base + 1 custom

        // Verify base models
        const baseModels = response.body.data.filter((m: any) => m.base_model_id === null);
        assert.strictEqual(baseModels.length, 2);
        assert.ok(baseModels.some((m: any) => m.id === 'qwen3-vl-30b'));
        assert.ok(baseModels.some((m: any) => m.id === 'llama3-70b'));

        // Verify custom models
        const customModels = response.body.data.filter((m: any) => m.base_model_id !== null);
        assert.strictEqual(customModels.length, 1);
        assert.strictEqual(customModels[0].base_model_id, 'qwen3-vl-30b');
    });

    test('should filter custom models by access control', async () => {
        const { userId: userId1, token: token1 } = await createUserWithToken('user');
        const { userId: userId2 } = await createUserWithToken('user');

        // User 1 creates a private model
        await createCustomModel(userId1, {
            accessControl: { read: { user_ids: [userId1] }, write: { user_ids: [userId1] } },
        });

        // User 2 should only see base models
        const response = await request(app)
            .get('/api/v1/models/')
            .set('Authorization', `Bearer ${token1}`)
            .expect(200);

        assert.strictEqual(response.body.data.length, 1); // 1 accessible custom
    });

    test('should include public custom models for all users', async () => {
        const { userId: userId1 } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        // User 1 creates a public model (access_control = null)
        await createCustomModel(userId1, { accessControl: null });

        // User 2 should see it
        const response = await request(app)
            .get('/api/v1/models/')
            .set('Authorization', `Bearer ${token2}`)
            .expect(200);

        assert.strictEqual(response.body.data.length, 1); // 1 public custom
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/models/')
            .expect(401);
    });

    test('should fail with invalid authentication token', async () => {
        await request(app)
            .get('/api/v1/models/')
            .set('Authorization', 'Bearer invalid_token')
            .expect(401);
    });
});

describe('GET /api/v1/models/list', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return paginated custom models only', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId);
        await createCustomModel(userId);

        const response = await request(app)
            .get('/api/v1/models/list')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(response.body.items);
        assert.ok(Array.isArray(response.body.items));
        assert.strictEqual(response.body.items.length, 2);
        assert.strictEqual(response.body.total, 2);

        // Verify no base models
        assert.ok(response.body.items.every((m: any) => m.base_model_id !== null));

        // Verify response includes user and write_access
        const model = response.body.items[0];
        assert.ok(model.user);
        assert.ok(typeof model.write_access === 'boolean');
    });

    test('should include write_access flag based on permissions', async () => {
        const { userId: userId1, token: token1 } = await createUserWithToken('user');
        const { userId: userId2 } = await createUserWithToken('user');

        // User 1 creates a model
        await createCustomModel(userId1);

        // User 2 creates a model with write access for user 1
        await createCustomModel(userId2, {
            accessControl: {
                read: { user_ids: [userId1, userId2] },
                write: { user_ids: [userId2] },
            },
        });

        const response = await request(app)
            .get('/api/v1/models/list')
            .set('Authorization', `Bearer ${token1}`)
            .expect(200);

        assert.strictEqual(response.body.items.length, 2);

        // User 1's own model should have write_access = true
        const ownModel = response.body.items.find((m: any) => m.user_id === userId1);
        assert.strictEqual(ownModel.write_access, true);

        // User 2's model should have write_access = false for user 1
        const sharedModel = response.body.items.find((m: any) => m.user_id === userId2);
        assert.strictEqual(sharedModel.write_access, false);
    });

    test('should support pagination with page parameter', async () => {
        const { userId, token } = await createUserWithToken('user');

        // Create 35 models (more than page size of 30)
        for (let i = 0; i < 35; i++) {
            await createCustomModel(userId);
        }

        const page1Response = await request(app)
            .get('/api/v1/models/list')
            .query({ page: 1 })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(page1Response.body.items.length, 30);
        assert.strictEqual(page1Response.body.total, 35);

        const page2Response = await request(app)
            .get('/api/v1/models/list')
            .query({ page: 2 })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(page2Response.body.items.length, 5);
        assert.strictEqual(page2Response.body.total, 35);
    });

    test('should support sorting by order_by and direction', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId, { name: 'Zebra Model' });
        await createCustomModel(userId, { name: 'Alpha Model' });

        const response = await request(app)
            .get('/api/v1/models/list')
            .query({ order_by: 'name', direction: 'asc' })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.items.length, 2);
        assert.strictEqual(response.body.items[0].name, 'Alpha Model');
        assert.strictEqual(response.body.items[1].name, 'Zebra Model');
    });

    test('should filter by search query', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId, { name: 'GPT Model' });
        await createCustomModel(userId, { name: 'BERT Model' });

        const response = await request(app)
            .get('/api/v1/models/list')
            .query({ query: 'GPT' })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.items.length, 1);
        assert.strictEqual(response.body.items[0].name, 'GPT Model');
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/models/list')
            .expect(401);
    });

    test('should validate query parameters', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/models/list')
            .query({ page: 'not_a_number' })
            .set('Authorization', `Bearer ${token}`)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('GET /api/v1/models/base', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return base models for admin', async () => {
        const { token } = await createUserWithToken('admin');

        const response = await request(app)
            .get('/api/v1/models/base')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.ok(Array.isArray(response.body));
        assert.strictEqual(response.body.length, 2);
        assert.ok(response.body.some((m: any) => m.id === 'qwen3-vl-30b'));
        assert.ok(response.body.some((m: any) => m.id === 'llama3-70b'));

        // Verify base_model_id is null
        assert.ok(response.body.every((m: any) => m.base_model_id === null));
    });

    test('should fail with 403 for non-admin users', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/models/base')
            .set('Authorization', `Bearer ${token}`)
            .expect(403);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/models/base')
            .expect(401);
    });
});

describe('POST /api/v1/models/create', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should create custom model with valid data', async () => {
        const { userId, token } = await createUserWithToken('user');

        const modelData: ModelForm = {
            id: 'test-custom-model',
            name: 'Test Custom Model',
            base_model_id: 'qwen3-vl-30b',
            params: { temperature: 0.8 },
            meta: {
                profile_image_url: '/static/favicon.png',
                description: 'Test description',
                capabilities: null,
            },
            is_active: true,
        };

        const response = await request(app)
            .post('/api/v1/models/create')
            .set('Authorization', `Bearer ${token}`)
            .send(modelData)
            .expect(200);

        assert.strictEqual(response.body.id, 'test-custom-model');
        assert.strictEqual(response.body.name, 'Test Custom Model');
        assert.strictEqual(response.body.base_model_id, 'qwen3-vl-30b');
        assert.strictEqual(response.body.user_id, userId);
        assert.strictEqual(response.body.is_active, true);

        // Verify in database
        const model = await Models.getModelById('test-custom-model', db);
        assert.ok(model);
        assert.strictEqual(model.userId, userId);
    });

    test('should fail when base_model_id does not exist in LlamaManager', async () => {
        const { token } = await createUserWithToken('user');

        const modelData = {
            id: 'test-custom-model',
            name: 'Test Custom Model',
            base_model_id: 'nonexistent-model',
            params: {},
            meta: { profile_image_url: '/static/favicon.png', description: null, capabilities: null },
        };

        const response = await request(app)
            .post('/api/v1/models/create')
            .set('Authorization', `Bearer ${token}`)
            .send(modelData)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.detail.includes('base model not found'));
    });

    test('should fail when model ID already exists', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId, { id: 'duplicate-id' });

        const modelData = {
            id: 'duplicate-id',
            name: 'Another Model',
            base_model_id: 'qwen3-vl-30b',
            params: {},
            meta: { profile_image_url: '/static/favicon.png', description: null, capabilities: null },
        };

        const response = await request(app)
            .post('/api/v1/models/create')
            .set('Authorization', `Bearer ${token}`)
            .send(modelData)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.detail.includes('already taken'));
    });

    test('should fail when model ID exceeds 256 characters', async () => {
        const { token } = await createUserWithToken('user');

        const longId = 'a'.repeat(257);
        const modelData = {
            id: longId,
            name: 'Test Model',
            base_model_id: 'qwen3-vl-30b',
            params: {},
            meta: { profile_image_url: '/static/favicon.png', description: null, capabilities: null },
        };

        const response = await request(app)
            .post('/api/v1/models/create')
            .set('Authorization', `Bearer ${token}`)
            .send(modelData)
            .expect(400);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .post('/api/v1/models/create')
            .send({ id: 'test', name: 'Test', base_model_id: 'qwen3-vl-30b', params: {}, meta: {} })
            .expect(401);
    });

    test('should validate request body schema', async () => {
        const { token } = await createUserWithToken('user');

        const invalidData = {
            id: 'test',
            // Missing name
            base_model_id: 'qwen3-vl-30b',
        };

        const response = await request(app)
            .post('/api/v1/models/create')
            .set('Authorization', `Bearer ${token}`)
            .send(invalidData)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('GET /api/v1/models/model', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should return custom model by ID', async () => {
        const { userId, token } = await createUserWithToken('user');
        const model = await createCustomModel(userId, { id: 'my-custom-model' });

        const response = await request(app)
            .get('/api/v1/models/model')
            .query({ id: 'my-custom-model' })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.id, 'my-custom-model');
        assert.strictEqual(response.body.base_model_id, model.baseModelId);
        assert.strictEqual(response.body.write_access, true); // Owner has write access
        assert.ok(response.body.user);
    });

    test('should return custom model with read access but not write access', async () => {
        const { userId: userId1 } = await createUserWithToken('user');
        const { userId: userId2, token: token2 } = await createUserWithToken('user');

        await createCustomModel(userId1, {
            id: 'shared-model',
            accessControl: {
                read: { user_ids: [userId1, userId2] },
                write: { user_ids: [userId1] },
            },
        });

        const response = await request(app)
            .get('/api/v1/models/model')
            .query({ id: 'shared-model' })
            .set('Authorization', `Bearer ${token2}`)
            .expect(200);

        assert.strictEqual(response.body.id, 'shared-model');
        assert.strictEqual(response.body.write_access, false); // No write access
    });

    test('should fail when custom model is not accessible', async () => {
        const { userId: userId1 } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        await createCustomModel(userId1, {
            id: 'private-model',
            accessControl: {
                read: { user_ids: [userId1] },
                write: { user_ids: [userId1] },
            },
        });

        const response = await request(app)
            .get('/api/v1/models/model')
            .query({ id: 'private-model' })
            .set('Authorization', `Bearer ${token2}`)
            .expect(401);

        assert.ok(response.body.detail);
    });

    test('should return 404 when model not found', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/models/model')
            .query({ id: 'nonexistent-model' })
            .set('Authorization', `Bearer ${token}`)
            .expect(404);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .get('/api/v1/models/model')
            .query({ id: 'qwen3-vl-30b' })
            .expect(401);
    });

    test('should validate query parameters', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .get('/api/v1/models/model')
            .set('Authorization', `Bearer ${token}`)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('POST /api/v1/models/model/toggle', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should toggle custom model active status', async () => {
        const { userId, token } = await createUserWithToken('user');
        const model = await createCustomModel(userId, { id: 'toggle-model', isActive: true });

        const response = await request(app)
            .post('/api/v1/models/model/toggle')
            .query({ id: 'toggle-model' })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.id, 'toggle-model');
        assert.strictEqual(response.body.is_active, false);

        // Verify in database
        const updated = await Models.getModelById('toggle-model', db);
        assert.strictEqual(updated?.isActive, false);
    });

    test('should toggle from false to true', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId, { id: 'toggle-model', isActive: false });

        const response = await request(app)
            .post('/api/v1/models/model/toggle')
            .query({ id: 'toggle-model' })
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body.is_active, true);
    });

    test('should fail when trying to toggle base model', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/models/model/toggle')
            .query({ id: 'qwen3-vl-30b' })
            .set('Authorization', `Bearer ${token}`)
            .expect(404);

        assert.ok(response.body.detail);
    });

    test('should fail without write access', async () => {
        const { userId: userId1 } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        await createCustomModel(userId1, {
            id: 'readonly-model',
            accessControl: {
                read: { user_ids: [userId1] },
                write: { user_ids: [userId1] },
            },
        });

        const response = await request(app)
            .post('/api/v1/models/model/toggle')
            .query({ id: 'readonly-model' })
            .set('Authorization', `Bearer ${token2}`)
            .expect(401);

        assert.ok(response.body.detail);
    });

    test('should fail when model not found', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/models/model/toggle')
            .query({ id: 'nonexistent-model' })
            .set('Authorization', `Bearer ${token}`)
            .expect(404);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .post('/api/v1/models/model/toggle')
            .query({ id: 'some-model' })
            .expect(401);
    });
});

describe('POST /api/v1/models/model/update', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should update custom model with valid data', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId, { id: 'update-model' });

        const updateData = {
            id: 'update-model',
            name: 'Updated Model Name',
            base_model_id: 'llama3-70b',
            params: { temperature: 0.9 },
            meta: {
                profile_image_url: '/new-image.png',
                description: 'Updated description',
                capabilities: null,
            },
            access_control: { read: { user_ids: [userId] }, write: { user_ids: [userId] } },
            is_active: false,
        };

        const response = await request(app)
            .post('/api/v1/models/model/update')
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(200);

        assert.strictEqual(response.body.id, 'update-model');
        assert.strictEqual(response.body.name, 'Updated Model Name');
        assert.strictEqual(response.body.base_model_id, 'llama3-70b');
        assert.strictEqual(response.body.is_active, false);

        // Verify in database
        const updated = await Models.getModelById('update-model', db);
        assert.strictEqual(updated?.name, 'Updated Model Name');
    });

    test('should fail when trying to update base model', async () => {
        const { token } = await createUserWithToken('user');

        const updateData = {
            id: 'qwen3-vl-30b',
            name: 'Hacked Base Model',
            base_model_id: 'qwen3-vl-30b',
            params: {},
            meta: { profile_image_url: '/static/favicon.png', description: null, capabilities: null },
        };

        const response = await request(app)
            .post('/api/v1/models/model/update')
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(404);

        assert.ok(response.body.detail);
    });

    test('should fail when new base_model_id does not exist', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId, { id: 'update-model' });

        const updateData = {
            id: 'update-model',
            name: 'Test',
            base_model_id: 'nonexistent-base-model',
            params: {},
            meta: { profile_image_url: '/static/favicon.png', description: null, capabilities: null },
        };

        const response = await request(app)
            .post('/api/v1/models/model/update')
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.detail.includes('not found'));
    });

    test('should fail without write access', async () => {
        const { userId: userId1 } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        await createCustomModel(userId1, {
            id: 'readonly-model',
            accessControl: {
                read: { user_ids: [userId1] },
                write: { user_ids: [userId1] },
            },
        });

        const updateData = {
            id: 'readonly-model',
            name: 'Hacked Name',
            base_model_id: 'qwen3-vl-30b',
            params: {},
            meta: { profile_image_url: '/static/favicon.png', description: null, capabilities: null },
        };

        const response = await request(app)
            .post('/api/v1/models/model/update')
            .set('Authorization', `Bearer ${token2}`)
            .send(updateData)
            .expect(401);

        assert.ok(response.body.detail);
    });

    test('should fail when model not found', async () => {
        const { token } = await createUserWithToken('user');

        const updateData = {
            id: 'nonexistent-model',
            name: 'Test',
            base_model_id: 'qwen3-vl-30b',
            params: {},
            meta: { profile_image_url: '/static/favicon.png', description: null, capabilities: null },
        };

        const response = await request(app)
            .post('/api/v1/models/model/update')
            .set('Authorization', `Bearer ${token}`)
            .send(updateData)
            .expect(404);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .post('/api/v1/models/model/update')
            .send({ id: 'test', name: 'Test', base_model_id: 'qwen3-vl-30b', params: {}, meta: {} })
            .expect(401);
    });

    test('should validate request body schema', async () => {
        const { token } = await createUserWithToken('user');

        const invalidData = {
            id: 'test',
            // Missing required fields
        };

        const response = await request(app)
            .post('/api/v1/models/model/update')
            .set('Authorization', `Bearer ${token}`)
            .send(invalidData)
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('POST /api/v1/models/model/delete', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should delete custom model successfully', async () => {
        const { userId, token } = await createUserWithToken('user');
        await createCustomModel(userId, { id: 'delete-model' });

        const response = await request(app)
            .post('/api/v1/models/model/delete')
            .set('Authorization', `Bearer ${token}`)
            .send({ id: 'delete-model' })
            .expect(200);

        assert.strictEqual(response.body, true);

        // Verify deletion in database
        const deleted = await Models.getModelById('delete-model', db);
        assert.strictEqual(deleted, null);
    });

    test('should fail when trying to delete base model', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/models/model/delete')
            .set('Authorization', `Bearer ${token}`)
            .send({ id: 'qwen3-vl-30b' })
            .expect(404);

        assert.ok(response.body.detail);
    });

    test('should fail without write access', async () => {
        const { userId: userId1 } = await createUserWithToken('user');
        const { token: token2 } = await createUserWithToken('user');

        await createCustomModel(userId1, {
            id: 'protected-model',
            accessControl: {
                read: { user_ids: [userId1] },
                write: { user_ids: [userId1] },
            },
        });

        const response = await request(app)
            .post('/api/v1/models/model/delete')
            .set('Authorization', `Bearer ${token2}`)
            .send({ id: 'protected-model' })
            .expect(401);

        assert.ok(response.body.detail);
    });

    test('should fail when model not found', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/models/model/delete')
            .set('Authorization', `Bearer ${token}`)
            .send({ id: 'nonexistent-model' })
            .expect(404);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .post('/api/v1/models/model/delete')
            .send({ id: 'some-model' })
            .expect(401);
    });

    test('should validate request body schema', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .post('/api/v1/models/model/delete')
            .set('Authorization', `Bearer ${token}`)
            .send({})
            .expect(400);

        assert.ok(response.body.detail);
        assert.ok(response.body.errors);
    });
});

describe('DELETE /api/v1/models/delete/all', () => {
    beforeEach(async () => {
        await clearDatabase();
    });

    test('should delete all custom models for admin', async () => {
        const { userId, token } = await createUserWithToken('admin');
        await createCustomModel(userId);
        await createCustomModel(userId);
        await createCustomModel(userId);

        const response = await request(app)
            .delete('/api/v1/models/delete/all')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(response.body, true);

        // Verify all models deleted
        const models = await getAllModels(db);
        assert.strictEqual(models.length, 0);
    });

    test('should only delete custom models, not affect base models', async () => {
        const { userId, token } = await createUserWithToken('admin');
        await createCustomModel(userId);

        await request(app)
            .delete('/api/v1/models/delete/all')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        // Base models should still be accessible
        const baseResponse = await request(app)
            .get('/api/v1/models/base')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        assert.strictEqual(baseResponse.body.length, 2);
    });

    test('should fail with 403 for non-admin users', async () => {
        const { token } = await createUserWithToken('user');

        const response = await request(app)
            .delete('/api/v1/models/delete/all')
            .set('Authorization', `Bearer ${token}`)
            .expect(403);

        assert.ok(response.body.detail);
    });

    test('should fail without authentication token', async () => {
        await request(app)
            .delete('/api/v1/models/delete/all')
            .expect(401);
    });
});
