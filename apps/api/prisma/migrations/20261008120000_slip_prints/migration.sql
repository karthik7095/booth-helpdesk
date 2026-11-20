-- Every voter slip printed from the app: who printed it, which voter, and where the phone was.
-- CreateTable
CREATE TABLE "slip_prints" (
    "id" TEXT NOT NULL,
    "voter_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "assembly_id" TEXT,
    "part_no" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "place_name" TEXT,
    "printed_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slip_prints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slip_prints_voter_id_printed_at_idx" ON "slip_prints"("voter_id", "printed_at");

-- CreateIndex
CREATE INDEX "slip_prints_session_id_printed_at_idx" ON "slip_prints"("session_id", "printed_at");

-- CreateIndex
CREATE INDEX "slip_prints_assembly_id_printed_at_idx" ON "slip_prints"("assembly_id", "printed_at");

-- AddForeignKey
ALTER TABLE "slip_prints" ADD CONSTRAINT "slip_prints_voter_id_fkey" FOREIGN KEY ("voter_id") REFERENCES "voters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slip_prints" ADD CONSTRAINT "slip_prints_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "login_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slip_prints" ADD CONSTRAINT "slip_prints_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
