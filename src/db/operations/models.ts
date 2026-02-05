import { eq, ne, desc, asc, or, and, like, sql, inArray, isNull, isNotNull } from 'drizzle-orm';
import { db, type DbOrTx } from '../client.js';
import { models, users, type Model, type NewModel } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { ModelForm, ModelParams, ModelMeta, AccessControl, UserRole } from '../../routes/types.js';

/* -------------------- CORE CRUD OPERATIONS -------------------- */

/**
 * Creates a new model entry in the registry.
 *
 * Required fields: data.id, data.name, data.params, data.meta
 * Optional fields: data.base_model_id, data.access_control, data.is_active
 * Auto-generated: createdAt, updatedAt
 */
export async function insertNewModel(
    data: ModelForm,
    userId: string,
    txOrDb: DbOrTx = db
): Promise<Model | null> {
    const now = currentUnixTimestamp();

    const [model] = await txOrDb
        .insert(models)
        .values({
            id: data.id,
            userId: userId,
            baseModelId: data.base_model_id,
            name: data.name,
            params: data.params,
            meta: data.meta,
            accessControl: data.access_control,
            isActive: data.is_active,
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    return model || null;
}

/**
 * Admin only: Retrieves ALL models from the database (no filtering).
 * Returns both base and custom models with no access control filtering.
 */
export async function getAllModels(
    txOrDb: DbOrTx = db
): Promise<Model[]> {
    return await txOrDb
        .select()
        .from(models);
}

/**
 * Response type for model with user information.
 */
export type ModelUserResponse = Model & {
    user: {
        id: string;
        username: string;
        role: UserRole;
        profileImageUrl: string;
    };
};

/**
 * Retrieves all custom models (models with base_model_id != null) with user information.
 * Joins with User table for owner details.
 */
export async function getCustomModels(
    txOrDb: DbOrTx = db
): Promise<ModelUserResponse[]> {
    const result = await txOrDb
        .select({
            model: models,
            user: {
                id: users.id,
                username: users.username,
                role: users.role,
                profileImageUrl: users.profileImageUrl,
            },
        })
        .from(models)
        .leftJoin(users, eq(users.id, models.userId))
        .where(isNotNull(models.baseModelId));

    return result.map(row => ({
        ...row.model,
        user: row.user!,
    }));
}

/**
 * Admin only: Retrieves all base models (models with base_model_id = null).
 */
export async function getBaseModels(
    txOrDb: DbOrTx = db
): Promise<Model[]> {
    return await txOrDb
        .select()
        .from(models)
        .where(isNull(models.baseModelId));
}

/**
 * Retrieves a specific model by ID.
 */
export async function getModelById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<Model | null> {
    const [model] = await txOrDb
        .select()
        .from(models)
        .where(eq(models.id, id))
        .limit(1);

    return model || null;
}

/**
 * Retrieves multiple models by their IDs.
 */
export async function getModelsByIds(
    ids: string[],
    txOrDb: DbOrTx = db
): Promise<Model[]> {
    if (ids.length === 0) return [];

    return await txOrDb
        .select()
        .from(models)
        .where(inArray(models.id, ids));
}

/**
 * Updates a model's configuration.
 *
 * Updatable fields: name, base_model_id, params, meta, access_control, is_active
 * Auto-updated: updatedAt
 * Protected: id, user_id, created_at
 */
export async function updateModelById(
    id: string,
    data: ModelForm,
    txOrDb: DbOrTx = db
): Promise<Model | null> {
    const now = currentUnixTimestamp();

    const [updated] = await txOrDb
        .update(models)
        .set({
            name: data.name,
            baseModelId: data.base_model_id,
            params: data.params,
            meta: data.meta,
            accessControl: data.access_control,
            isActive: data.is_active,
            updatedAt: now,
        })
        .where(eq(models.id, id))
        .returning();

    return updated || null;
}

/**
 * Toggles a model's active status (enabled/disabled).
 * Updates updatedAt timestamp.
 */
export async function toggleModelById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<Model | null> {
    const existing = await getModelById(id, txOrDb);
    if (!existing) return null;

    const now = currentUnixTimestamp();

    const [toggled] = await txOrDb
        .update(models)
        .set({
            isActive: !existing.isActive,
            updatedAt: now,
        })
        .where(eq(models.id, id))
        .returning();

    return toggled || null;
}

/**
 * Permanently deletes a model from the database.
 * Returns true if deleted, false if not found.
 */
export async function deleteModelById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const result = await txOrDb
        .delete(models)
        .where(eq(models.id, id));

    return result.rowsAffected > 0;
}

/**
 * Admin only: Deletes ALL models from the database.
 * WARNING: Destructive operation - no undo.
 */
export async function deleteAllModels(
    txOrDb: DbOrTx = db
): Promise<boolean> {
    await txOrDb.delete(models);
    return true;
}

/* -------------------- SEARCH & FILTERING -------------------- */

/**
 * Filter options for searching models.
 */
export type SearchFilter = {
    query?: string;
    viewOption?: 'created' | 'shared';
    orderBy?: 'name' | 'created_at' | 'updated_at';
    direction?: 'asc' | 'desc';
    userId?: string;
};

/**
 * Response type for paginated model search.
 */
export type ModelListResponse = {
    items: ModelUserResponse[];
    total: number;
};

/**
 * Searches and filters custom models with pagination.
 *
 * Default pagination: 30 items per page
 * Filter options: query, viewOption, orderBy, direction
 * Access control: Automatically filters based on public models and user permissions
 */
export async function searchModels(
    userId: string,
    filter: SearchFilter,
    skip: number,
    limit: number,
    txOrDb: DbOrTx = db
): Promise<ModelListResponse> {
    const {
        query,
        viewOption,
        orderBy = 'updated_at',
        direction = 'desc',
    } = filter;

    // Build where conditions
    const conditions = [isNotNull(models.baseModelId)];

    // Search by name or base_model_id
    if (query) {
        conditions.push(
            or(
                like(models.name, `%${query}%`),
                like(models.baseModelId, `%${query}%`)
            )!
        );
    }

    // Filter by view option
    if (viewOption === 'created') {
        conditions.push(eq(models.userId, userId));
    } else if (viewOption === 'shared') {
        conditions.push(ne(models.userId, userId));
    }

    // Access control filtering
    // Include: public models (access_control = null), owned models, or models with user in read permissions
    const accessConditions = or(
        isNull(models.accessControl),
        eq(models.userId, userId),
        sql`json_extract(${models.accessControl}, '$.read.user_ids') LIKE '%' || ${userId} || '%'`
    );

    if (accessConditions) {
        conditions.push(accessConditions);
    }

    const whereClause = and(...conditions);

    // Determine sort column
    const sortColumn =
        orderBy === 'name' ? models.name :
        orderBy === 'created_at' ? models.createdAt :
        models.updatedAt;

    const sortFn = direction === 'asc' ? asc : desc;

    // Execute query with join
    const result = await txOrDb
        .select({
            model: models,
            user: {
                id: users.id,
                username: users.username,
                role: users.role,
                profileImageUrl: users.profileImageUrl,
            },
        })
        .from(models)
        .leftJoin(users, eq(users.id, models.userId))
        .where(whereClause)
        .orderBy(sortFn(sortColumn))
        .limit(limit)
        .offset(skip);

    // Get total count
    const countResult = await txOrDb
        .select({ count: sql<number>`count(*)` })
        .from(models)
        .where(whereClause);

    const total = countResult[0]?.count ?? 0;

    const items = result.map(row => ({
        ...row.model,
        user: row.user!,
    }));

    return { items, total };
}

/**
 * Retrieves all custom models accessible to a user with specified permission level.
 *
 * Access logic:
 * - Models owned by user
 * - Models where user has permission (via access_control)
 */
export async function getModelsByUserId(
    userId: string,
    permission: 'read' | 'write',
    txOrDb: DbOrTx = db
): Promise<ModelUserResponse[]> {
    // Build access condition based on permission type:
    // - Public 'read' access is enabled when accessControl is null
    // - 'write' access requires explicit permission
    const accessCondition = or(
        permission === 'read' ? isNull(models.accessControl) : undefined,
        eq(models.userId, userId),
        sql`json_extract(${models.accessControl}, '$.${sql.raw(permission)}.user_ids') LIKE '%' || ${userId} || '%'`
    );

    const conditions = [
        isNotNull(models.baseModelId),
        accessCondition!,
    ];

    const whereClause = and(...conditions);

    const result = await txOrDb
        .select({
            model: models,
            user: {
                id: users.id,
                username: users.username,
                role: users.role,
                profileImageUrl: users.profileImageUrl,
            },
        })
        .from(models)
        .leftJoin(users, eq(users.id, models.userId))
        .where(whereClause)
        .orderBy(desc(models.updatedAt));

    return result.map(row => ({
        ...row.model,
        user: row.user!,
    }));
}

/* -------------------- SYNC & IMPORT OPERATIONS -------------------- */

/**
 * Admin only: Synchronizes database with incoming models list.
 *
 * Behavior:
 * 1. Update existing models (matches by ID)
 * 2. Insert new models (not in database)
 * 3. Delete removed models (in database but not in incoming list)
 *
 * Returns: Complete synced model list from database
 * Transaction: Yes (all changes in single transaction)
 */
export async function syncModels(
    userId: string,
    incomingModels: Model[],
    txOrDb: DbOrTx = db
): Promise<Model[]> {
    const now = currentUnixTimestamp();

    // Get existing model IDs
    const existing = await getAllModels(txOrDb);
    const existingIds = new Set(existing.map(m => m.id));
    const incomingIds = new Set(incomingModels.map(m => m.id));

    // 1. Update existing models
    for (const model of incomingModels) {
        if (existingIds.has(model.id)) {
            await txOrDb
                .update(models)
                .set({
                    userId: userId,
                    baseModelId: model.baseModelId,
                    name: model.name,
                    params: model.params,
                    meta: model.meta,
                    accessControl: model.accessControl,
                    isActive: model.isActive,
                    updatedAt: now,
                })
                .where(eq(models.id, model.id));
        }
    }

    // 2. Insert new models
    const newModels = incomingModels.filter(m => !existingIds.has(m.id));
    if (newModels.length > 0) {
        const values = newModels.map(m => ({
            id: m.id,
            userId: userId,
            baseModelId: m.baseModelId,
            name: m.name,
            params: m.params,
            meta: m.meta,
            accessControl: m.accessControl,
            isActive: m.isActive,
            createdAt: now,
            updatedAt: now,
        }));

        await txOrDb.insert(models).values(values);
    }

    // 3. Delete removed models
    const toDelete = existing.filter(m => !incomingIds.has(m.id));
    for (const model of toDelete) {
        await txOrDb.delete(models).where(eq(models.id, model.id));
    }

    // Return complete synced list
    return await getAllModels(txOrDb);
}

/**
 * Bulk imports or updates models (non-destructive).
 *
 * Behavior:
 * - If model ID exists: updates the model
 * - If model ID doesn't exist: creates new model
 * - Does NOT delete existing models (unlike sync)
 */
export async function importModels(
    modelsData: ModelForm[],
    userId: string,
    txOrDb: DbOrTx = db
): Promise<boolean> {
    const now = currentUnixTimestamp();

    for (const data of modelsData) {
        // Check if model exists
        const existing = await getModelById(data.id, txOrDb);

        if (existing) {
            // Update existing model
            await txOrDb
                .update(models)
                .set({
                    baseModelId: data.base_model_id,
                    name: data.name,
                    params: data.params,
                    meta: data.meta,
                    accessControl: data.access_control,
                    isActive: data.is_active,
                    updatedAt: now,
                })
                .where(eq(models.id, data.id));
        } else {
            // Insert new model
            await txOrDb
                .insert(models)
                .values({
                    id: data.id,
                    userId: userId,
                    baseModelId: data.base_model_id,
                    name: data.name,
                    params: data.params,
                    meta: data.meta,
                    accessControl: data.access_control,
                    isActive: data.is_active,
                    createdAt: now,
                    updatedAt: now,
                });
        }
    }

    return true;
}

/* -------------------- ACCESS CONTROL OPERATIONS -------------------- */

/**
 * Checks if a user has access to a model.
 *
 * Access logic:
 * - Public read access: access_control = null and type = 'read'
 * - Owner access: Always has both read and write
 * - User IDs check: User ID must be in access_control[type].user_ids array
 */
export function hasAccess(
    model: Model,
    userId: string,
    type: 'read' | 'write',
): boolean {
    // User is owner
    if (model.userId === userId) return true;

    // When accessControl is null, the model has public read access
    // ...write access requires explicit permissions
    if (model.accessControl === null) {
        return type === 'read';
    }

    return model.accessControl[type]?.user_ids?.includes(userId) || false;
}
