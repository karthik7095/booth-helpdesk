-- Per-constituency booth stat switches, and daily app usage rolled up from heartbeats.
-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "show_community_stats" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "show_gender_stats" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "show_religion_stats" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "app_usage_days" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "assembly_id" TEXT,
    "date" DATE NOT NULL,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "active_seconds" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "located_at" TIMESTAMP(3),

    CONSTRAINT "app_usage_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_usage_days_assembly_id_date_idx" ON "app_usage_days"("assembly_id", "date");

-- CreateIndex
CREATE INDEX "app_usage_days_date_idx" ON "app_usage_days"("date");

-- CreateIndex
CREATE UNIQUE INDEX "app_usage_days_session_id_date_key" ON "app_usage_days"("session_id", "date");

-- AddForeignKey
ALTER TABLE "app_usage_days" ADD CONSTRAINT "app_usage_days_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "login_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_usage_days" ADD CONSTRAINT "app_usage_days_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

