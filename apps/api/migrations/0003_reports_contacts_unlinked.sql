-- Reports about a Connect form message (contact_id) have no target user, so target_user_id becomes
-- nullable. SQLite can't drop NOT NULL in place, so the table is rebuilt. Nothing references
-- reports, and D1 checks the deferred foreign keys when the migration commits.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text,
	`target_user_id` text,
	`contact_id` text,
	`reason` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_reports`("id", "reporter_id", "target_user_id", "contact_id", "reason", "details", "status", "created_at") SELECT "id", "reporter_id", "target_user_id", NULL, "reason", "details", "status", "created_at" FROM `reports`;--> statement-breakpoint
DROP TABLE `reports`;--> statement-breakpoint
ALTER TABLE `__new_reports` RENAME TO `reports`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
-- A card unlinked by a block remembers who it pointed at, so a scan after an unblock relinks it.
ALTER TABLE `contacts` ADD `unlinked_user_id` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
-- Sessions no longer keep the sign-in IP address or user agent (lib/auth.ts). Clear existing ones.
UPDATE `sessions` SET `ip_address` = NULL, `user_agent` = NULL;
