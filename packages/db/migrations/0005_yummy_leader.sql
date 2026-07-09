PRAGMA foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `users` ADD `is_guest` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `guest_claim_token_hash` text;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`email_verified_at` integer,
	`oauth_google_id` text,
	`oauth_apple_id` text,
	`supabase_user_id` text,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`is_guest` integer DEFAULT false NOT NULL,
	`guest_claim_token_hash` text,
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
INSERT INTO `__new_users`("id", "email", "email_verified_at", "oauth_google_id", "oauth_apple_id", "supabase_user_id", "display_name", "avatar_url", "is_guest", "guest_claim_token_hash", "country_code", "locale", "rating", "confidence", "verified_match_count", "placement_prior_rating", "rsvp_in_count", "show_up_count", "late_cancel_count", "created_at", "updated_at") SELECT "id", "email", "email_verified_at", "oauth_google_id", "oauth_apple_id", "supabase_user_id", "display_name", "avatar_url", "is_guest", "guest_claim_token_hash", "country_code", "locale", "rating", "confidence", "verified_match_count", "placement_prior_rating", "rsvp_in_count", "show_up_count", "late_cancel_count", "created_at", "updated_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_oauth_google_id_unique` ON `users` (`oauth_google_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_oauth_apple_id_unique` ON `users` (`oauth_apple_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_supabase_user_id_unique` ON `users` (`supabase_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_guest_claim_token_hash_unique` ON `users` (`guest_claim_token_hash`);--> statement-breakpoint
CREATE INDEX `users_country_code_idx` ON `users` (`country_code`);--> statement-breakpoint
ALTER TABLE `rsvps` ADD `hold_expires_at` integer;