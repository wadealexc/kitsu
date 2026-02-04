import { describe, test, before } from 'node:test';
import assert from 'node:assert';
import { createTestDatabase, newDBWithAdmin, newUserParams, type TestDatabase } from '../../helpers.js';
import * as Models from '../../../src/db/operations/models.js';
import * as Users from '../../../src/db/operations/users.js';
import { models, type Model } from '../../../src/db/schema.js';
import type { ModelForm, AccessControl } from '../../../src/routes/types.js';
import { currentUnixTimestamp } from '../../../src/db/utils.js';

/* -------------------- TEST HELPERS -------------------- */

function createModelForm(overrides?: Partial<ModelForm>): ModelForm {
    const id = crypto.randomUUID();
    return {
        id: overrides?.id || `test-model-${id}`,
        name: overrides?.name || `Test Model ${id}`,
        base_model_id: overrides?.base_model_id !== undefined ? overrides.base_model_id : null,
        params: overrides?.params || {},
        meta: overrides?.meta || {},
        access_control: overrides?.access_control !== undefined ? overrides.access_control : null,
        is_active: overrides?.is_active !== undefined ? overrides.is_active : true,
    };
}

async function createTestModel(
    db: TestDatabase,
    userId: string,
    overrides?: Partial<ModelForm>
): Promise<Model> {
    const modelForm = createModelForm(overrides);
    const model = await Models.insertNewModel(modelForm, userId, db);
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
    const modelForm = createModelForm(overrides);
    const now = currentUnixTimestamp();

    const [model] = await db
        .insert(models)
        .values({
            id: modelForm.id,
            userId: userId,
            baseModelId: modelForm.base_model_id,
            name: modelForm.name,
            params: modelForm.params,
            meta: modelForm.meta,
            accessControl: modelForm.access_control,
            isActive: modelForm.is_active,
            createdAt: createdAt ?? now - 1000,
            updatedAt: updatedAt ?? createdAt ?? now - 1000,
        })
        .returning();

    if (!model) throw new Error('createOldModel: error creating model record');
    return model;
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
            base_model_id: null,
        });

        const model = await Models.insertNewModel(modelForm, testUserId, db);

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
            base_model_id: 'gpt-4-turbo',
            params: { temperature: 0.7, max_tokens: 2000 },
            meta: { description: 'Custom configuration' },
        });

        const model = await Models.insertNewModel(modelForm, testUserId, db);

        assert.ok(model);
        assert.strictEqual(model.id, 'my-custom-gpt4');
        assert.strictEqual(model.baseModelId, 'gpt-4-turbo');
        assert.deepStrictEqual(model.params, { temperature: 0.7, max_tokens: 2000 });
        assert.deepStrictEqual(model.meta, { description: 'Custom configuration' });
    });

    test('creates model with access control', async () => {
        const accessControl: AccessControl = {
            read: { user_ids: [testUserId, 'other-user'] },
            write: { user_ids: [testUserId] },
        };

        const modelForm = createModelForm({
            access_control: accessControl,
        });

        const model = await Models.insertNewModel(modelForm, testUserId, db);

        assert.ok(model);
        assert.deepStrictEqual(model.accessControl, accessControl);
    });

    test('creates inactive model', async () => {
        const modelForm = createModelForm({
            is_active: false,
        });

        const model = await Models.insertNewModel(modelForm, testUserId, db);

        assert.ok(model);
        assert.strictEqual(model.isActive, false);
    });

    test('rejects duplicate model IDs', async () => {
        const modelForm = createModelForm({ id: 'duplicate-model' });

        await Models.insertNewModel(modelForm, testUserId, db);

        // Attempt to create another model with same ID
        await assert.rejects(
            async () => await Models.insertNewModel(modelForm, testUserId, db)
        );
    });
});

