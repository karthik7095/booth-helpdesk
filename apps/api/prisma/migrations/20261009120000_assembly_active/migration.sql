-- Constituencies are switched off rather than deleted.
-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;
