CREATE TABLE `auth` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_username_unique` ON `auth` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_username` ON `auth` (`username`);--> statement-breakpoint
CREATE TABLE `chat_file` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text,
	`file_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chat_id`) REFERENCES `chat`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_file_chat_file` ON `chat_file` (`chat_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_file_chat_id` ON `chat_file` (`chat_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_file_user_id` ON `chat_file` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_file_file_id` ON `chat_file` (`file_id`);--> statement-breakpoint
CREATE TABLE `chat` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`chat` text NOT NULL,
	`folder_id` text,
	`archived` integer DEFAULT false NOT NULL,
	`pinned` integer DEFAULT false,
	`meta` text DEFAULT '{}',
	`share_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_id` ON `chat` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_chat_share_id` ON `chat` (`share_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_user_id` ON `chat` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_folder_id` ON `chat` (`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_created_at` ON `chat` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_updated_at` ON `chat` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_user_id_pinned` ON `chat` (`user_id`,`pinned`);--> statement-breakpoint
CREATE INDEX `idx_chat_user_id_archived` ON `chat` (`user_id`,`archived`);--> statement-breakpoint
CREATE INDEX `idx_chat_updated_at_user_id` ON `chat` (`updated_at`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_folder_id_user_id` ON `chat` (`folder_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`hash` text,
	`filename` text NOT NULL,
	`path` text,
	`data` text,
	`meta` text,
	`access_control` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_file_id` ON `file` (`id`);--> statement-breakpoint
CREATE INDEX `idx_file_user_id` ON `file` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_file_created_at` ON `file` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_file_updated_at` ON `file` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_file_hash` ON `file` (`hash`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`items` text,
	`meta` text,
	`data` text,
	`is_expanded` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_folder_id` ON `folder` (`id`);--> statement-breakpoint
CREATE INDEX `idx_folder_user_id` ON `folder` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_parent_id` ON `folder` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_parent_id_user_id` ON `folder` (`parent_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_user_id_parent_id_name` ON `folder` (`user_id`,`parent_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_folder_created_at` ON `folder` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_folder_updated_at` ON `folder` (`updated_at`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`profile_image_url` text DEFAULT '/user.png' NOT NULL,
	`profile_banner_image_url` text,
	`info` text,
	`settings` text,
	`last_active_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_username` ON `user` (`username`);--> statement-breakpoint
CREATE INDEX `idx_user_role` ON `user` (`role`);--> statement-breakpoint
CREATE INDEX `idx_user_last_active_at` ON `user` (`last_active_at`);--> statement-breakpoint
CREATE INDEX `idx_user_created_at` ON `user` (`created_at`);