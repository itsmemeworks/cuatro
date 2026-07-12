ALTER TABLE "users" ADD COLUMN "patch_size" text DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "indoor_outdoor" text;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "court_count" integer;--> statement-breakpoint
-- Backfill a unique slug for every existing venue BEFORE the unique constraint
-- lands, so boot-migrate never leaves a null slug behind (new rows get their
-- slug from server/venues.ts generateVenueSlug). Base = the name lower-cased
-- with non-alphanumerics collapsed to hyphens (empty → 'venue'); collisions
-- disambiguate by a stable '-2','-3',… suffix ordered by creation.
UPDATE "venues" v SET "slug" = r.slug FROM (
  SELECT id,
    CASE WHEN rn = 1 THEN base ELSE base || '-' || rn END AS slug
  FROM (
    SELECT id, base,
      row_number() OVER (PARTITION BY base ORDER BY "created_at", id) AS rn
    FROM (
      SELECT id,
        COALESCE(NULLIF(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'venue') AS base,
        "created_at"
      FROM "venues"
    ) s1
  ) s2
) r WHERE v.id = r.id;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_patch_size_check" CHECK ("users"."patch_size" in ('tight', 'local', 'wide'));--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_indoor_outdoor_check" CHECK ("venues"."indoor_outdoor" in ('indoor', 'outdoor', 'mixed'));