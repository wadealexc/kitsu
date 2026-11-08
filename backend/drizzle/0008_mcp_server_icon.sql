ALTER TABLE `mcp_server` ADD `icon` text DEFAULT 'wrench' NOT NULL;
--> statement-breakpoint
-- Servers that had the globe when it was picked by name keep it.
UPDATE `mcp_server` SET `icon` = 'globe' WHERE lower(`name`) LIKE '%web%' OR lower(`name`) LIKE '%search%' OR lower(`name`) LIKE '%browse%';
