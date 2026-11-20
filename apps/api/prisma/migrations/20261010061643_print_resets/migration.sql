-- CreateTable
CREATE TABLE "print_resets" (
    "id" TEXT NOT NULL,
    "assembly_id" TEXT NOT NULL,
    "admin_id" TEXT,
    "admin_name" TEXT NOT NULL,
    "admin_email" TEXT NOT NULL,
    "prints" INTEGER NOT NULL,
    "voters" INTEGER NOT NULL,
    "users" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_resets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "print_resets_assembly_id_created_at_idx" ON "print_resets"("assembly_id", "created_at");

-- AddForeignKey
ALTER TABLE "print_resets" ADD CONSTRAINT "print_resets_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_resets" ADD CONSTRAINT "print_resets_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
