/**
 * HTTP Error Classes
 *
 * Custom error class for HTTP responses with status codes.
 * Provides convenience factory functions for common HTTP errors.
 */

export class HttpError extends Error {
    constructor(
        message: string,
        public statusCode: number
    ) {
        super(message);
        this.name = 'HttpError';
    }
}

/* -------------------- CONVENIENCE FACTORY FUNCTIONS -------------------- */

export const NotFoundError = (message: string) => new HttpError(message, 404);
export const ForbiddenError = (message: string) => new HttpError(message, 403);
export const BadRequestError = (message: string) => new HttpError(message, 400);
export const UnauthorizedError = (message: string) => new HttpError(message, 401);
