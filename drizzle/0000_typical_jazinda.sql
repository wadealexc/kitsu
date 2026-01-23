CREATE TABLE `auth` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_username_unique` ON `auth` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_auth_username` ON `auth` (`username`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`role` text DEFAULT 'pending' NOT NULL,
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