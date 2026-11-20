-- CreateTable
CREATE TABLE "voter_photo_packs" (
    "id" TEXT NOT NULL,
    "assembly_id" TEXT NOT NULL,
    "group_kind" VARCHAR(8) NOT NULL,
    "group_no" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voter_photo_packs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voter_photo_packs_assembly_id_group_kind_group_no_key" ON "voter_photo_packs"("assembly_id", "group_kind", "group_no");

-- AddForeignKey
ALTER TABLE "voter_photo_packs" ADD CONSTRAINT "voter_photo_packs_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
