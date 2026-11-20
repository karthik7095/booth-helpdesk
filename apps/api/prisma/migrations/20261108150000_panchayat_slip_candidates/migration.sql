-- Panchayat slip header: typed heading, tagline and candidates with their symbols.
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "slip_heading" TEXT;
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "slip_tagline" TEXT;
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "sarpanch_name" TEXT;
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "sarpanch_name_en" TEXT;
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "sarpanch_symbol_path" TEXT;
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "sarpanch_symbol_mime" TEXT;
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "sarpanch_symbol_updated_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ward_candidates" (
    "id" TEXT NOT NULL,
    "assembly_id" TEXT NOT NULL,
    "ward_no" INTEGER NOT NULL,
    "name" TEXT,
    "name_en" TEXT,
    "symbol_path" TEXT,
    "symbol_mime" TEXT,
    "symbol_updated_at" TIMESTAMP(3),
    "updated_by_name" TEXT,
    "updated_by_mobile" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ward_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ward_candidates_assembly_id_ward_no_key" ON "ward_candidates"("assembly_id", "ward_no");

ALTER TABLE "ward_candidates" ADD CONSTRAINT "ward_candidates_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
