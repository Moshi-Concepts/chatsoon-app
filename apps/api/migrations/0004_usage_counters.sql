CREATE TABLE `usage_counters` (
	`key` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `usage_counters_day_idx` ON `usage_counters` (`day`);