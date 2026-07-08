CREATE TABLE `sessions_auth` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_auth_token_hash_unique` ON `sessions_auth` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_auth_user_id_idx` ON `sessions_auth` (`user_id`);--> statement-breakpoint
CREATE TABLE `magic_link_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magic_link_tokens_token_hash_unique` ON `magic_link_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `magic_link_tokens_email_idx` ON `magic_link_tokens` (`email`);--> statement-breakpoint
CREATE TABLE `circle_members` (
	`circle_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`circle_id`, `user_id`),
	FOREIGN KEY (`circle_id`) REFERENCES `circles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `circle_members_user_id_idx` ON `circle_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `circles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emblem` text,
	`colour` text,
	`country_code` text DEFAULT 'GB' NOT NULL,
	`timezone` text DEFAULT 'Europe/London' NOT NULL,
	`invite_code` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `circles_invite_code_unique` ON `circles` (`invite_code`);--> statement-breakpoint
CREATE INDEX `circles_created_by_idx` ON `circles` (`created_by`);--> statement-breakpoint
CREATE TABLE `match_confirmations` (
	`match_id` text NOT NULL,
	`team` text NOT NULL,
	`confirmed_by_user_id` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`match_id`, `team`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`confirmed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`team_a_player1_id` text NOT NULL,
	`team_a_player2_id` text NOT NULL,
	`team_b_player1_id` text NOT NULL,
	`team_b_player2_id` text NOT NULL,
	`score` text NOT NULL,
	`status` text DEFAULT 'pending_confirmation' NOT NULL,
	`played_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_a_player1_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_a_player2_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_b_player1_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`team_b_player2_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `matches_session_id_idx` ON `matches` (`session_id`);--> statement-breakpoint
CREATE INDEX `matches_status_idx` ON `matches` (`status`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user_id_created_at_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rating_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`match_id` text NOT NULL,
	`delta` real NOT NULL,
	`rating_before` real,
	`rating_after` real NOT NULL,
	`confidence_before` real NOT NULL,
	`confidence_after` real NOT NULL,
	`factors` text NOT NULL,
	`explanation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rating_events_user_id_created_at_idx` ON `rating_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `rating_events_match_id_idx` ON `rating_events` (`match_id`);--> statement-breakpoint
CREATE TABLE `rsvps` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`position` integer,
	`responded_at` integer NOT NULL,
	`promoted_at` integer,
	`cancelled_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rsvps_session_id_idx` ON `rsvps` (`session_id`);--> statement-breakpoint
CREATE INDEX `rsvps_user_id_idx` ON `rsvps` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rsvps_session_user_unique` ON `rsvps` (`session_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`standing_game_id` text,
	`circle_id` text NOT NULL,
	`venue_id` text,
	`starts_at` integer NOT NULL,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`standing_game_id`) REFERENCES `standing_games`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`circle_id`) REFERENCES `circles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_circle_id_idx` ON `sessions` (`circle_id`);--> statement-breakpoint
CREATE INDEX `sessions_standing_game_id_idx` ON `sessions` (`standing_game_id`);--> statement-breakpoint
CREATE INDEX `sessions_starts_at_idx` ON `sessions` (`starts_at`);--> statement-breakpoint
CREATE TABLE `standing_games` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`venue_id` text,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`duration_minutes` integer DEFAULT 90 NOT NULL,
	`slots` integer DEFAULT 4 NOT NULL,
	`rsvp_window_days` integer DEFAULT 6 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `standing_games_circle_id_idx` ON `standing_games` (`circle_id`);--> statement-breakpoint
CREATE TABLE `tab_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`tab_id` text NOT NULL,
	`session_id` text,
	`payer_user_id` text NOT NULL,
	`debtor_user_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'GBP' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`settled_confirmed_by` text,
	`created_at` integer NOT NULL,
	`nudged_at` integer,
	`settled_at` integer,
	FOREIGN KEY (`tab_id`) REFERENCES `tabs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debtor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settled_confirmed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tab_entries_tab_id_idx` ON `tab_entries` (`tab_id`);--> statement-breakpoint
CREATE INDEX `tab_entries_debtor_user_id_idx` ON `tab_entries` (`debtor_user_id`);--> statement-breakpoint
CREATE TABLE `tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`circle_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`circle_id`) REFERENCES `circles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tabs_circle_id_unique` ON `tabs` (`circle_id`);--> statement-breakpoint
CREATE INDEX `tabs_circle_id_idx` ON `tabs` (`circle_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` integer,
	`oauth_google_id` text,
	`oauth_apple_id` text,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`country_code` text DEFAULT 'GB' NOT NULL,
	`locale` text DEFAULT 'en-GB' NOT NULL,
	`rating` real,
	`confidence` real DEFAULT 0 NOT NULL,
	`verified_match_count` integer DEFAULT 0 NOT NULL,
	`placement_prior_rating` real,
	`rsvp_in_count` integer DEFAULT 0 NOT NULL,
	`show_up_count` integer DEFAULT 0 NOT NULL,
	`late_cancel_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_oauth_google_id_unique` ON `users` (`oauth_google_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_oauth_apple_id_unique` ON `users` (`oauth_apple_id`);--> statement-breakpoint
CREATE INDEX `users_country_code_idx` ON `users` (`country_code`);--> statement-breakpoint
CREATE TABLE `venues` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`place_id` text,
	`address` text,
	`lat` real,
	`lng` real,
	`country_code` text DEFAULT 'GB' NOT NULL,
	`timezone` text DEFAULT 'Europe/London' NOT NULL,
	`created_at` integer NOT NULL
);