describe('getAllModels', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;

        // Create base models
        await createTestModel(db, testUserId, {
            id: 'base-1',
            base_model_id: null,
        });
        await createTestModel(db, testUserId, {
            id: 'base-2',
            base_model_id: null,
        });

        // Create custom models
        await createTestModel(db, testUserId, {
            id: 'custom-1',
            base_model_id: 'base-1',
        });
        await createTestModel(db, testUserId, {
            id: 'custom-2',
            base_model_id: 'base-2',
        });
    });

    test('retrieves all models', async () => {
        const models = await Models.getAllModels(db);

        assert.ok(models.length >= 4);
        assert.ok(models.some(m => m.id === 'base-1'));
        assert.ok(models.some(m => m.id === 'base-2'));
        assert.ok(models.some(m => m.id === 'custom-1'));
        assert.ok(models.some(m => m.id === 'custom-2'));
    });

    test('includes both base and custom models', async () => {
        const models = await Models.getAllModels(db);

        const baseModels = models.filter(m => m.baseModelId === null);
        const customModels = models.filter(m => m.baseModelId !== null);

        assert.ok(baseModels.length >= 2);
        assert.ok(customModels.length >= 2);
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
            base_model_id: null,
        });

        // Create custom models (should be returned)
        await createTestModel(db, testUserId, {
            id: 'custom-1',
            base_model_id: 'base-model',
        });
        await createTestModel(db, testUserId, {
            id: 'custom-2',
            base_model_id: 'base-model',
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
        assert.strictEqual(customModel.user.id, testUserId);
        assert.strictEqual(customModel.user.username, testUsername);
        assert.ok(customModel.user.role);
        assert.ok(customModel.user.profileImageUrl);
    });

    test('excludes base models', async () => {
        const models = await Models.getCustomModels(db);

        assert.ok(!models.some(m => m.id === 'base-model'));
    });
});

