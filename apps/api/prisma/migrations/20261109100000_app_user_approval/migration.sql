-- App user approval per constituency: a switch, and each user's standing.
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "require_login_approval" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "app_user_access" (
    "id" TEXT NOT NULL,
    "assembly_id" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by" TEXT,

    CONSTRAINT "app_user_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "app_user_access_assembly_id_mobile_number_key" ON "app_user_access"("assembly_id", "mobile_number");
CREATE INDEX IF NOT EXISTS "app_user_access_assembly_id_status_idx" ON "app_user_access"("assembly_id", "status");

ALTER TABLE "app_user_access" ADD CONSTRAINT "app_user_access_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
