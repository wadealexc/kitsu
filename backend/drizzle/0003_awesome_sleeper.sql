DROP INDEX `idx_chat_user_id_pinned`;--> statement-breakpoint
DROP INDEX `idx_chat_user_id_archived`;--> statement-breakpoint
ALTER TABLE `chat` DROP COLUMN `archived`;--> statement-breakpoint
ALTER TABLE `chat` DROP COLUMN `pinned`;