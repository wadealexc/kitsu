import { describe, test, before } from 'node:test';
import assert from 'node:assert';

import { newDBWithAdmin, newUserParams, type TestDatabase } from '../../helpers.js';
import * as Models from '../../../src/db/operations/models.js';
import type { Model, NewModel } from '../../../src/db/operations/models.js';
import * as Users from '../../../src/db/operations/users.js';
import { models } from '../../../src/db/schema.js';
import type { ModelForm, AccessControl } from '../../../src/routes/types.js';
import { currentUnixTimestamp } from '../../../src/db/utils.js';

/* -------------------- TEST HELPERS -------------------- */

function createModelForm(overrides: Partial<NewModel> & { userId: string }): NewModel {
    const id = crypto.randomUUID();
    return {
        name: overrides?.name || `Test Model`,
        id: overrides?.id || overrides?.name || `Test Model ${id}`,
        baseModelId: overrides?.baseModelId !== undefined ? overrides.baseModelId : null,
        userId: overrides?.userId,
        params: overrides?.params || {},
        meta: overrides?.meta || {
            profile_image_url: 'img.png'
        },
        accessControl: overrides?.accessControl,
        isActive: overrides?.isActive !== undefined ? overrides.isActive : true,
    }
}

async function createTestModel(
    db: TestDatabase,
    userId: string,
    overrides?: Partial<NewModel>
): Promise<Model> {
    const modelForm = createModelForm({ ...overrides, userId });
    const model = await Models.insertNewModel(modelForm, db);
    assert.ok(model, 'Failed to create test model');
    return model;
}

async function createOldModel(
    db: TestDatabase,
    userId: string,
    overrides?: Partial<ModelForm>,
    createdAt?: number,
    updatedAt?: number,
): Promise<Model> {
    const modelForm = createModelForm({ ...overrides, userId });
    const now = currentUnixTimestamp();

    const [model] = await db
        .insert(models)
        .values({
            id: modelForm.id,
            userId: modelForm.userId,
            baseModelId: modelForm.baseModelId,
            name: modelForm.name,
            params: modelForm.params,
            meta: modelForm.meta,
            accessControl: modelForm.accessControl,
            isActive: modelForm.isActive,
            createdAt: createdAt ?? now - 1000,
            updatedAt: updatedAt ?? createdAt ?? now - 1000,
        })
        .returning();

    if (!model) throw new Error('createOldModel: error creating model record');
    return model;
}

async function getAllModels(db: TestDatabase): Promise<Model[]> {
    return await db
        .select()
        .from(models);
}

/* -------------------- CORE CRUD OPERATIONS -------------------- */

