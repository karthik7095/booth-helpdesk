-- AlterTable
ALTER TABLE "voters" ADD COLUMN     "assembly_id" TEXT;

-- CreateIndex
CREATE INDEX "voters_assembly_id_idx" ON "voters"("assembly_id");

-- AddForeignKey
ALTER TABLE "voters" ADD CONSTRAINT "voters_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: existing rolls were linked by assembly_no only.
UPDATE "voters" v
SET "assembly_id" = a."id"
FROM "assemblies" a
WHERE a."assembly_no" = v."assembly_no" AND v."assembly_id" IS NULL;
