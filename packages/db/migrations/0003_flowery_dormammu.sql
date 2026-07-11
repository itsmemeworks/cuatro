ALTER TABLE "sessions" ADD COLUMN "booking_platform" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "booking_url" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "fourth_call_side_hint" text;--> statement-breakpoint
ALTER TABLE "standing_games" ADD COLUMN "booking_platform" text;--> statement-breakpoint
ALTER TABLE "standing_games" ADD COLUMN "booking_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dominant_hand" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "court_side" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_booking_platform_check" CHECK ("sessions"."booking_platform" in ('playtomic', 'padel_mates', 'matchi', 'padium', 'club_website', 'other'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_fourth_call_side_hint_check" CHECK ("sessions"."fourth_call_side_hint" in ('left', 'right'));--> statement-breakpoint
ALTER TABLE "standing_games" ADD CONSTRAINT "standing_games_booking_platform_check" CHECK ("standing_games"."booking_platform" in ('playtomic', 'padel_mates', 'matchi', 'padium', 'club_website', 'other'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_dominant_hand_check" CHECK ("users"."dominant_hand" in ('left', 'right', 'both'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_court_side_check" CHECK ("users"."court_side" in ('right', 'left', 'both'));