-- Place name for the last GPS fix, reverse-geocoded from OpenStreetMap.
ALTER TABLE "app_usage_days" ADD COLUMN "place_name" TEXT;
