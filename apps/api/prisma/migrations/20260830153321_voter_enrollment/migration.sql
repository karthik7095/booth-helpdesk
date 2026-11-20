-- Voters enrolled from the mobile app rather than an imported sheet.
ALTER TABLE "voters" ADD COLUMN "is_new_enrollment" BOOLEAN NOT NULL DEFAULT false;

-- Client-generated id, so a queued enrollment synced twice lands once.
ALTER TABLE "voters" ADD COLUMN "client_ref" TEXT;
CREATE UNIQUE INDEX "voters_client_ref_key" ON "voters"("client_ref");
