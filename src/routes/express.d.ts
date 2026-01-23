/**
 * Type extensions for Express
 */

import type { User } from '../db/schema.js';

declare global {
    namespace Express {
        interface Request {
            /**
             * Authenticated user attached by requireAuth middleware
             * Available after successful JWT verification and database lookup
             */
            user?: User;
        }
    }
}
