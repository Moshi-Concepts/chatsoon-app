ALTER TABLE `profiles` ADD `contact` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `contact_visibility` text DEFAULT 'connections' NOT NULL;