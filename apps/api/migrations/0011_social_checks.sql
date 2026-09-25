CREATE TABLE `social_checks` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`mfa_enabled` integer DEFAULT false NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`identity_verified` integer DEFAULT false NOT NULL,
	`followers_count` integer DEFAULT 0 NOT NULL,
	`checked_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `provider`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
