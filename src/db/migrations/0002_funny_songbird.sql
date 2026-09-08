CREATE TABLE `home_widgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`filter` text DEFAULT '{}' NOT NULL,
	`item_count` integer,
	`x` integer DEFAULT 0 NOT NULL,
	`y` integer DEFAULT 0 NOT NULL,
	`w` integer DEFAULT 4 NOT NULL,
	`h` integer DEFAULT 4 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `widget_entry_order` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`widget_id` integer NOT NULL,
	`entry_id` integer NOT NULL,
	`position` real NOT NULL,
	FOREIGN KEY (`widget_id`) REFERENCES `home_widgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `widget_entry_order_widget_id_entry_id_unique` ON `widget_entry_order` (`widget_id`,`entry_id`);--> statement-breakpoint
CREATE TABLE `widget_piles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`widget_id` integer NOT NULL,
	`pile_id` integer NOT NULL,
	FOREIGN KEY (`widget_id`) REFERENCES `home_widgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pile_id`) REFERENCES `piles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `widget_piles_widget_id_pile_id_unique` ON `widget_piles` (`widget_id`,`pile_id`);