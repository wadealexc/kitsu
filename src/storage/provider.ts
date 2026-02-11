/**
 * Storage provider interface for file uploads.
 *
 * Provides pluggable storage backends (filesystem, S3, GCS, Azure).
 * Currently implements filesystem storage only.
 */

export interface StorageProvider {
    uploadFile(buffer: Buffer, metadata: any): Promise<string>;
    downloadFile(path: string): Promise<Buffer>;
    deleteFile(path: string): Promise<void>;
}

// Default to filesystem provider
import { filesystemProvider } from './filesystem.js';
export const StorageProvider = filesystemProvider;
