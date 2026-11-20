-- Party loyalty choices are set per constituency, and the label is stored.
-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "party_options" TEXT[] DEFAULT ARRAY['Lotus', 'Hand']::TEXT[];

-- Values recorded before this used lowercase keys.
UPDATE "voters" SET "party_loyalty" = 'Lotus' WHERE "party_loyalty" = 'lotus';
UPDATE "voters" SET "party_loyalty" = 'Hand' WHERE "party_loyalty" = 'hand';
