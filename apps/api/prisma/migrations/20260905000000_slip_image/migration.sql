-- Cover image printed above each voter slip. Separate from the home-screen
-- banner: replaced independently and wanted as high-contrast artwork, since it
-- is dithered to one bit for a 384-dot thermal head.
ALTER TABLE "assemblies" ADD COLUMN "slip_image_path" TEXT;
ALTER TABLE "assemblies" ADD COLUMN "slip_image_mime" TEXT;
ALTER TABLE "assemblies" ADD COLUMN "slip_image_updated_at" TIMESTAMP(3);