describe('insertNewModel', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
    });

    test('creates base model successfully', async () => {
        const modelForm = createModelForm({
            id: 'gpt-4-turbo',
            name: 'GPT-4 Turbo',
            baseModelId: null,
            userId: testUserId,
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.strictEqual(model.id, 'gpt-4-turbo');
        assert.strictEqual(model.name, 'GPT-4 Turbo');
        assert.strictEqual(model.baseModelId, null);
        assert.strictEqual(model.userId, testUserId);
        assert.strictEqual(model.isActive, true);
        assert.ok(model.createdAt);
        assert.ok(model.updatedAt);
        assert.strictEqual(model.createdAt, model.updatedAt);
    });

    test('creates custom model successfully', async () => {
        const modelForm = createModelForm({
            id: 'my-custom-gpt4',
            name: 'My Custom GPT-4',
            baseModelId: 'gpt-4-turbo',
            params: { temperature: 0.7, max_tokens: 2000 },
            meta: { profile_image_url: 'img.png', description: 'Custom configuration' },
            userId: testUserId,
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.strictEqual(model.id, 'my-custom-gpt4');
        assert.strictEqual(model.baseModelId, 'gpt-4-turbo');
        assert.deepStrictEqual(model.params, { temperature: 0.7, max_tokens: 2000 });
        assert.deepStrictEqual(model.meta, { profile_image_url: 'img.png', description: 'Custom configuration' });
    });

    test('creates model with access control', async () => {
        const accessControl: AccessControl = {
            read: { user_ids: [testUserId, 'other-user'] },
            write: { user_ids: [testUserId] },
        };

        const modelForm = createModelForm({
            accessControl,
            userId: testUserId,
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.deepStrictEqual(model.accessControl, accessControl);
    });

    test('creates inactive model', async () => {
        const modelForm = createModelForm({
            isActive: false,
            userId: testUserId,
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.strictEqual(model.isActive, false);
    });

    test('rejects duplicate model IDs', async () => {
        const modelForm = createModelForm({ id: 'duplicate-model', userId: testUserId, });

        await Models.insertNewModel(modelForm, db);

        // Attempt to create another model with same ID
        await assert.rejects(
            async () => await Models.insertNewModel(modelForm, db)
        );
    });
});

describe('getCustomModels', () => {
    let db: TestDatabase;
    let testUserId: string;
    let testUsername: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
        testUsername = user.username;

        // Create base models (should not be returned)
        await createTestModel(db, testUserId, {
            id: 'base-model',
            baseModelId: null,
        });

        // Create custom models (should be returned)
        await createTestModel(db, testUserId, {
            id: 'custom-1',
            baseModelId: 'base-model',
        });
        await createTestModel(db, testUserId, {
            id: 'custom-2',
            baseModelId: 'base-model',
        });
    });

    test('retrieves only custom models', async () => {
        const models = await Models.getCustomModels(db);

        assert.ok(models.length >= 2);
        assert.ok(models.every(m => m.baseModelId !== null));
        assert.ok(models.every(m => m.user));
    });

    test('includes user information', async () => {
        const models = await Models.getCustomModels(db);

        const customModel = models.find(m => m.id === 'custom-1');
        assert.ok(customModel);
        assert.strictEqual(customModel.user!.id, testUserId);
        assert.strictEqual(customModel.user!.username, testUsername);
        assert.ok(customModel.user!.role);
        assert.ok(customModel.user!.profileImageUrl);
    });

    test('excludes base models', async () => {
        const models = await Models.getCustomModels(db);

        assert.ok(!models.some(m => m.id === 'base-model'));
    });
});

describe('getModelById', () => {
    let db: TestDatabase;
    let testUserId: string;
    let testModel: Model;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
        testModel = await createTestModel(db, testUserId);
    });

    test('retrieves existing model', async () => {
        const model = await Models.getModelById(testModel.id, db);

        assert.ok(model);
        assert.strictEqual(model.id, testModel.id);
        assert.strictEqual(model.name, testModel.name);
        assert.strictEqual(model.userId, testUserId);
    });

    test('returns null for non-existent model', async () => {
        const model = await Models.getModelById('non-existent', db);

        assert.strictEqual(model, null);
    });
});

describe('updateModelById', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
    });

    test('updates model fields', async () => {
        const model = await createOldModel(db, testUserId);
        const originalUpdatedAt = model.updatedAt;

        const updated = await Models.updateModelById(
            model.id,
            {
                name: 'Updated Name',
                params: { temperature: 0.8 },
                meta: { profile_image_url: 'img.png', description: 'Updated' },
            },
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.name, 'Updated Name');
        assert.deepStrictEqual(updated.params, { temperature: 0.8 });
        assert.deepStrictEqual(updated.meta, { profile_image_url: 'img.png', description: 'Updated' });
        assert.ok(updated.updatedAt >= originalUpdatedAt);
    });

    test('updates baseModelId', async () => {
        const model = await createTestModel(db, testUserId, {
            baseModelId: 'old-base',
        });

        const updated = await Models.updateModelById(
            model.id,
            {
                baseModelId: 'new-base',
            },
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.baseModelId, 'new-base');
    });

    test('updates accessControl', async () => {
        const model = await createTestModel(db, testUserId);

        const newAccessControl: AccessControl = {
            read: { user_ids: ['user1', 'user2'] },
            write: { user_ids: ['user1'] },
        };

        const updated = await Models.updateModelById(
            model.id,
            {
                accessControl: newAccessControl,
            },
            db
        );

        assert.ok(updated);
        assert.deepStrictEqual(updated.accessControl, newAccessControl);
    });

    test('updates isActive', async () => {
        const model = await createTestModel(db, testUserId, { isActive: true });

        const updated = await Models.updateModelById(
            model.id,
            {
                isActive: false,
            },
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.isActive, false);
    });

    test('preserves userId and createdAt', async () => {
        const model = await createTestModel(db, testUserId);

        const updated = await Models.updateModelById(
            model.id,
            {
                name: 'Updated',
            },
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.userId, testUserId);
        assert.strictEqual(updated.createdAt, model.createdAt);
    });

    test('throws for non-existent model', async () => {
        await assert.rejects(
            async () => await Models.updateModelById('non-existent', {}, db),
            { message: `model record with id 'non-existent' not found` }
        );
    });
});

