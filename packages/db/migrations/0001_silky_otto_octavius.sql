ALTER TABLE "circles" ADD COLUMN "default_game_type" text DEFAULT 'competitive' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "game_type" text DEFAULT 'competitive' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "game_type" text DEFAULT 'competitive' NOT NULL;--> statement-breakpoint
ALTER TABLE "standing_games" ADD COLUMN "game_type" text DEFAULT 'competitive' NOT NULL;--> statement-breakpoint
ALTER TABLE "circles" ADD CONSTRAINT "circles_default_game_type_check" CHECK ("circles"."default_game_type" in ('competitive', 'friendly'));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_game_type_check" CHECK ("matches"."game_type" in ('competitive', 'friendly'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_game_type_check" CHECK ("sessions"."game_type" in ('competitive', 'friendly'));--> statement-breakpoint
ALTER TABLE "standing_games" ADD CONSTRAINT "standing_games_game_type_check" CHECK ("standing_games"."game_type" in ('competitive', 'friendly'));