-- The prebuilt SQLite bundle is gone; phones sync deltas instead.
DROP TABLE IF EXISTS "roll_bundles";

-- Delta pulls ask for everything changed since the phone last synced.
CREATE INDEX IF NOT EXISTS "voters_assembly_no_updated_at_idx" ON "voters"("assembly_no", "updated_at");
