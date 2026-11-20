-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "whatsapp_image_path" TEXT,
ADD COLUMN IF NOT EXISTS "whatsapp_image_mime" TEXT,
ADD COLUMN IF NOT EXISTS "whatsapp_image_updated_at" TIMESTAMP(3);
