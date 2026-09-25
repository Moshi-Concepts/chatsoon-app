ALTER TABLE `profiles` ADD `search_visible` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `search_visible_at` integer;--> statement-breakpoint
ALTER TABLE `profiles` ADD `search_blocked` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `profiles_search_idx` ON `profiles` (`search_visible`,`slug`);