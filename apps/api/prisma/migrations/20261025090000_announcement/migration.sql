-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "announcement_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "announcement_title" TEXT,
ADD COLUMN IF NOT EXISTS "announcement_body" TEXT,
ADD COLUMN IF NOT EXISTS "announcement_updated_at" TIMESTAMP(3);
