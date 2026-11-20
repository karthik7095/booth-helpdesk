-- Prebuilt SQLite copies of each constituency's roll.
CREATE TABLE "roll_bundles" (
    "id" TEXT NOT NULL,
    "assembly_id" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "built_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roll_bundles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "roll_bundles_assembly_id_key" ON "roll_bundles"("assembly_id");

ALTER TABLE "roll_bundles" ADD CONSTRAINT "roll_bundles_assembly_id_fkey"
    FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
