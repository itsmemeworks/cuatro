ALTER TABLE `sessions` ADD `rotation_locked_at` integer;--> statement-breakpoint
ALTER TABLE `standing_games` ADD `rotation_enabled` integer DEFAULT false NOT NULL;