import { describe, test, before } from 'node:test';
import assert from 'node:assert';

import { newDBWithAdmin, newUserParams, type TestDatabase } from '../../helpers.js';
import * as Models from '../../../src/db/operations/models.js';
import type { Model, NewModel } from '../../../src/db/operations/models.js';
import * as Users from '../../../src/db/operations/users.js';
import { models } from '../../../src/db/schema.js';
import type { ModelForm } from '../../../src/routes/types/index.js';
import { currentUnixTimestamp } from '../../../src/db/utils.js';

/* -------------------- TEST HELPERS -------------------- */

function createModelForm(overrides: Partial<NewModel> & { userId: string }): NewModel {
    const id = crypto.randomUUID();
    return {
        name: overrides?.name || `Test Model`,
        id: overrides?.id || overrides?.name || `Test Model ${id}`,
        baseModelId: overrides?.baseModelId !== undefined ? overrides.baseModelId : 'Base Model',
        userId: overrides?.userId,
        params: overrides?.params || {},
        meta: overrides?.meta || {},
        isPublic: overrides?.isPublic,
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
            isPublic: modelForm.isPublic,
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

    test('creates custom model successfully', async () => {
        const modelForm = createModelForm({
            id: 'my-custom-gpt4',
            name: 'My Custom GPT-4',
            baseModelId: 'gpt-4-turbo',
            params: { temperature: 0.7, max_tokens: 2000 },
            meta: { description: 'Custom configuration' },
            userId: testUserId,
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.strictEqual(model.id, 'my-custom-gpt4');
        assert.strictEqual(model.baseModelId, 'gpt-4-turbo');
        assert.deepStrictEqual(model.params, { temperature: 0.7, max_tokens: 2000 });
        assert.deepStrictEqual(model.meta, { description: 'Custom configuration' });
    });

    test('creates model with public access', async () => {
        const modelForm = createModelForm({
            isPublic: true,
            userId: testUserId,
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.strictEqual(model.isPublic, true);
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

        // Create custom models
        await createTestModel(db, testUserId, {
            id: 'custom-1',
            baseModelId: 'base-model',
        });
        await createTestModel(db, testUserId, {
            id: 'custom-2',
            baseModelId: 'base-model',
        });
    });

    test('retrieves custom models', async () => {
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
                meta: { description: 'Updated' },
            },
            db
        );

        assert.ok(updated);
        assert.strictEqual(updated.name, 'Updated Name');
        assert.deepStrictEqual(updated.params, { temperature: 0.8 });
        assert.deepStrictEqual(updated.meta, { description: 'Updated' });
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

    test('updates access control', async () => {
        const model = await createTestModel(db, testUserId, {
            isPublic: false,
        });

        assert.strictEqual(model.isPublic, false);

        const updated = await Models.updateModelById(model.id, { isPublic: true }, db);

        assert.ok(updated);
        assert.strictEqual(updated.isPublic, true);
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

/* -------------------- ACCESS CONTROL OPERATIONS -------------------- */

describe('hasAccess', () => {
    const ownerId = 'owner-123';
    const userId = 'user-123';
    const otherUserId = 'user-456';

    function _model(isPublic: boolean): Model {
        return {
            id: 'Test Model',
            name: 'test-model',
            baseModelId: 'Base Model',
            userId: ownerId,
            isActive: true,
            updatedAt: 0,
            createdAt: 0,
            meta: { },
            params: {},
            isPublic: isPublic,
        }
    }

    test('allows public read access', () => {
        const hasRead = Models.hasAccess(_model(true), userId, 'read');
        assert.strictEqual(hasRead, true);
    });

    test('denies public write access', () => {
        const hasWrite = Models.hasAccess(_model(true), userId, 'write');
        assert.strictEqual(hasWrite, false);
    });

    test('allows write access for creator, regardless of access setting', () => {
        let hasWrite = Models.hasAccess(_model(false), ownerId, 'write');
        assert.strictEqual(hasWrite, true);

        hasWrite = Models.hasAccess(_model(true), ownerId, 'write');
        assert.strictEqual(hasWrite, true);
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
            meta: {},
        });

        const model = await Models.insertNewModel(modelForm, db);

        assert.ok(model);
        assert.deepStrictEqual(model.params, {});
        assert.deepStrictEqual(model.meta, {});
    });

    test('handles complex nested params and meta', async () => {
        const modelForm = createModelForm({
            userId: testUserId,
            params: {
                temperature: 0.7,
                top_p: 0.9,
            },
            meta: {
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
        });
        assert.deepStrictEqual(model.meta, {
            description: 'Test',
            capabilities: { vision: true },
            array: [1, 2, 3],
        });
    });
});
