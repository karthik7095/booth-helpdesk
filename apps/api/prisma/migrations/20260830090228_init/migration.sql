-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super_admin');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'super_admin',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assemblies" (
    "id" TEXT NOT NULL,
    "assembly_no" INTEGER NOT NULL,
    "e_assemblyname" TEXT NOT NULL,
    "state_code" TEXT NOT NULL DEFAULT 'S29',
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assemblies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_pins" (
    "id" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "label" TEXT,
    "assembly_id" TEXT NOT NULL,
    "part_nos" INTEGER[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_pins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_sessions" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "access_pin_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voters" (
    "id" TEXT NOT NULL,
    "assembly_no" INTEGER NOT NULL,
    "part_no" INTEGER NOT NULL,
    "srno" INTEGER NOT NULL,
    "e_first_name" TEXT,
    "e_middle_name" TEXT,
    "l_first_name" TEXT,
    "l_middle_name" TEXT,
    "sex" VARCHAR(10),
    "age" INTEGER,
    "vcardid" TEXT,
    "house_no" TEXT,
    "l_address" TEXT,
    "e_assemblyname" TEXT,
    "e_village" TEXT,
    "e_boothaddress" TEXT,
    "mobile_no1" TEXT,
    "religion" TEXT,
    "community" TEXT,
    "has_voted" BOOLEAN NOT NULL DEFAULT false,
    "voted_at" TIMESTAMP(3),
    "marked_by_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "assemblies_assembly_no_key" ON "assemblies"("assembly_no");

-- CreateIndex
CREATE UNIQUE INDEX "access_pins_pin_key" ON "access_pins"("pin");

-- CreateIndex
CREATE INDEX "access_pins_assembly_id_idx" ON "access_pins"("assembly_id");

-- CreateIndex
CREATE INDEX "login_sessions_mobile_number_idx" ON "login_sessions"("mobile_number");

-- CreateIndex
CREATE INDEX "login_sessions_access_pin_id_idx" ON "login_sessions"("access_pin_id");

-- CreateIndex
CREATE INDEX "voters_assembly_no_part_no_idx" ON "voters"("assembly_no", "part_no");

-- CreateIndex
CREATE INDEX "voters_vcardid_idx" ON "voters"("vcardid");

-- CreateIndex
CREATE INDEX "voters_e_first_name_idx" ON "voters"("e_first_name");

-- CreateIndex
CREATE INDEX "voters_house_no_idx" ON "voters"("house_no");

-- CreateIndex
CREATE UNIQUE INDEX "voters_assembly_no_part_no_srno_key" ON "voters"("assembly_no", "part_no", "srno");

-- AddForeignKey
ALTER TABLE "access_pins" ADD CONSTRAINT "access_pins_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_pins" ADD CONSTRAINT "access_pins_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_sessions" ADD CONSTRAINT "login_sessions_access_pin_id_fkey" FOREIGN KEY ("access_pin_id") REFERENCES "access_pins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voters" ADD CONSTRAINT "voters_marked_by_session_id_fkey" FOREIGN KEY ("marked_by_session_id") REFERENCES "login_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
