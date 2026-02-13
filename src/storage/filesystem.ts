import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StorageProvider } from './provider.js';

const UPLOAD_DIR = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, 'uploads')
    : './data/uploads';

/**
 * Filesystem storage provider.
 *
 * Stores uploaded files in local filesystem directory.
 * Default location: ./data/uploads/
 */
export const filesystemProvider: StorageProvider = {
    /**
     * Upload file to filesystem storage.
     *
     * @param buffer - File content buffer
     * @returns Absolute path to stored file
     */
    async uploadFile(buffer: Buffer): Promise<string> {
        const fileName = crypto.randomUUID();

        // Ensure upload directory exists
        await fs.mkdir(UPLOAD_DIR, { recursive: true });

        // Write file with UUID as filename
        const filePath = path.join(UPLOAD_DIR, fileName);
        await fs.writeFile(filePath, buffer);

        return filePath;
    },

    /**
     * Download file from filesystem storage.
     *
     * @param filePath - Absolute path to file
     * @returns File content buffer
     */
    async downloadFile(filePath: string): Promise<Buffer> {
        return await fs.readFile(filePath);
    },

    /**
     * Delete file from filesystem storage.
     *
     * @param filePath - Absolute path to file
     */
    async deleteFile(filePath: string): Promise<void> {
        try {
            await fs.unlink(filePath);
        } catch (error: any) {
            // Ignore ENOENT (file not found) errors
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    },
};
