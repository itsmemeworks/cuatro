ALTER TABLE `standing_games` ADD `rotation_cutoff_hours` integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `standing_games` ADD `rotation_mode` text DEFAULT 'limited' NOT NULL;