-- Election heading and polling day/hours, shown on the WhatsApp voter slip.
ALTER TABLE "assemblies" ADD COLUMN "election_title" TEXT;
ALTER TABLE "assemblies" ADD COLUMN "poll_date" DATE;
ALTER TABLE "assemblies" ADD COLUMN "poll_time" TEXT;
