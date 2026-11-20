-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "allow_user_slip_covers" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_slip_covers" (
    "id" TEXT NOT NULL,
    "assembly_id" TEXT NOT NULL,
    "mobile_number" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_slip_covers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_slip_covers_assembly_id_mobile_number_slot_key" ON "user_slip_covers"("assembly_id", "mobile_number", "slot");

-- AddForeignKey
ALTER TABLE "user_slip_covers" ADD CONSTRAINT "user_slip_covers_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
