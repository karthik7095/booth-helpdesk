-- The top app admin of a constituency, set on the dashboard.
ALTER TABLE "app_user_access" ADD COLUMN "is_mayor" BOOLEAN NOT NULL DEFAULT false;
