-- The wards an approved app user may download; empty means every ward.
ALTER TABLE "app_user_access" ADD COLUMN "ward_nos" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
