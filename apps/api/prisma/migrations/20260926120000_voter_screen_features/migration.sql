-- Per-constituency switches for optional voter-screen features, and the
-- caste and party loyalty fields they collect.
-- AlterTable
ALTER TABLE "assemblies" ADD COLUMN     "enable_caste_entry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_party_loyalty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enable_vote_status" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "voters" ADD COLUMN     "caste" TEXT,
ADD COLUMN     "party_loyalty" TEXT;
