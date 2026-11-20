-- Municipal slip header (Mayor / Corporator) and an image above the candidates.
ALTER TABLE "assemblies" ADD COLUMN "slip_municipal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "assemblies" ADD COLUMN "slip_top_image_path" TEXT;
ALTER TABLE "assemblies" ADD COLUMN "slip_top_image_mime" TEXT;
ALTER TABLE "assemblies" ADD COLUMN "slip_top_image_updated_at" TIMESTAMP(3);
