CREATE TABLE `email_leads` (
	`email` text PRIMARY KEY NOT NULL,
	`consent_at` integer NOT NULL,
	`consent_source` text NOT NULL,
	`consent_text` text NOT NULL,
	`step` integer DEFAULT 0 NOT NULL,
	`next_send_at` integer,
	`unsubscribed_at` integer,
	`converted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_leads_next_send_idx` ON `email_leads` (`next_send_at`);--> statement-breakpoint
CREATE TABLE `email_prefs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`tips_opt_out_at` integer,
	`nudge_step` integer DEFAULT 0 NOT NULL,
	`next_nudge_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_prefs_next_nudge_idx` ON `email_prefs` (`next_nudge_at`);