describe('toggleModelById', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
    });

    test('toggles active to inactive', async () => {
        const model = await createTestModel(db, testUserId, { isActive: true });

        const toggled = await Models.toggleModelById(model.id, db);

        assert.ok(toggled);
        assert.strictEqual(toggled.isActive, false);
        assert.ok(toggled.updatedAt >= model.updatedAt);
    });

    test('toggles inactive to active', async () => {
        const model = await createTestModel(db, testUserId, { isActive: false });

        const toggled = await Models.toggleModelById(model.id, db);

        assert.ok(toggled);
        assert.strictEqual(toggled.isActive, true);
    });

    test('updates timestamp on toggle', async () => {
        const model = await createOldModel(db, testUserId);
        const originalUpdatedAt = model.updatedAt;

        const toggled = await Models.toggleModelById(model.id, db);

        assert.ok(toggled);
        assert.ok(toggled.updatedAt > originalUpdatedAt);
    });

    test('throws for non-existent model', async () => {
        await assert.rejects(
            async () => await Models.toggleModelById('non-existent', db),
            { message: `model record with id 'non-existent' not found` }
        );
    });
});

describe('deleteModelById', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
    });

    test('deletes existing model', async () => {
        const model = await createTestModel(db, testUserId);

        await Models.deleteModelById(model.id, db);

        const retrieved = await Models.getModelById(model.id, db);
        assert.strictEqual(retrieved, null);
    });

    test('throws for non-existent model', async () => {
        await assert.rejects(
            async () => await Models.deleteModelById('non-existent', db),
            { message: `model record with id 'non-existent' not found` }
        );
    });
});

describe('deleteAllModels', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
    });

    test('deletes all models', async () => {
        // Create some models
        await createTestModel(db, testUserId);
        await createTestModel(db, testUserId);
        await createTestModel(db, testUserId);

        const beforeDelete = await getAllModels(db);
        assert.ok(beforeDelete.length == 3);

        await Models.deleteAllModels(db);

        const afterDelete = await getAllModels(db);
        assert.strictEqual(afterDelete.length, 0);
    });

    test('works on empty database', async () => {
        // Delete all models first
        await Models.deleteAllModels(db);

        // Try again
        await Models.deleteAllModels(db);
    });
});

/* -------------------- SEARCH & FILTERING -------------------- */