describe('getBaseModels', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;

        // Create base models
        await createTestModel(db, testUserId, {
            id: 'base-1',
            base_model_id: null,
        });
        await createTestModel(db, testUserId, {
            id: 'base-2',
            base_model_id: null,
        });

        // Create custom models (should not be returned)
        await createTestModel(db, testUserId, {
            id: 'custom-model',
            base_model_id: 'base-1',
        });
    });

    test('retrieves only base models', async () => {
        const models = await Models.getBaseModels(db);

        assert.ok(models.length >= 2);
        assert.ok(models.every(m => m.baseModelId === null));
    });

    test('excludes custom models', async () => {
        const models = await Models.getBaseModels(db);

        assert.ok(!models.some(m => m.id === 'custom-model'));
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

describe('getModelsByIds', () => {
    let db: TestDatabase;
    let testUserId: string;
    let model1: Model;
    let model2: Model;
    let model3: Model;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
        model1 = await createTestModel(db, testUserId);
        model2 = await createTestModel(db, testUserId);
        model3 = await createTestModel(db, testUserId);
    });

    test('retrieves multiple models by IDs', async () => {
        const models = await Models.getModelsByIds([model1.id, model2.id], db);

        assert.strictEqual(models.length, 2);
        assert.ok(models.some(m => m.id === model1.id));
        assert.ok(models.some(m => m.id === model2.id));
    });

    test('returns empty array for empty IDs', async () => {
        const models = await Models.getModelsByIds([], db);

        assert.strictEqual(models.length, 0);
    });

    test('returns only existing models', async () => {
        const models = await Models.getModelsByIds([model1.id, 'non-existent', model3.id], db);

        assert.strictEqual(models.length, 2);
        assert.ok(models.some(m => m.id === model1.id));
        assert.ok(models.some(m => m.id === model3.id));
    });

    test('handles all non-existent IDs', async () => {
        const models = await Models.getModelsByIds(['non-1', 'non-2'], db);

        assert.strictEqual(models.length, 0);
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
            createModelForm({
                id: model.id,
                name: 'Updated Name',
                params: { temperature: 0.8 },
                meta: { description: 'Updated' },
            }),
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.name, 'Updated Name');
        assert.deepStrictEqual(updated.params, { temperature: 0.8 });
        assert.deepStrictEqual(updated.meta, { description: 'Updated' });
        assert.ok(updated.updatedAt >= originalUpdatedAt);
    });

    test('updates base_model_id', async () => {
        const model = await createTestModel(db, testUserId, {
            base_model_id: 'old-base',
        });

        const updated = await Models.updateModelById(
            model.id,
            createModelForm({
                id: model.id,
                base_model_id: 'new-base',
            }),
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.baseModelId, 'new-base');
    });

    test('updates access_control', async () => {
        const model = await createTestModel(db, testUserId);

        const newAccessControl: AccessControl = {
            read: { user_ids: ['user1', 'user2'] },
            write: { user_ids: ['user1'] },
        };

        const updated = await Models.updateModelById(
            model.id,
            createModelForm({
                id: model.id,
                access_control: newAccessControl,
            }),
            db
        );

        assert.ok(updated);
        assert.deepStrictEqual(updated.accessControl, newAccessControl);
    });

    test('updates is_active', async () => {
        const model = await createTestModel(db, testUserId, { is_active: true });

        const updated = await Models.updateModelById(
            model.id,
            createModelForm({
                id: model.id,
                is_active: false,
            }),
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.isActive, false);
    });

    test('preserves user_id and created_at', async () => {
        const model = await createTestModel(db, testUserId);

        const updated = await Models.updateModelById(
            model.id,
            createModelForm({
                id: model.id,
                name: 'Updated',
            }),
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.userId, testUserId);
        assert.strictEqual(updated.createdAt, model.createdAt);
    });

    test('returns null for non-existent model', async () => {
        const updated = await Models.updateModelById(
            'non-existent',
            createModelForm({ id: 'non-existent' }),
            db
        );

        assert.strictEqual(updated, null);
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
        const model = await createTestModel(db, testUserId, { is_active: true });

        const toggled = await Models.toggleModelById(model.id, db);

        assert.ok(toggled);
        assert.strictEqual(toggled.isActive, false);
        assert.ok(toggled.updatedAt >= model.updatedAt);
    });

    test('toggles inactive to active', async () => {
        const model = await createTestModel(db, testUserId, { is_active: false });

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

    test('returns null for non-existent model', async () => {
        const toggled = await Models.toggleModelById('non-existent', db);

        assert.strictEqual(toggled, null);
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

        const success = await Models.deleteModelById(model.id, db);

        assert.strictEqual(success, true);

        const retrieved = await Models.getModelById(model.id, db);
        assert.strictEqual(retrieved, null);
    });

    test('returns false for non-existent model', async () => {
        const success = await Models.deleteModelById('non-existent', db);

        assert.strictEqual(success, false);
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

        const beforeDelete = await Models.getAllModels(db);
        assert.ok(beforeDelete.length >= 3);

        const success = await Models.deleteAllModels(db);

        assert.strictEqual(success, true);

        const afterDelete = await Models.getAllModels(db);
        assert.strictEqual(afterDelete.length, 0);
    });

    test('works on empty database', async () => {
        // Delete all models first
        await Models.deleteAllModels(db);

        // Try again
        const success = await Models.deleteAllModels(db);

        assert.strictEqual(success, true);
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
            base_model_id: null,
        });

        // Create custom models for user1
        await createTestModel(db, user1.id, {
            id: 'user1-gpt4-custom',
            name: 'User1 GPT-4 Custom',
            base_model_id: 'base-gpt4',
        });
        await createTestModel(db, user1.id, {
            id: 'user1-llama-custom',
            name: 'User1 Llama Custom',
            base_model_id: 'base-llama',
        });

        // Create custom models for user2 (public)
        await createTestModel(db, user2.id, {
            id: 'user2-public',
            name: 'User2 Public Model',
            base_model_id: 'base-gpt4',
            access_control: null,
        });

        // Create custom models for user2 (private)
        await createTestModel(db, user2.id, {
            id: 'user2-private',
            name: 'User2 Private Model',
            base_model_id: 'base-gpt4',
            access_control: {},
        });

        // Create custom models with shared access
        await createTestModel(db, user2.id, {
            id: 'user2-shared',
            name: 'User2 Shared Model',
            base_model_id: 'base-gpt4',
            access_control: {
                read: { user_ids: [user1.id, user2.id] },
                write: { user_ids: [user2.id] },
            },
        });
    });

    test('searches all accessible models', async () => {
        const result = await Models.searchModels(user1.id, {}, 0, 30, db);

        // Should include: user1's models, public models, and shared models
        assert.ok(result.total >= 4);
        assert.ok(result.items.some(m => m.id === 'user1-gpt4-custom'));
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
        assert.ok(result.items.every(m => m.name.toUpperCase().includes('GPT')));
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

describe('getModelsByUserId', () => {
    let db: TestDatabase;
    let user1: { id: string };
    let user2: { id: string };

    before(async () => {
        db = await newDBWithAdmin();
        const u1 = await Users.createUser(newUserParams(), db);
        const u2 = await Users.createUser(newUserParams(), db);
        user1 = { id: u1.id };
        user2 = { id: u2.id };

        // Create models owned by user1
        await createTestModel(db, user1.id, {
            id: 'user1-owned',
            base_model_id: 'base',
        });

        // Create models with read access for user1
        await createTestModel(db, user2.id, {
            id: 'user1-read',
            base_model_id: 'base',
            access_control: {
                read: { user_ids: [user1.id] },
                write: { user_ids: [user2.id] },
            },
        });

        // Create models with write access for user1
        await createTestModel(db, user2.id, {
            id: 'user1-write',
            base_model_id: 'base',
            access_control: {
                read: { user_ids: [user2.id] },
                write: { user_ids: [user1.id] },
            },
        });

        // Create public models
        await createTestModel(db, user2.id, {
            id: 'public-model',
            base_model_id: 'base',
            access_control: null,
        });

        // Create private models (no access for user1)
        await createTestModel(db, user2.id, {
            id: 'private-model',
            base_model_id: 'base',
            access_control: {},
        });
    });

    test('retrieves models with read permission', async () => {
        const models = await Models.getModelsByUserId(user1.id, 'read', db);

        assert.ok(models.some(m => m.id === 'user1-owned'));
        assert.ok(models.some(m => m.id === 'user1-read'));
        assert.ok(models.some(m => m.id === 'public-model'));
    });

    test('retrieves models with write permission', async () => {
        const models = await Models.getModelsByUserId(user1.id, 'write', db);

        assert.ok(models.some(m => m.id === 'user1-owned'));
        assert.ok(models.some(m => m.id === 'user1-write'));
    });

    test('excludes models without read permission', async () => {
        const models = await Models.getModelsByUserId(user1.id, 'read', db);

        assert.ok(!models.some(m => m.id === 'private-model'));
    });

    test('excludes models without write permission', async () => {
        const models = await Models.getModelsByUserId(user1.id, 'write', db);

        assert.ok(!models.some(m => m.id === 'user1-read'));
        assert.ok(!models.some(m => m.id === 'public-model'));
    });

    test('includes user information', async () => {
        const models = await Models.getModelsByUserId(user1.id, 'read', db);

        assert.ok(models.length > 0);
        models.forEach(model => {
            assert.ok(model.user);
            assert.ok(model.user.id);
            assert.ok(model.user.username);
        });
    });

    test('excludes base models', async () => {
        // Create base model
        await createTestModel(db, user1.id, {
            id: 'base-model',
            base_model_id: null,
        });

        const models = await Models.getModelsByUserId(user1.id, 'read', db);

        assert.ok(!models.some(m => m.id === 'base-model'));
    });
});

/* -------------------- SYNC & IMPORT OPERATIONS -------------------- */

describe('syncModels', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
    });

    test('inserts new models', async () => {
        const incomingModels: Model[] = [
            {
                id: 'new-model-1',
                userId: testUserId,
                baseModelId: null,
                name: 'New Model 1',
                params: {},
                meta: {},
                accessControl: null,
                isActive: true,
                createdAt: currentUnixTimestamp(),
                updatedAt: currentUnixTimestamp(),
            },
        ];

        const synced = await Models.syncModels(testUserId, incomingModels, db);

        assert.ok(synced.some(m => m.id === 'new-model-1'));
        const newModel = await Models.getModelById('new-model-1', db);
        assert.ok(newModel);
        assert.strictEqual(newModel.name, 'New Model 1');
    });

    test('updates existing models', async () => {
        const existing = await createTestModel(db, testUserId, {
            id: 'existing-model',
            name: 'Original Name',
        });

        const incomingModels: Model[] = [
            {
                ...existing,
                name: 'Updated Name',
                params: { new: 'params' },
            },
        ];

        await Models.syncModels(testUserId, incomingModels, db);

        const updated = await Models.getModelById('existing-model', db);
        assert.ok(updated);
        assert.strictEqual(updated.name, 'Updated Name');
        assert.deepStrictEqual(updated.params, { new: 'params' });
        assert.ok(updated.updatedAt >= existing.updatedAt);
    });

    test('deletes removed models', async () => {
        const model1 = await createTestModel(db, testUserId, { id: 'keep-1' });
        const model2 = await createTestModel(db, testUserId, { id: 'delete-1' });

        const incomingModels: Model[] = [model1];

        await Models.syncModels(testUserId, incomingModels, db);

        const kept = await Models.getModelById('keep-1', db);
        const deleted = await Models.getModelById('delete-1', db);

        assert.ok(kept);
        assert.strictEqual(deleted, null);
    });

    test('handles sync with empty list', async () => {
        await createTestModel(db, testUserId);
        await createTestModel(db, testUserId);

        const synced = await Models.syncModels(testUserId, [], db);

        assert.strictEqual(synced.length, 0);
        const allModels = await Models.getAllModels(db);
        assert.strictEqual(allModels.length, 0);
    });

    test('updates userId for all models', async () => {
        const otherUser = await Users.createUser(newUserParams(), db);
        const existing = await createTestModel(db, otherUser.id, {
            id: 'update-user-model',
        });

        const incomingModels: Model[] = [existing];

        await Models.syncModels(testUserId, incomingModels, db);

        const updated = await Models.getModelById('update-user-model', db);
        assert.ok(updated);
        assert.strictEqual(updated.userId, testUserId);
    });

    test('returns complete synced list', async () => {
        const model1 = await createTestModel(db, testUserId, { id: 'sync-1' });
        const now = currentUnixTimestamp();

        const incomingModels: Model[] = [
            model1,
            {
                id: 'sync-2',
                userId: testUserId,
                baseModelId: null,
                name: 'Sync 2',
                params: {},
                meta: {},
                accessControl: null,
                isActive: true,
                createdAt: now,
                updatedAt: now,
            },
        ];

        const synced = await Models.syncModels(testUserId, incomingModels, db);

        assert.strictEqual(synced.length, 2);
        assert.ok(synced.some(m => m.id === 'sync-1'));
        assert.ok(synced.some(m => m.id === 'sync-2'));
    });
});

