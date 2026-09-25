CREATE TABLE `account_deletions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`requested_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`delete_after` integer NOT NULL,
	`cancel_token_hash` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_deletions_delete_after_idx` ON `account_deletions` (`delete_after`);