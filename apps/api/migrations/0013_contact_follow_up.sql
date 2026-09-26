ALTER TABLE `contacts` ADD `followed_up_at` integer;--> statement-breakpoint
ALTER TABLE `contacts` ADD `follow_up_channel` text;--> statement-breakpoint
ALTER TABLE `contacts` ADD `follow_up_due_at` integer;--> statement-breakpoint
CREATE INDEX `contacts_user_follow_up_due_idx` ON `contacts` (`user_id`,`follow_up_due_at`);