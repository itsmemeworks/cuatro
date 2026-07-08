ALTER TABLE `users` ADD `supabase_user_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_supabase_user_id_unique` ON `users` (`supabase_user_id`);