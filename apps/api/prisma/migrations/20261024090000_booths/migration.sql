-- Polling stations and their addresses, per constituency. IF NOT EXISTS: the
-- table was first created by hand on the Booth Help Desk database to load
-- Pendurthi Ward 115 ahead of a deploy.
CREATE TABLE IF NOT EXISTS "booths" (
    "id" TEXT NOT NULL,
    "assembly_id" TEXT NOT NULL,
    "part_no" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "address_native" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booths_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "booths_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "booths_assembly_id_part_no_key" ON "booths"("assembly_id", "part_no");
