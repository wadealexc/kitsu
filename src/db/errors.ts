/**
 * Base class for all db-related errors.
 */
export class DatabaseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DatabaseError';
    }
}

/**
 * Thrown when record creation unexpectedly fails (returns null/undefined).
 */
export class RecordCreationError extends DatabaseError {
    public readonly table: string;
    public readonly details?: string;

    constructor(table: string, details?: string) {
        super(`Failed to create ${table} record${details ? `: ${details}` : ''}`);
        this.name = 'RecordCreationError';
        this.table = table;
        this.details = details;
    }
}

/**
 * Thrown when attempting to read, update, or delete a record that doesn't exist.
 */
export class RecordNotFoundError extends DatabaseError {
    public readonly table: string;
    public readonly id: string;

    constructor(table: string, id: string) {
        super(`${table} record with id '${id}' not found`);
        this.name = 'RecordNotFoundError';
        this.table = table;
        this.id = id;
    }
}

/**
 * Thrown when data validation fails at the database layer.
 */
export class ValidationError extends DatabaseError {

    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}
