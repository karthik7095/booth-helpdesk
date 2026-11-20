-- Enrolling new voters from the app is now a per-constituency feature, off by default.
-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "enable_enrollment" BOOLEAN NOT NULL DEFAULT false;
