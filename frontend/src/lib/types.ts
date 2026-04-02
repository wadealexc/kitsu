import type {
    ChatMessageFile,
    FileModelResponse,
    FolderNameIdResponse,
    FolderData
} from '@backend/routes/types';

/**
 * Extended file item used during the upload lifecycle in MessageInput.
 * Starts with placeholder values during upload, filled from FileModelResponse on completion.
 */
export type SidebarFolder = FolderNameIdResponse & {
    childrenIds?: string[];
    new?: boolean;
    data?: FolderData;
};

export type InputFileItem = ChatMessageFile & {
    status?: 'uploading' | 'uploaded';
    itemId?: string;
    file?: FileModelResponse;
    content?: string;
};
