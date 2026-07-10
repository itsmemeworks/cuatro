CREATE TABLE "sessions_auth" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "sessions_auth_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "magic_link_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"email" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint,
	"created_at" bigint NOT NULL,
	CONSTRAINT "magic_link_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "circle_members" (
	"circle_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" bigint NOT NULL,
	"last_read_at" bigint,
	CONSTRAINT "circle_members_circle_id_user_id_pk" PRIMARY KEY("circle_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "circle_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"circle_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" bigint NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "circle_messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1)
);
--> statement-breakpoint
CREATE TABLE "circles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"emblem" text,
	"colour" text,
	"country_code" text DEFAULT 'GB' NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"invite_code" text NOT NULL,
	"created_by" text NOT NULL,
	"board_enabled" boolean DEFAULT true NOT NULL,
	"open_door" boolean DEFAULT true NOT NULL,
	"vibe_line" text,
	"header_image" text,
	"home_venue_id" text,
	"max_members" integer,
	"created_at" bigint NOT NULL,
	CONSTRAINT "circles_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "knocks" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" bigint NOT NULL,
	"decided_at" bigint,
	"decided_by" text
);
--> statement-breakpoint
CREATE TABLE "match_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_confirmations" (
	"match_id" text NOT NULL,
	"team" text NOT NULL,
	"confirmed_by_user_id" text NOT NULL,
	"confirmed_at" bigint NOT NULL,
	CONSTRAINT "match_confirmations_match_id_team_pk" PRIMARY KEY("match_id","team")
);
--> statement-breakpoint
CREATE TABLE "match_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'respect' NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "match_reactions_match_user_kind_unique" UNIQUE("match_id","user_id","kind")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"team_a_player1_id" text NOT NULL,
	"team_a_player2_id" text NOT NULL,
	"team_b_player1_id" text NOT NULL,
	"team_b_player2_id" text NOT NULL,
	"score" jsonb NOT NULL,
	"status" text DEFAULT 'pending_confirmation' NOT NULL,
	"outcome" text DEFAULT 'completed' NOT NULL,
	"played_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb,
	"read_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"match_id" text NOT NULL,
	"delta" real NOT NULL,
	"rating_before" real,
	"rating_after" real NOT NULL,
	"confidence_before" real NOT NULL,
	"confidence_after" real NOT NULL,
	"factors" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rsvps" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"position" integer,
	"source" text DEFAULT 'rsvp' NOT NULL,
	"responded_at" bigint NOT NULL,
	"promoted_at" bigint,
	"cancelled_at" bigint,
	"hold_expires_at" bigint,
	CONSTRAINT "rsvps_session_user_unique" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"standing_game_id" text,
	"circle_id" text NOT NULL,
	"venue_id" text,
	"starts_at" bigint NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"rotation_locked_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_games" (
	"id" text PRIMARY KEY NOT NULL,
	"circle_id" text NOT NULL,
	"venue_id" text,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"duration_minutes" integer DEFAULT 90 NOT NULL,
	"slots" integer DEFAULT 4 NOT NULL,
	"rsvp_window_days" integer DEFAULT 6 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"rotation_enabled" boolean DEFAULT false NOT NULL,
	"rotation_cutoff_hours" integer DEFAULT 24 NOT NULL,
	"rotation_mode" text DEFAULT 'limited' NOT NULL,
	"cost_minor" integer,
	"cost_currency" text DEFAULT 'GBP' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tab_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"tab_id" text NOT NULL,
	"session_id" text,
	"payer_user_id" text NOT NULL,
	"debtor_user_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"settled_confirmed_by" text,
	"created_at" bigint NOT NULL,
	"nudged_at" bigint,
	"settled_at" bigint
);
--> statement-breakpoint
CREATE TABLE "tabs" (
	"id" text PRIMARY KEY NOT NULL,
	"circle_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "tabs_circle_id_unique" UNIQUE("circle_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"email_verified_at" bigint,
	"oauth_google_id" text,
	"oauth_apple_id" text,
	"supabase_user_id" text,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"is_guest" boolean DEFAULT false NOT NULL,
	"guest_claim_token_hash" text,
	"country_code" text DEFAULT 'GB' NOT NULL,
	"locale" text DEFAULT 'en-GB' NOT NULL,
	"findable" boolean DEFAULT true NOT NULL,
	"home_venue_id" text,
	"patch_lat" real,
	"patch_lng" real,
	"rating" real,
	"confidence" real DEFAULT 0 NOT NULL,
	"verified_match_count" integer DEFAULT 0 NOT NULL,
	"placement_prior_rating" real,
	"rsvp_in_count" integer DEFAULT 0 NOT NULL,
	"show_up_count" integer DEFAULT 0 NOT NULL,
	"late_cancel_count" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_oauth_google_id_unique" UNIQUE("oauth_google_id"),
	CONSTRAINT "users_oauth_apple_id_unique" UNIQUE("oauth_apple_id"),
	CONSTRAINT "users_supabase_user_id_unique" UNIQUE("supabase_user_id"),
	CONSTRAINT "users_guest_claim_token_hash_unique" UNIQUE("guest_claim_token_hash")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"place_id" text,
	"address" text,
	"lat" real,
	"lng" real,
	"country_code" text DEFAULT 'GB' NOT NULL,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions_auth" ADD CONSTRAINT "sessions_auth_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_members" ADD CONSTRAINT "circle_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_messages" ADD CONSTRAINT "circle_messages_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circle_messages" ADD CONSTRAINT "circle_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circles" ADD CONSTRAINT "circles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "circles" ADD CONSTRAINT "circles_home_venue_id_venues_id_fk" FOREIGN KEY ("home_venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_comments" ADD CONSTRAINT "match_comments_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_comments" ADD CONSTRAINT "match_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_confirmations" ADD CONSTRAINT "match_confirmations_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_confirmations" ADD CONSTRAINT "match_confirmations_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reactions" ADD CONSTRAINT "match_reactions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reactions" ADD CONSTRAINT "match_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_a_player1_id_users_id_fk" FOREIGN KEY ("team_a_player1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_a_player2_id_users_id_fk" FOREIGN KEY ("team_a_player2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_b_player1_id_users_id_fk" FOREIGN KEY ("team_b_player1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_team_b_player2_id_users_id_fk" FOREIGN KEY ("team_b_player2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_events" ADD CONSTRAINT "rating_events_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_standing_game_id_standing_games_id_fk" FOREIGN KEY ("standing_game_id") REFERENCES "public"."standing_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_games" ADD CONSTRAINT "standing_games_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_games" ADD CONSTRAINT "standing_games_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_entries" ADD CONSTRAINT "tab_entries_tab_id_tabs_id_fk" FOREIGN KEY ("tab_id") REFERENCES "public"."tabs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_entries" ADD CONSTRAINT "tab_entries_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_entries" ADD CONSTRAINT "tab_entries_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_entries" ADD CONSTRAINT "tab_entries_debtor_user_id_users_id_fk" FOREIGN KEY ("debtor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tab_entries" ADD CONSTRAINT "tab_entries_settled_confirmed_by_users_id_fk" FOREIGN KEY ("settled_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_circle_id_circles_id_fk" FOREIGN KEY ("circle_id") REFERENCES "public"."circles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_home_venue_id_venues_id_fk" FOREIGN KEY ("home_venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_auth_user_id_idx" ON "sessions_auth" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_email_idx" ON "magic_link_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "circle_members_user_id_idx" ON "circle_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "circle_messages_circle_id_created_at_idx" ON "circle_messages" USING btree ("circle_id","created_at");--> statement-breakpoint
CREATE INDEX "circle_messages_circle_id_seq_idx" ON "circle_messages" USING btree ("circle_id","seq");--> statement-breakpoint
CREATE INDEX "circles_created_by_idx" ON "circles" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "knocks_open_unique" ON "knocks" USING btree ("kind","target_id","user_id") WHERE "knocks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "knocks_kind_target_idx" ON "knocks" USING btree ("kind","target_id");--> statement-breakpoint
CREATE INDEX "knocks_user_id_idx" ON "knocks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "match_comments_match_id_created_at_idx" ON "match_comments" USING btree ("match_id","created_at");--> statement-breakpoint
CREATE INDEX "match_reactions_match_id_idx" ON "match_reactions" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "matches_session_id_idx" ON "matches" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "matches_status_idx" ON "matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "rating_events_user_id_created_at_idx" ON "rating_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "rating_events_match_id_idx" ON "rating_events" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "rsvps_session_id_idx" ON "rsvps" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "rsvps_user_id_idx" ON "rsvps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_circle_id_idx" ON "sessions" USING btree ("circle_id");--> statement-breakpoint
CREATE INDEX "sessions_standing_game_id_idx" ON "sessions" USING btree ("standing_game_id");--> statement-breakpoint
CREATE INDEX "sessions_starts_at_idx" ON "sessions" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "standing_games_circle_id_idx" ON "standing_games" USING btree ("circle_id");--> statement-breakpoint
CREATE INDEX "tab_entries_tab_id_idx" ON "tab_entries" USING btree ("tab_id");--> statement-breakpoint
CREATE INDEX "tab_entries_debtor_user_id_idx" ON "tab_entries" USING btree ("debtor_user_id");--> statement-breakpoint
CREATE INDEX "tabs_circle_id_idx" ON "tabs" USING btree ("circle_id");--> statement-breakpoint
CREATE INDEX "users_country_code_idx" ON "users" USING btree ("country_code");