describe('importModels', () => {
    let db: TestDatabase;
    let testUserId: string;

    before(async () => {
        db = await newDBWithAdmin();
        const user = await Users.createUser(newUserParams(), db);
        testUserId = user.id;
    });

    test('imports new models', async () => {
        const modelsData: ModelForm[] = [
            createModelForm({ id: 'import-new-1', name: 'Import New 1' }),
            createModelForm({ id: 'import-new-2', name: 'Import New 2' }),
        ];

        const success = await Models.importModels(modelsData, testUserId, db);

        assert.strictEqual(success, true);
        const model1 = await Models.getModelById('import-new-1', db);
        const model2 = await Models.getModelById('import-new-2', db);
        assert.ok(model1);
        assert.ok(model2);
    });

    test('updates existing models', async () => {
        const existing = await createTestModel(db, testUserId, {
            id: 'import-existing',
            name: 'Original',
        });

        const modelsData: ModelForm[] = [
            createModelForm({
                id: 'import-existing',
                name: 'Updated',
                params: { updated: true },
            }),
        ];

        await Models.importModels(modelsData, testUserId, db);

        const updated = await Models.getModelById('import-existing', db);
        assert.ok(updated);
        assert.strictEqual(updated.name, 'Updated');
        assert.deepStrictEqual(updated.params, { updated: true });
    });

    test('does not delete existing models', async () => {
        const existing = await createTestModel(db, testUserId, {
            id: 'keep-on-import',
        });

        const modelsData: ModelForm[] = [
            createModelForm({ id: 'new-import' }),
        ];

        await Models.importModels(modelsData, testUserId, db);

        const kept = await Models.getModelById('keep-on-import', db);
        assert.ok(kept);
    });

    test('handles empty import', async () => {
        const success = await Models.importModels([], testUserId, db);

        assert.strictEqual(success, true);
    });

    test('preserves userId on update', async () => {
        const existing = await createTestModel(db, testUserId, {
            id: 'preserve-user',
        });

        const modelsData: ModelForm[] = [
            createModelForm({
                id: 'preserve-user',
                name: 'Updated Name',
            }),
        ];

        await Models.importModels(modelsData, testUserId, db);

        const updated = await Models.getModelById('preserve-user', db);
        assert.ok(updated);
        assert.strictEqual(updated.userId, testUserId);
    });
});

