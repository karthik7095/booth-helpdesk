-- Columns the electoral roll carries that were previously dropped on import:
-- SECTION_NO, Elector_Last_Name (+ Telugu), RELATION_TYPE and STREET_AREA.
ALTER TABLE "voters" ADD COLUMN "section_no" INTEGER;
ALTER TABLE "voters" ADD COLUMN "e_last_name" TEXT;
ALTER TABLE "voters" ADD COLUMN "l_last_name" TEXT;
ALTER TABLE "voters" ADD COLUMN "relation_type" VARCHAR(10);
ALTER TABLE "voters" ADD COLUMN "street_area" TEXT;
