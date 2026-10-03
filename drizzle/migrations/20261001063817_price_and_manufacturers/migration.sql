WITH ranked AS (
  SELECT id, lower(name) AS name_key, row_number() OVER (PARTITION BY lower(name) ORDER BY id) AS n
  FROM manufacturers
),
keepers AS (
  SELECT id, name_key FROM ranked WHERE n = 1
),
dupes AS (
  SELECT ranked.id AS dupe_id, keepers.id AS keep_id
  FROM ranked
  JOIN keepers ON keepers.name_key = ranked.name_key
  WHERE ranked.n > 1
)
UPDATE watches SET manufacturer_id = dupes.keep_id
FROM dupes
WHERE watches.manufacturer_id = dupes.dupe_id;--> statement-breakpoint
DELETE FROM manufacturers AS extra
USING manufacturers AS keep
WHERE extra.id > keep.id AND lower(extra.name) = lower(keep.name);--> statement-breakpoint
DROP INDEX "manufacturers_name_idx";--> statement-breakpoint
ALTER TABLE "price_points" ALTER COLUMN "amount_cents" SET DATA TYPE bigint USING "amount_cents"::bigint;--> statement-breakpoint
CREATE INDEX "complications_watch_id_idx" ON "complications" ("watch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturers_name_lower_idx" ON "manufacturers" (lower("name"));--> statement-breakpoint
CREATE INDEX "price_points_watch_id_idx" ON "price_points" ("watch_id");