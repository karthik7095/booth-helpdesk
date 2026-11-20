ALTER TABLE "login_sessions" ADD COLUMN IF NOT EXISTS "device_id" TEXT;
CREATE INDEX IF NOT EXISTS "login_sessions_device_id_idx" ON "login_sessions"("device_id");

CREATE TABLE IF NOT EXISTS "blocked_users" (
    "mobile_number" TEXT NOT NULL,
    "blocked_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blocked_users_pkey" PRIMARY KEY ("mobile_number")
);

CREATE TABLE IF NOT EXISTS "blocked_devices" (
    "device_id" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blocked_devices_pkey" PRIMARY KEY ("device_id")
);
CREATE INDEX IF NOT EXISTS "blocked_devices_mobile_number_idx" ON "blocked_devices"("mobile_number");
