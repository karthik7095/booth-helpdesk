-- Constituency admins: dashboard logins limited to one constituency.
ALTER TYPE "AdminRole" ADD VALUE 'constituency_admin';

ALTER TABLE "admin_users" ADD COLUMN "assembly_id" TEXT;

CREATE INDEX "admin_users_assembly_id_idx" ON "admin_users"("assembly_id");

ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
