/**
 * Type extensions for Express
 */

import type { User } from '../db/index.js';

declare global {
    namespace Express {
        interface Request {
            /**
             * Authenticated user attached by requireAuth middleware
             * Available after successful JWT verification and database lookup
             */
            user?: User;

            /**
             * Uploaded file attached by multer middleware
             * Available after multer.single('file') or similar multer middleware
             */
            file?: Express.Multer.File;
        }
    }
}
