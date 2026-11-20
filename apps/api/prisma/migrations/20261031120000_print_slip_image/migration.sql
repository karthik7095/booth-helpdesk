-- Slips print the cover image only where an admin switches it on.
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "print_slip_image" BOOLEAN NOT NULL DEFAULT false;
