CREATE TABLE `match_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `match_comments_match_id_created_at_idx` ON `match_comments` (`match_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `circle_members` ADD `last_read_at` integer;--> statement-breakpoint
ALTER TABLE `standing_games` ADD `cost_minor` integer;--> statement-breakpoint
ALTER TABLE `standing_games` ADD `cost_currency` text DEFAULT 'GBP' NOT NULL;