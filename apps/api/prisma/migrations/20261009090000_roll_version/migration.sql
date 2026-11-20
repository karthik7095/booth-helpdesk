-- Counts roll re-uploads so phones know to download the replaced roll afresh.
-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "roll_version" INTEGER NOT NULL DEFAULT 1;
