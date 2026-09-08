ALTER TABLE `piles` ADD `cover` blob;--> statement-breakpoint
ALTER TABLE `piles` ADD `cover_type` text;--> statement-breakpoint
ALTER TABLE `piles` ADD `remove_when_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `piles` ADD `pinned_at` integer;