describe('searchModels', () => {
    let db: TestDatabase;
    let user1: { id: string; username: string };
    let user2: { id: string; username: string };

    before(async () => {
        db = await newDBWithAdmin();
        const u1 = await Users.createUser(newUserParams(), db);
        const u2 = await Users.createUser(newUserParams(), db);
        user1 = { id: u1.id, username: u1.username };
        user2 = { id: u2.id, username: u2.username };

        // Create base models
        await createTestModel(db, user1.id, {
            id: 'base-gpt4',
            name: 'GPT-4',
            baseModelId: null,
        });

        // Create custom models for user1
        await createTestModel(db, user1.id, {
            id: 'user1-gpt4-custom',
            name: 'User1 GPT-4 Custom',
            baseModelId: 'base-gpt4',
        });
        await createTestModel(db, user1.id, {
            id: 'user1-llama-custom',
            name: 'User1 Llama Custom',
            baseModelId: 'base-llama',
        });

        // Create custom models for user2 (public)
        await createTestModel(db, user2.id, {
            id: 'user2-public',
            name: 'User2 Public Model',
            baseModelId: 'base-gpt4',
            accessControl: null,
        });

        // Create custom models for user2 (private)
        await createTestModel(db, user2.id, {
            id: 'user2-private',
            name: 'User2 Private Model',
            baseModelId: 'base-gpt4',
            accessControl: {},
        });

        // Create custom models with shared access
        await createTestModel(db, user2.id, {
            id: 'user2-shared',
            name: 'User2 Shared Model',
            baseModelId: 'base-gpt4',
            accessControl: {
                read: { user_ids: [user1.id, user2.id] },
                write: { user_ids: [user2.id] },
            },
        });
    });

    test('searches all accessible models', async () => {
        const result = await Models.searchModels(user1.id, {}, 0, 30, db);

        // Should include: user1's models, public models, and shared models
        assert.ok(result.total == 4);
        assert.ok(result.items.some(m => m.id === 'user1-gpt4-custom'));
        assert.ok(result.items.some(m => m.id === 'user1-llama-custom'));
        assert.ok(result.items.some(m => m.id === 'user2-public'));
        assert.ok(result.items.some(m => m.id === 'user2-shared'));
    });

    test('excludes private models from other users', async () => {
        const result = await Models.searchModels(user1.id, {}, 0, 30, db);

        assert.ok(!result.items.some(m => m.id === 'user2-private'));
    });

    test('filters by query string', async () => {
        const result = await Models.searchModels(
            user1.id,
            { query: 'GPT' },
            0,
            30,
            db
        );

        assert.ok(result.items.length > 0);
        assert.ok(result.items.every(
            m => m.name.toUpperCase().includes('GPT') || m.baseModelId?.toUpperCase().includes('GPT'))
        );
    });

    test('filters by viewOption: created', async () => {
        const result = await Models.searchModels(
            user1.id,
            { viewOption: 'created' },
            0,
            30,
            db
        );

        assert.ok(result.items.every(m => m.userId === user1.id));
        assert.ok(result.items.some(m => m.id === 'user1-gpt4-custom'));
    });

    test('filters by viewOption: shared', async () => {
        const result = await Models.searchModels(
            user1.id,
            { viewOption: 'shared' },
            0,
            30,
            db
        );

        assert.ok(result.items.every(m => m.userId !== user1.id));
        assert.ok(!result.items.some(m => m.id === 'user1-gpt4-custom'));
    });

    test('sorts by name ascending', async () => {
        const result = await Models.searchModels(
            user1.id,
            { orderBy: 'name', direction: 'asc' },
            0,
            30,
            db
        );

        assert.ok(result.items.length > 0);
        for (let i = 1; i < result.items.length; i++) {
            assert.ok(result.items[i]!.name >= result.items[i - 1]!.name);
        }
    });

    test('sorts by name descending', async () => {
        const result = await Models.searchModels(
            user1.id,
            { orderBy: 'name', direction: 'desc' },
            0,
            30,
            db
        );

        assert.ok(result.items.length > 0);
        for (let i = 1; i < result.items.length; i++) {
            assert.ok(result.items[i]!.name <= result.items[i - 1]!.name);
        }
    });

    test('sorts by created_at', async () => {
        const result = await Models.searchModels(
            user1.id,
            { orderBy: 'created_at', direction: 'desc' },
            0,
            30,
            db
        );

        assert.ok(result.items.length > 0);
        for (let i = 1; i < result.items.length; i++) {
            assert.ok(result.items[i]!.createdAt <= result.items[i - 1]!.createdAt);
        }
    });

    test('sorts by updated_at (default)', async () => {
        const result = await Models.searchModels(user1.id, {}, 0, 30, db);

        assert.ok(result.items.length > 0);
        for (let i = 1; i < result.items.length; i++) {
            assert.ok(result.items[i]!.updatedAt <= result.items[i - 1]!.updatedAt);
        }
    });

    test('paginates results', async () => {
        const page1 = await Models.searchModels(user1.id, {}, 0, 2, db);
        const page2 = await Models.searchModels(user1.id, {}, 2, 2, db);

        assert.ok(page1.items.length <= 2);
        if (page1.total > 2) {
            assert.ok(page2.items.length > 0);
            // Verify different results
            assert.ok(!page1.items.some(m1 => page2.items.some(m2 => m1.id === m2.id)));
        }
    });

    test('includes user information', async () => {
        const result = await Models.searchModels(user1.id, {}, 0, 30, db);

        assert.ok(result.items.length > 0);
        result.items.forEach(item => {
            assert.ok(item.user);
            assert.ok(item.user.id);
            assert.ok(item.user.username);
            assert.ok(item.user.role);
            assert.ok(item.user.profileImageUrl);
        });
    });

    test('returns correct total count', async () => {
        const result = await Models.searchModels(user1.id, {}, 0, 2, db);

        assert.ok(result.total >= result.items.length);
    });

    test('excludes base models', async () => {
        const result = await Models.searchModels(user1.id, {}, 0, 30, db);

        assert.ok(!result.items.some(m => m.id === 'base-gpt4'));
    });
});

