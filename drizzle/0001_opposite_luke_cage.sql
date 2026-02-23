PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`role` text NOT NULL,
	`profile_image_url` text DEFAULT '/static/user.png' NOT NULL,
	`profile_banner_image_url` text,
	`info` text,
	`settings` text,
	`last_active_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_user`("id", "username", "role", "profile_image_url", "profile_banner_image_url", "info", "settings", "last_active_at", "updated_at", "created_at") SELECT "id", "username", "role", "profile_image_url", "profile_banner_image_url", "info", "settings", "last_active_at", "updated_at", "created_at" FROM `user`;--> statement-breakpoint
DROP TABLE `user`;--> statement-breakpoint
ALTER TABLE `__new_user` RENAME TO `user`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_username` ON `user` (`username`);--> statement-breakpoint
CREATE INDEX `idx_user_role` ON `user` (`role`);--> statement-breakpoint
CREATE INDEX `idx_user_last_active_at` ON `user` (`last_active_at`);--> statement-breakpoint
CREATE INDEX `idx_user_created_at` ON `user` (`created_at`);