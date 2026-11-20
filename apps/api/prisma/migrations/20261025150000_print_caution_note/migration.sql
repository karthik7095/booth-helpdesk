-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "print_caution_note" BOOLEAN NOT NULL DEFAULT true;
