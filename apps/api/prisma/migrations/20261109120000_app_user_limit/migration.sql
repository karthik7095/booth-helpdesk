-- A per-constituency limit on approved app users, set by a super admin.
ALTER TABLE "assemblies" ADD COLUMN IF NOT EXISTS "max_app_users" INTEGER NOT NULL DEFAULT 5;

-- Everyone signed in right now keeps working: they are recorded as approved,
-- even past the limit. The limit then applies to new sign-ins, and admins can
-- remove extras on the App users card.
INSERT INTO "app_user_access" ("id", "assembly_id", "mobile_number", "full_name", "status", "requested_at", "decided_at", "decided_by")
SELECT DISTINCT ON (p."assembly_id", s."mobile_number")
       'gf' || md5(p."assembly_id" || '|' || s."mobile_number"),
       p."assembly_id", s."mobile_number", s."full_name", 'approved', now(), now(), 'Signed in before the user limit'
FROM "login_sessions" s
JOIN "access_pins" p ON p."id" = s."access_pin_id"
WHERE s."verified_at" IS NOT NULL
ORDER BY p."assembly_id", s."mobile_number", s."last_seen_at" DESC
ON CONFLICT ("assembly_id", "mobile_number") DO NOTHING;
