CREATE TABLE `badges` (
	`user_id` text NOT NULL,
	`badge` text NOT NULL,
	`seq` integer,
	`awarded_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`ref_id` text,
	PRIMARY KEY(`user_id`, `badge`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `badges_badge_seq_idx` ON `badges` (`badge`,`seq`);--> statement-breakpoint
CREATE TABLE `points_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`event` text NOT NULL,
	`ref_id` text,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `points_ledger_user_idx` ON `points_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `points_ledger_event_ref_idx` ON `points_ledger` (`event`,`ref_id`);--> statement-breakpoint
CREATE TABLE `referral_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`milestone` integer NOT NULL,
	`token_hash` text NOT NULL,
	`token_expires_at` integer NOT NULL,
	`destination` text NOT NULL,
	`share_consent_at` integer NOT NULL,
	`share_consent_text` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`redeemed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_claims_user_milestone_idx` ON `referral_claims` (`user_id`,`milestone`);--> statement-breakpoint
CREATE UNIQUE INDEX `referral_claims_token_idx` ON `referral_claims` (`token_hash`);--> statement-breakpoint
CREATE TABLE `referral_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`referrer_id` text NOT NULL,
	`email` text NOT NULL,
	`sent_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`unsubscribed_at` integer,
	`converted_at` integer,
	FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_invites_pair_idx` ON `referral_invites` (`referrer_id`,`email`);--> statement-breakpoint
CREATE INDEX `referral_invites_email_idx` ON `referral_invites` (`email`);--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` text PRIMARY KEY NOT NULL,
	`referrer_id` text NOT NULL,
	`referred_user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`source` text DEFAULT 'typed' NOT NULL,
	`device_id` text,
	`ip_hash` text,
	`ua_hash` text,
	`qualifies_after` integer,
	`qualified_at` integer,
	`flag_cleared_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`referred_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referrals_referred_idx` ON `referrals` (`referred_user_id`);--> statement-breakpoint
CREATE INDEX `referrals_referrer_status_idx` ON `referrals` (`referrer_id`,`status`);--> statement-breakpoint
CREATE INDEX `referrals_qualifies_idx` ON `referrals` (`status`,`qualifies_after`);--> statement-breakpoint
CREATE INDEX `referrals_device_idx` ON `referrals` (`device_id`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `referral_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_referral_code_idx` ON `profiles` (`referral_code`);