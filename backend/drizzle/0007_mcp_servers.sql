CREATE TABLE `mcp_server` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`token` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_server_name_unique` ON `mcp_server` (`name`);
-- The unused `file` and `chat_file` tables left the schema in 9c1c893 without a
-- migration. They are kept here rather than dropped, so no stored data is lost.
