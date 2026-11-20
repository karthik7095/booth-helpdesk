-- Banner image shown on the app's home screen, stored on the API's disk.
ALTER TABLE "assemblies" ADD COLUMN "banner_path" TEXT;
ALTER TABLE "assemblies" ADD COLUMN "banner_mime" TEXT;
ALTER TABLE "assemblies" ADD COLUMN "banner_updated_at" TIMESTAMP(3);
