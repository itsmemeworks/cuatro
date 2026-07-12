ALTER TABLE "users" ADD COLUMN "notify_fourth_call" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_rotation" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_tab_nudge" boolean DEFAULT true NOT NULL;