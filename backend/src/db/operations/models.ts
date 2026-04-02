import { eq } from 'drizzle-orm';

import { db, type DbOrTx } from '../client.js';
import { models, users } from '../schema.js';
import { currentUnixTimestamp } from '../utils.js';
import type { UserRole } from '../../routes/types/index.js';
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
            },
        })
        .from(models)
        .leftJoin(users, eq(users.id, models.userId));

    return result.map(row => ({
        ...row.model,
        user: row.user,
    }));
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
    if (model.userId === userId) return true;
    if (type === 'write') return false;        // only owner can write
    return model.isPublic;                     // public = anyone can read
}
