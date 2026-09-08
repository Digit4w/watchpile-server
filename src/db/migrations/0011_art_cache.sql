CREATE TABLE `art_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`last_used_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`provider`) REFERENCES `providers`(`slug`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `art_cache_last_used_idx` ON `art_cache` (`last_used_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `art_cache_provider_external_id_unique` ON `art_cache` (`provider`,`external_id`);
