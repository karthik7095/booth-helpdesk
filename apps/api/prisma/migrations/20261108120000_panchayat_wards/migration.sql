-- Gram panchayats: a ward number on each voter and a slip print banner per ward.
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "is_panchayat" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "voters" ADD COLUMN IF NOT EXISTS "ward_no" INTEGER;
CREATE INDEX IF NOT EXISTS "voters_assembly_no_ward_no_idx" ON "voters"("assembly_no", "ward_no");

CREATE TABLE IF NOT EXISTS "ward_print_banners" (
    "id" TEXT NOT NULL,
    "assembly_id" TEXT NOT NULL,
    "ward_no" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "updated_by_name" TEXT,
    "updated_by_mobile" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ward_print_banners_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ward_print_banners_assembly_id_ward_no_key" ON "ward_print_banners"("assembly_id", "ward_no");

ALTER TABLE "ward_print_banners" ADD CONSTRAINT "ward_print_banners_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
