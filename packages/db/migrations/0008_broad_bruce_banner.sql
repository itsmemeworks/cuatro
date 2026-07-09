CREATE TABLE `knocks` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knocks_open_unique` ON `knocks` (`kind`,`target_id`,`user_id`) WHERE "knocks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `knocks_kind_target_idx` ON `knocks` (`kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `knocks_user_id_idx` ON `knocks` (`user_id`);--> statement-breakpoint
ALTER TABLE `circles` ADD `board_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `circles` ADD `open_door` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `circles` ADD `vibe_line` text;--> statement-breakpoint
ALTER TABLE `users` ADD `findable` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `home_venue_id` text REFERENCES venues(id);--> statement-breakpoint
ALTER TABLE `users` ADD `patch_lat` real;--> statement-breakpoint
ALTER TABLE `users` ADD `patch_lng` real;