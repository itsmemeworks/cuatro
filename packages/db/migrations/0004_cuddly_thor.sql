CREATE TABLE `match_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'respect' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `match_reactions_match_id_idx` ON `match_reactions` (`match_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `match_reactions_match_user_kind_unique` ON `match_reactions` (`match_id`,`user_id`,`kind`);--> statement-breakpoint
ALTER TABLE `rsvps` ADD `source` text DEFAULT 'rsvp' NOT NULL;