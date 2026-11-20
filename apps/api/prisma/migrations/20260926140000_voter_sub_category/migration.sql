-- Caste is now category -> sub-category (BC-A..BC-E) -> caste, so the
-- sub-caste column becomes the sub-category.
-- AlterTable
ALTER TABLE "voters" RENAME COLUMN "sub_caste" TO "sub_category";
