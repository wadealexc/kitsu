import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { createId } from '@paralleldrive/cuid2';
import { relations } from 'drizzle-orm';

// ============================================================
// Schema matches OpenWebUI structure with intentional exceptions:
// 1. chat.messages instead of chat.chat (clearer naming)
// 2. chat.metadata instead of chat.meta (clearer naming)
// API responses will transform these to match frontend expectations
// ============================================================

// ============================================================
// Authentication & Users
// ============================================================

export const users = sqliteTable('user', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull().unique(),
  username: text('username'),
  name: text('name').notNull(),
  password_hash: text('password_hash'), // Internal only, never in responses
  role: text('role', { enum: ['admin', 'user', 'pending'] }).notNull().default('user'),

  // Profile
  profile_image_url: text('profile_image_url'),

  // Extended user fields (optional, used by frontend)
  settings: text('settings', { mode: 'json' }).$type<{
    ui?: Record<string, any>;
    [key: string]: any;
  }>(),
  info: text('info', { mode: 'json' }).$type<Record<string, any>>(),
  oauth: text('oauth', { mode: 'json' }).$type<Record<string, any>>(),

  // Timestamps
  last_active_at: integer('last_active_at'),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const sessions = sqliteTable('session', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expires_at: integer('expires_at').notNull(),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});

// ============================================================
// Groups & Permissions
// ============================================================

export const groups = sqliteTable('group', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull().unique(),
  description: text('description'),
  permissions: text('permissions', { mode: 'json' }).$type<{
    models?: string[];
    tools?: string[];
    [key: string]: any;
  }>(),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const group_members = sqliteTable('group_member', {
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  group_id: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.user_id, table.group_id] }),
}));

// ============================================================
// Chats & Messages
// ============================================================

export const chats = sqliteTable('chat', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),

  // INTENTIONAL DEVIATION: Using 'messages' instead of 'chat' for clarity
  // Frontend expects 'chat' field - API will transform: { chat: messages }
  messages: text('messages', { mode: 'json' }).$type<{
    messages?: any[];
    history?: { messages?: Record<string, any> };
    [key: string]: any;
  }>().notNull().default({}),

  // INTENTIONAL DEVIATION: Using 'metadata' instead of 'meta' for clarity
  // Frontend expects 'meta' field - API will transform: { meta: metadata }
  metadata: text('metadata', { mode: 'json' }).$type<{
    tags?: string[];
    [key: string]: any;
  }>().default({}),

  // Folder association (stored directly in chat, not junction table)
  folder_id: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),

  // Sharing and organization
  share_id: text('share_id').unique(),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),

  // Timestamps (Unix epoch seconds)
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});

// ============================================================
// Organization (Folders & Tags)
// ============================================================

export const folders = sqliteTable('folder', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  user_id: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  parent_id: text('parent_id').references((): any => folders.id, { onDelete: 'cascade' }),
  is_expanded: integer('is_expanded', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});

export const tags = sqliteTable('tag', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull().unique(),
});

export const chat_tags = sqliteTable('chat_tag', {
  chat_id: text('chat_id').notNull().references(() => chats.id, { onDelete: 'cascade' }),
  tag_id: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.chat_id, table.tag_id] }),
}));

// ============================================================
// Models Registry
// ============================================================

export const models = sqliteTable('model', {
  id: text('id').primaryKey(), // Model name/ID from llama.cpp
  name: text('name').notNull(), // Display name
  info: text('info', { mode: 'json' }).$type<{
    capabilities?: string[];
    params?: Record<string, any>;
    [key: string]: any;
  }>(),
  is_active: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  created_at: integer('created_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});

// ============================================================
// System Config
// ============================================================

export const configs = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<any>(),
  updated_at: integer('updated_at').$defaultFn(() => Math.floor(Date.now() / 1000)),
});

// ============================================================
// Relations (for better query ergonomics)
// ============================================================

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  chats: many(chats),
  folders: many(folders),
  group_memberships: many(group_members),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.user_id],
    references: [users.id],
  }),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  user: one(users, {
    fields: [chats.user_id],
    references: [users.id],
  }),
  folder: one(folders, {
    fields: [chats.folder_id],
    references: [folders.id],
  }),
  chat_tags: many(chat_tags),
}));

export const foldersRelations = relations(folders, ({ one, many }) => ({
  user: one(users, {
    fields: [folders.user_id],
    references: [users.id],
  }),
  parent: one(folders, {
    fields: [folders.parent_id],
    references: [folders.id],
  }),
  children: many(folders),
  chats: many(chats),
}));

export const groupsRelations = relations(groups, ({ many }) => ({
  members: many(group_members),
}));

export const group_membersRelations = relations(group_members, ({ one }) => ({
  user: one(users, {
    fields: [group_members.user_id],
    references: [users.id],
  }),
  group: one(groups, {
    fields: [group_members.group_id],
    references: [groups.id],
  }),
}));

export const chat_tagsRelations = relations(chat_tags, ({ one }) => ({
  chat: one(chats, {
    fields: [chat_tags.chat_id],
    references: [chats.id],
  }),
  tag: one(tags, {
    fields: [chat_tags.tag_id],
    references: [tags.id],
  }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  chat_tags: many(chat_tags),
}));