/* -------------------- ACCESS CONTROL OPERATIONS -------------------- */

describe('hasAccess', () => {
    const ownerId = 'owner-123';
    const userId = 'user-123';
    const otherUserId = 'user-456';

    function _model(ac: AccessControl | null): Model {
        return {
            id: 'Test Model',
            name: 'test-model',
            baseModelId: null,
            userId: ownerId,
            isActive: true,
            updatedAt: 0,
            createdAt: 0,
            meta: { profile_image_url: 'img.png' },
            params: {},
            accessControl: ac,
        }
    }

    test('allows public read access (null accessControl)', () => {
        const hasRead = Models.hasAccess(_model(null), userId, 'read');
        assert.strictEqual(hasRead, true);
    });

    test('denies public write access (null accessControl)', () => {
        const hasWrite = Models.hasAccess(_model(null), userId, 'write');
        assert.strictEqual(hasWrite, false);
    });

    test('denies access for empty accessControl', () => {
        const hasRead = Models.hasAccess(_model({}), userId, 'read');
        const hasWrite = Models.hasAccess(_model({}), userId, 'write');

        assert.strictEqual(hasRead, false);
        assert.strictEqual(hasWrite, false);
    });

    test('allows read access for users in read.user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [userId, otherUserId] },
            write: { user_ids: [otherUserId] },
        };

        const hasRead = Models.hasAccess(_model(accessControl), userId, 'read');
        assert.strictEqual(hasRead, true);
    });

    test('allows write access for users in write.user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [otherUserId] },
            write: { user_ids: [userId] },
        };

        const hasWrite = Models.hasAccess(_model(accessControl), userId, 'write');
        assert.strictEqual(hasWrite, true);
    });

    test('denies read access for users not in read.user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [otherUserId] },
            write: { user_ids: [] },
        };

        const hasRead = Models.hasAccess(_model(accessControl), userId, 'read');
        assert.strictEqual(hasRead, false);
    });

    test('denies write access for users not in write.user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [userId] },
            write: { user_ids: [otherUserId] },
        };

        const hasWrite = Models.hasAccess(_model(accessControl), userId, 'write');
        assert.strictEqual(hasWrite, false);
    });

    test('handles missing read property', () => {
        const accessControl: AccessControl = {
            write: { user_ids: [userId] },
        };

        const hasRead = Models.hasAccess(_model(accessControl), userId, 'read');
        assert.strictEqual(hasRead, false);
    });

    test('handles missing write property', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [userId] },
        };

        const hasWrite = Models.hasAccess(_model(accessControl), userId, 'write');
        assert.strictEqual(hasWrite, false);
    });

    test('handles empty user_ids array', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [] },
            write: { user_ids: [] },
        };

        const hasRead = Models.hasAccess(_model(accessControl), userId, 'read');
        const hasWrite = Models.hasAccess(_model(accessControl), userId, 'write');

        assert.strictEqual(hasRead, false);
        assert.strictEqual(hasWrite, false);
    });

    test('handles undefined user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [] },
            write: { user_ids: [] },
        };

        const hasRead = Models.hasAccess(_model(accessControl), userId, 'read');
        const hasWrite = Models.hasAccess(_model(accessControl), userId, 'write');

        assert.strictEqual(hasRead, false);
        assert.strictEqual(hasWrite, false);
    });
});

