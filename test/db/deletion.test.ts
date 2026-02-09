import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { createTestDatabase, newUserParams, TEST_PASSWORD, type TestDatabase } from '../helpers.js';
import * as Users from '../../src/db/operations/users.js';
import type { User } from '../../src/db/operations/users.js';
import * as Auths from '../../src/db/operations/auths.js';
import * as Chats from '../../src/db/operations/chats.js';
import * as Folders from '../../src/db/operations/folders.js';
import * as Files from '../../src/db/operations/files.js';
import type { ChatObject, NewChatForm } from '../../src/routes/types.js';
import { currentUnixTimestamp } from '../../src/db/utils.js';

/* -------------------- TEST HELPERS -------------------- */

function _createChatObject(title: string = 'Chat'): ChatObject {
    return {
        title: title,
        models: [],
        messages: [],
        history: {
            messages: {},
        },
        timestamp: currentUnixTimestamp()
    }
}

function _createNewChatForm(title: string = 'Chat', folderId?: string): Chats.NewChat {
    return {
        title: title,
        chat: _createChatObject(title),
        folderId: folderId,
    }
}

/* -------------------- DATABASE CASCADE DELETION TESTS -------------------- */

describe('Database Cascade Deletion', () => {
    let db: TestDatabase;
    let primaryAdmin: User;

    beforeEach(async () => {
        db = await createTestDatabase();

        const params = newUserParams('admin');
        primaryAdmin = await Users.createUser(params, db);
    });

    afterEach(async () => {
        await db.$client?.close();
    });

    test('cannot delete primary admin', async () => {
        await assert.rejects(
            async () => { await Users.deleteUser(primaryAdmin.id, db) },
            { message: 'Cannot delete primary admin' }
        );
    });

    describe('User Deletion Cascades', () => {
        test('should cascade delete auth when user is deleted', async () => {
            // Create user + auth
            const userParams = newUserParams('admin');
            const user = await Users.createUser(userParams, db);
            await Auths.createAuth({
                id: user.id,
                username: userParams.username,
                password: TEST_PASSWORD
            }, db);

            // Verify auth exists
            const authBefore = await Auths.getAuthById(user.id, db);
            assert.ok(authBefore);
            assert.strictEqual(authBefore.id, user.id);

            // Delete user
            await Users.deleteUser(user.id, db);

            // Verify auth is gone
            const authAfter = await Auths.getAuthById(user.id, db);
            assert.strictEqual(authAfter, null);
        });

        test('should cascade delete all chats when user is deleted', async () => {
            // Create user
            const userParams = newUserParams('admin');
            const user = await Users.createUser(userParams, db);

            // Create multiple chats
            const chat1 = await Chats.createChat(
                user.id,
                _createNewChatForm('Chat 1'),
                db
            );
            const chat2 = await Chats.createChat(
                user.id,
                _createNewChatForm('Chat 2'),
                db
            );
            const chat3 = await Chats.createChat(
                user.id,
                _createNewChatForm('Chat 3'),
                db
            );

            // Verify chats exist
            const chatsBefore = await Chats.getChatsByUserId(user.id, {}, db);
            assert.strictEqual(chatsBefore.total, 3);

            // Delete user
            await Users.deleteUser(user.id, db);

            // Verify all chats are gone
            const chat1After = await Chats.getChatById(chat1.id, db);
            assert.strictEqual(chat1After, null);

            const chat2After = await Chats.getChatById(chat2.id, db);
            assert.strictEqual(chat2After, null);

            const chat3After = await Chats.getChatById(chat3.id, db);
            assert.strictEqual(chat3After, null);
        });

        test('should cascade delete all folders when user is deleted', async () => {
            // Create user
            const userParams = newUserParams('admin');
            const user = await Users.createUser(userParams, db);

            // Create folder hierarchy
            const rootFolder = await Folders.createFolder(
                user.id,
                { name: 'Root Folder' },
                null,
                db
            );
            const childFolder1 = await Folders.createFolder(
                user.id,
                { name: 'Child Folder 1' },
                rootFolder.id,
                db
            );
            const childFolder2 = await Folders.createFolder(
                user.id,
                { name: 'Child Folder 2' },
                rootFolder.id,
                db
            );
            const grandchildFolder = await Folders.createFolder(
                user.id,
                { name: 'Grandchild Folder' },
                childFolder1.id,
                db
            );

            // Verify folders exist
            const foldersBefore = await Folders.getFoldersByUserId(user.id, db);
            assert.strictEqual(foldersBefore.length, 4);

            // Delete user
            await Users.deleteUser(user.id, db);

            // Verify all folders are gone (including nested)
            const rootAfter = await Folders.getFolderById(rootFolder.id, user.id, db);
            assert.strictEqual(rootAfter, null);

            const child1After = await Folders.getFolderById(childFolder1.id, user.id, db);
            assert.strictEqual(child1After, null);

            const child2After = await Folders.getFolderById(childFolder2.id, user.id, db);
            assert.strictEqual(child2After, null);

            const grandchildAfter = await Folders.getFolderById(grandchildFolder.id, user.id, db);
            assert.strictEqual(grandchildAfter, null);
        });

        test('should cascade delete all files when user is deleted', async () => {
            // Create user
            const userParams = newUserParams('admin');
            const user = await Users.createUser(userParams, db);

            // Create multiple files
            const file1 = await Files.createFile(
                user.id,
                {
                    id: crypto.randomUUID(),
                    filename: 'document1.pdf',
                    path: '/path/to/doc1.pdf',
                },
                db
            );
            const file2 = await Files.createFile(
                user.id,
                {
                    id: crypto.randomUUID(),
                    filename: 'document2.pdf',
                    path: '/path/to/doc2.pdf',
                },
                db
            );

            // Verify files exist
            const filesBefore = await Files.getFilesByUserId(user.id, {}, db);
            assert.strictEqual(filesBefore.total, 2);

            // Delete user
            await Users.deleteUser(user.id, db);

            // Verify all files are gone
            const file1After = await Files.getFileById(file1.id, db);
            assert.strictEqual(file1After, null);

            const file2After = await Files.getFileById(file2.id, db);
            assert.strictEqual(file2After, null);
        });

        test('should cascade delete all related data when user is deleted', async () => {
            // Create user with comprehensive data
            const userParams = newUserParams('admin');
            const user = await Users.createUser(userParams, db);
            await Auths.createAuth({
                id: user.id,
                username: userParams.username,
                password: TEST_PASSWORD
            }, db);

            // Create folders (root level + nested hierarchy)
            const rootFolder = await Folders.createFolder(
                user.id,
                { name: 'Work' },
                null,
                db
            );
            const subFolder = await Folders.createFolder(
                user.id,
                { name: 'Projects' },
                rootFolder.id,
                db
            );

            // Create chats (some in folders, some at root level)
            const chatInFolder = await Chats.createChat(
                user.id,
                _createNewChatForm('Project Chat', subFolder.id),
                db
            );
            const chatAtRoot = await Chats.createChat(
                user.id,
                _createNewChatForm('Random Chat'),
                db
            );

            // Create files
            const file = await Files.createFile(
                user.id,
                {
                    id: crypto.randomUUID(),
                    filename: 'important.pdf',
                    path: '/path/to/important.pdf',
                },
                db
            );

            // Verify everything exists
            const userBefore = await Users.getUserById(user.id, db);
            assert.ok(userBefore);

            const authBefore = await Auths.getAuthById(user.id, db);
            assert.ok(authBefore);

            const foldersBefore = await Folders.getFoldersByUserId(user.id, db);
            assert.strictEqual(foldersBefore.length, 2);

            const chatsBefore = await Chats.getChatsByUserId(user.id, {}, db);
            assert.strictEqual(chatsBefore.total, 2);

            const filesBefore = await Files.getFilesByUserId(user.id, {}, db);
            assert.strictEqual(filesBefore.total, 1);

            // Delete user
            await Users.deleteUser(user.id, db);

            // Verify everything is gone (comprehensive check)
            const userAfter = await Users.getUserById(user.id, db);
            assert.strictEqual(userAfter, null);

            const authAfter = await Auths.getAuthById(user.id, db);
            assert.strictEqual(authAfter, null);

            const rootFolderAfter = await Folders.getFolderById(rootFolder.id, user.id, db);
            assert.strictEqual(rootFolderAfter, null);

            const subFolderAfter = await Folders.getFolderById(subFolder.id, user.id, db);
            assert.strictEqual(subFolderAfter, null);

            const chatInFolderAfter = await Chats.getChatById(chatInFolder.id, db);
            assert.strictEqual(chatInFolderAfter, null);

            const chatAtRootAfter = await Chats.getChatById(chatAtRoot.id, db);
            assert.strictEqual(chatAtRootAfter, null);

            const fileAfter = await Files.getFileById(file.id, db);
            assert.strictEqual(fileAfter, null);
        });

        test('should not affect other users data when one user is deleted', async () => {
            // Create two users
            const user1Params = newUserParams('admin');
            const user1 = await Users.createUser(user1Params, db);

            const user2Params = newUserParams('user');
            const user2 = await Users.createUser(user2Params, db);

            // Create data for both users
            const user1Folder = await Folders.createFolder(
                user1.id,
                { name: 'User 1 Folder' },
                null,
                db
            );
            const user2Folder = await Folders.createFolder(
                user2.id,
                { name: 'User 2 Folder' },
                null,
                db
            );

            const user1Chat = await Chats.createChat(
                user1.id,
                _createNewChatForm('User 1 Chat'),
                db
            );
            const user2Chat = await Chats.createChat(
                user2.id,
                _createNewChatForm('User 2 Chat'),
                db
            );

            // Delete user 1
            await Users.deleteUser(user1.id, db);

            // Verify user 1 data is gone
            const user1After = await Users.getUserById(user1.id, db);
            assert.strictEqual(user1After, null);

            const user1FolderAfter = await Folders.getFolderById(user1Folder.id, user1.id, db);
            assert.strictEqual(user1FolderAfter, null);

            const user1ChatAfter = await Chats.getChatById(user1Chat.id, db);
            assert.strictEqual(user1ChatAfter, null);

            // Verify user 2 data still exists
            const user2After = await Users.getUserById(user2.id, db);
            assert.ok(user2After);
            assert.strictEqual(user2After.id, user2.id);

            const user2FolderAfter = await Folders.getFolderById(user2Folder.id, user2.id, db);
            assert.ok(user2FolderAfter);
            assert.strictEqual(user2FolderAfter.id, user2Folder.id);

            const user2ChatAfter = await Chats.getChatById(user2Chat.id, db);
            assert.ok(user2ChatAfter);
            assert.strictEqual(user2ChatAfter.id, user2Chat.id);
        });
    });

    describe('Chat Deletion Cascades', () => {
        test('should cascade delete chat_file records when chat is deleted', async () => {
            // Create user, file, and chat
            const userParams = newUserParams('admin');
            const user = await Users.createUser(userParams, db);

            const file = await Files.createFile(
                user.id,
                {
                    id: crypto.randomUUID(),
                    filename: 'document.pdf',
                    path: '/path/to/document.pdf',
                },
                db
            );

            const chat = await Chats.createChat(
                user.id,
                _createNewChatForm('Test Chat'),
                db
            );

            // Associate file with chat
            const chatFileRecords = await Chats.insertChatFiles(
                chat.id,
                'message-1',
                [file.id],
                user.id,
                db
            );
            assert.strictEqual(chatFileRecords.length, 1);

            // Verify chat_file record exists
            const chatFilesBefore = await Chats.getChatFiles(chat.id, 'message-1', db);
            assert.strictEqual(chatFilesBefore.length, 1);

            // Delete chat
            const deleted = await Chats.deleteChat(chat.id, db);
            assert.strictEqual(deleted, true);

            // Verify chat is gone
            const chatAfter = await Chats.getChatById(chat.id, db);
            assert.strictEqual(chatAfter, null);

            // Verify chat_file record is gone
            const chatFilesAfter = await Chats.getChatFiles(chat.id, 'message-1', db);
            assert.strictEqual(chatFilesAfter.length, 0);

            // Verify file still exists (only association deleted)
            const fileAfter = await Files.getFileById(file.id, db);
            assert.ok(fileAfter);
            assert.strictEqual(fileAfter.id, file.id);
        });
    });

    describe('File Deletion Cascades', () => {
        test('should cascade delete chat_file records when file is deleted', async () => {
            // Create user, file, and chat
            const userParams = newUserParams('admin');
            const user = await Users.createUser(userParams, db);

            const file = await Files.createFile(
                user.id,
                {
                    id: crypto.randomUUID(),
                    filename: 'document.pdf',
                    path: '/path/to/document.pdf',
                },
                db
            );

            const chat = await Chats.createChat(
                user.id,
                _createNewChatForm('Test Chat'),
                db
            );

            // Associate file with chat
            const chatFileRecords = await Chats.insertChatFiles(
                chat.id,
                'message-1',
                [file.id],
                user.id,
                db
            );
            assert.strictEqual(chatFileRecords.length, 1);

            // Verify chat_file record exists
            const chatFilesBefore = await Chats.getChatFiles(chat.id, 'message-1', db);
            assert.strictEqual(chatFilesBefore.length, 1);

            // Delete file
            const deleted = await Files.deleteFile(file.id, db);
            assert.strictEqual(deleted, true);

            // Verify file is gone
            const fileAfter = await Files.getFileById(file.id, db);
            assert.strictEqual(fileAfter, null);

            // Verify chat_file record is gone
            const chatFilesAfter = await Chats.getChatFiles(chat.id, 'message-1', db);
            assert.strictEqual(chatFilesAfter.length, 0);

            // Verify chat still exists (only file association deleted)
            const chatAfter = await Chats.getChatById(chat.id, db);
            assert.ok(chatAfter);
            assert.strictEqual(chatAfter.id, chat.id);
        });
    });
});