/* -------------------- ACCESS CONTROL OPERATIONS -------------------- */

describe('hasAccess', () => {
    const userId = 'user-123';
    const otherUserId = 'user-456';

    test('allows public read access (null access_control)', () => {
        const hasRead = Models.hasAccess(userId, 'read', null);
        assert.strictEqual(hasRead, true);
    });

    test('denies public write access (null access_control)', () => {
        const hasWrite = Models.hasAccess(userId, 'write', null);
        assert.strictEqual(hasWrite, false);
    });

    test('denies access for empty access_control', () => {
        const hasRead = Models.hasAccess(userId, 'read', {});
        const hasWrite = Models.hasAccess(userId, 'write', {});

        assert.strictEqual(hasRead, false);
        assert.strictEqual(hasWrite, false);
    });

    test('allows read access for users in read.user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [userId, otherUserId] },
            write: { user_ids: [otherUserId] },
        };

        const hasRead = Models.hasAccess(userId, 'read', accessControl);
        assert.strictEqual(hasRead, true);
    });

    test('allows write access for users in write.user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [otherUserId] },
            write: { user_ids: [userId] },
        };

        const hasWrite = Models.hasAccess(userId, 'write', accessControl);
        assert.strictEqual(hasWrite, true);
    });

    test('denies read access for users not in read.user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [otherUserId] },
            write: { user_ids: [] },
        };

        const hasRead = Models.hasAccess(userId, 'read', accessControl);
        assert.strictEqual(hasRead, false);
    });

    test('denies write access for users not in write.user_ids', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [userId] },
            write: { user_ids: [otherUserId] },
        };

        const hasWrite = Models.hasAccess(userId, 'write', accessControl);
        assert.strictEqual(hasWrite, false);
    });

    test('handles missing read property', () => {
        const accessControl: AccessControl = {
            write: { user_ids: [userId] },
        };

        const hasRead = Models.hasAccess(userId, 'read', accessControl);
        assert.strictEqual(hasRead, false);
    });

    test('handles missing write property', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [userId] },
        };

        const hasWrite = Models.hasAccess(userId, 'write', accessControl);
        assert.strictEqual(hasWrite, false);
    });

    test('handles empty user_ids array', () => {
        const accessControl: AccessControl = {
            read: { user_ids: [] },
            write: { user_ids: [] },
        };

        const hasRead = Models.hasAccess(userId, 'read', accessControl);
        const hasWrite = Models.hasAccess(userId, 'write', accessControl);

        assert.strictEqual(hasRead, false);
        assert.strictEqual(hasWrite, false);
    });

    test('handles undefined user_ids', () => {
        const accessControl: AccessControl = {
            read: {},
            write: {},
        };

        const hasRead = Models.hasAccess(userId, 'read', accessControl);
        const hasWrite = Models.hasAccess(userId, 'write', accessControl);

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
            id: 'model:with/special-chars_123',
        });

        const model = await Models.insertNewModel(modelForm, testUserId, db);

        assert.ok(model);
        assert.strictEqual(model.id, 'model:with/special-chars_123');

        const retrieved = await Models.getModelById('model:with/special-chars_123', db);
        assert.ok(retrieved);
    });

    test('handles empty params and meta', async () => {
        const modelForm = createModelForm({
            params: {},
            meta: {},
        });

        const model = await Models.insertNewModel(modelForm, testUserId, db);

        assert.ok(model);
        assert.deepStrictEqual(model.params, {});
        assert.deepStrictEqual(model.meta, {});
    });

    test('handles complex nested params and meta', async () => {
        const modelForm = createModelForm({
            params: {
                temperature: 0.7,
                top_p: 0.9,
                nested: { deep: { value: 123 } },
            },
            meta: {
                description: 'Test',
                capabilities: { vision: true },
                array: [1, 2, 3],
            },
        });

        const model = await Models.insertNewModel(modelForm, testUserId, db);

        assert.ok(model);
        assert.deepStrictEqual(model.params, {
            temperature: 0.7,
            top_p: 0.9,
            nested: { deep: { value: 123 } },
        });
        assert.deepStrictEqual(model.meta, {
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
        await createTestModel(db, testUserId, { base_model_id: 'base' });

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
            base_model_id: 'base',
            access_control: accessControl,
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