/* -------------------- EDGE CASES & SPECIAL SCENARIOS -------------------- */

describe('Edge Cases', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
    });

    test('handles model IDs with special characters', async () => {
        const modelForm = createModelForm({
            userId: testUserId,
            id: 'model:with/special-chars_123',
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.strictEqual(model.id, 'model:with/special-chars_123');

        const retrieved = await Models.getModelById('model:with/special-chars_123', db);
        assert.ok(retrieved);
    });

    test('handles empty params', async () => {
        const modelForm = createModelForm({
            userId: testUserId,
            params: {},
            meta: { profile_image_url: 'img.png' },
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.deepStrictEqual(model.params, {});
        assert.deepStrictEqual(model.meta, { profile_image_url: 'img.png' });
    });

    test('handles complex nested params and meta', async () => {
        const modelForm = createModelForm({
            userId: testUserId,
            params: {
                temperature: 0.7,
                top_p: 0.9,
                nested: { deep: { value: 123 } },
            },
            meta: {
                profile_image_url: 'img.png',
                description: 'Test',
                capabilities: { vision: true },
                array: [1, 2, 3],
            },
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.deepStrictEqual(model.params, {
            temperature: 0.7,
            top_p: 0.9,
            nested: { deep: { value: 123 } },
        });
        assert.deepStrictEqual(model.meta, {
            profile_image_url: 'img.png',
            description: 'Test',
            capabilities: { vision: true },
            array: [1, 2, 3],
        });
    });

    test('handles search with no results', async () => {
        const result = await Models.searchModels(
            testUserId,
            { query: 'nonexistent-query-xyz' },
            0,
            30,
            db
        );

        assert.strictEqual(result.total, 0);
        assert.strictEqual(result.items.length, 0);
    });

    test('handles pagination beyond results', async () => {
        await createTestModel(db, testUserId, { baseModelId: 'base' });

        const result = await Models.searchModels(testUserId, {}, 100, 30, db);

        assert.strictEqual(result.items.length, 0);
        assert.ok(result.total > 0);
    });

    test('handles multiple users with same model access', async () => {
        const user2 = await Users.createUser(newUserParams(), db);
        const user3 = await Users.createUser(newUserParams(), db);

        const accessControl: AccessControl = {
            read: { user_ids: [testUserId, user2.id, user3.id] },
            write: { user_ids: [testUserId] },
        };

        const model = await createTestModel(db, testUserId, {
            baseModelId: 'base',
            accessControl: accessControl,
        });

        const result1 = await Models.searchModels(testUserId, {}, 0, 30, db);
        const result2 = await Models.searchModels(user2.id, {}, 0, 30, db);
        const result3 = await Models.searchModels(user3.id, {}, 0, 30, db);

        assert.ok(result1.items.some(m => m.id === model.id));
        assert.ok(result2.items.some(m => m.id === model.id));
        assert.ok(result3.items.some(m => m.id === model.id));
    });

    test('handles timestamp precision', async () => {
        const before = currentUnixTimestamp();
        const model = await createTestModel(db, testUserId);
        const after = currentUnixTimestamp();

        assert.ok(model.createdAt >= before);
        assert.ok(model.createdAt <= after);
        assert.ok(model.updatedAt >= before);
        assert.ok(model.updatedAt <= after);
    });
});
