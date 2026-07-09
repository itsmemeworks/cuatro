ALTER TABLE `circles` ADD `header_image` text;--> statement-breakpoint
ALTER TABLE `circles` ADD `home_venue_id` text REFERENCES venues(id);--> statement-breakpoint
ALTER TABLE `circles` ADD `max_members` integer;