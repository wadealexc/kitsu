import { eq, ne, desc, asc, or, and, like, sql, inArray, isNull, isNotNull, SQL, count } from 'drizzle-orm';

import { db, type DbOrTx } from '../client.js';
import { models, users } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { ModelForm, UserRole } from '../../routes/types.js';
import { DatabaseError, RecordCreationError, RecordNotFoundError } from '../errors.js';

const TABLE = 'model';

/* -------------------- CREATE -------------------- */

export type Model = typeof models.$inferSelect;
export type NewModel = Omit<
    typeof models.$inferInsert,
    'updatedAt' | 'createdAt'
>;

/**
 * Creates a new custom model
 * 
 * @param params
 * @param txOrDb
 * 
 * @returns the new model record
 * 
 * @throws if creation failed
 */
export async function insertNewModel(
    params: NewModel,
    txOrDb: DbOrTx = db
): Promise<Model> {
    const now = currentUnixTimestamp();

    const [model] = await txOrDb
        .insert(models)
        .values({
            ...params,
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    if (!model) throw new RecordCreationError('Error creating model record');
    return model;
}

/* -------------------- UPDATE -------------------- */

export type UpdateModel = Omit<
    Partial<NewModel>,
    'id' | 'userId' | 'createdAt' | 'updatedAt'
>;

/**
 * Update a custom model configuration
 * 
 * @param id - model id
 * @param data - updated fields (name, baseModelId, accessControl, etc)
 * @param txOrDb
 * 
 * @returns the updated model record
 * 
 * @throws if the update fails
 */
export async function updateModelById(
    id: string,
    data: UpdateModel,
    txOrDb: DbOrTx = db
): Promise<Model> {
    const [updated] = await txOrDb
        .update(models)
        .set({
            ...data,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(models.id, id))
        .returning();

    if (!updated) throw new RecordNotFoundError(TABLE, id);
    return updated;
}

/**
 * Toggle a model's active status
 * 
 * @param id - the model id
 * @param txOrDb
 * 
 * @returns the updated model record
 * 
 * @throws if the update fails
 */
export async function toggleModelById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<Model> {
    const existing = await getModelById(id, txOrDb);
    if (!existing) throw new RecordNotFoundError(TABLE, id);

    const [toggled] = await txOrDb
        .update(models)
        .set({
            isActive: !existing.isActive,
            updatedAt: currentUnixTimestamp(),
        })
        .where(eq(models.id, id))
        .returning();

    if (!toggled) throw new DatabaseError(`error toggling model with id '${id}'`);
    return toggled;
}

/* -------------------- DELETE -------------------- */

/**
 * Permanently deletes a model from the database.
 * Returns true if deleted, false if not found.
 * 
 * @param id - model id
 * @param txOrDb
 * 
 * @throws if deletion failed
 */
export async function deleteModelById(
    id: string,
    txOrDb: DbOrTx = db
): Promise<void> {
    const result = await txOrDb
        .delete(models)
        .where(eq(models.id, id));

    if (result.rowsAffected === 0) throw new RecordNotFoundError(TABLE, id);
}

/**
 * Admin only: Deletes ALL models from the database.
 * WARNING: Destructive operation - no undo.
 * 
 * @param txOrDb
 */
export async function deleteAllModels(
    txOrDb: DbOrTx = db
): Promise<void> {
    await txOrDb.delete(models);
}

/* -------------------- READ -------------------- */

/**
 * Retrieves a specific model by ID.
 * 
 * @param id - the model id
 * @param txOrDb
 * 
 * @returns the model record (or null, if not found)
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
 * Response type for model with user information.
 */
export type ModelUserResponse = Model & {
    user: {
        id: string;
        username: string;
        role: UserRole;
        profileImageUrl: string;
    } | null;
};

/**
 * Fetch all custom models in the db along with their owner info
 * 
 * @param txOrDb
 * 
 * @returns a list of all custom models and the owner's info
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
        user: row.user,
    }));
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
 * Search and filter custom models with pagination
 * 
 * @param userId
 * @param filter
 * @param skip
 * @param limit
 * @param txOrDb
 * 
 * @returns a list of models matching the search criteria, along with owner info
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
    const conditions: (SQL<unknown> | undefined)[] = [isNotNull(models.baseModelId)];

    // Search by name or base_model_id
    if (query) {
        conditions.push(
            or(
                like(models.name, `%${query}%`),
                like(models.baseModelId, `%${query}%`)
            )
        );
    }

    // Filter by view option
    if (viewOption === 'created') {
        conditions.push(eq(models.userId, userId));
    } else if (viewOption === 'shared') {
        conditions.push(ne(models.userId, userId));
    }

    // Access control filtering
    // TODO - this mirrors logic in hasAccess, but it's super messy to have it redefined here.
    conditions.push(or(
        isNull(models.accessControl),
        eq(models.userId, userId),
        sql`json_extract(${models.accessControl}, '$.read.user_ids') LIKE '%' || ${userId} || '%'`
    ));

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
    const [countResult] = await txOrDb
        .select({ value: count() })
        .from(models)
        .where(whereClause);

    const total = countResult?.value || 0;

    const items = result.map(row => ({
        ...row.model,
        user: row.user!,
    }));

    return { items, total };
}

/* -------------------- ACCESS CONTROL -------------------- */

/**
 * Check if a user has the specified access to a given model.
 * 
 * @param model
 * @param userId
 * @param type - access level (read or write)
 * 
 * @returns true if the user has the specified access type
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
