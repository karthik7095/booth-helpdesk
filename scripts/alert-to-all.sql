-- Copies the most recently sent booth-agent alert to every constituency and
-- switches it on there, as the dashboard's "Send to all constituencies" does.
-- Constituencies that already have exactly this alert are left alone, so their
-- agents are not asked to read it again.
--
--   bash scripts/prod-sql.sh run scripts/alert-to-all.sql
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE alert_source ON COMMIT DROP AS
SELECT id, assembly_no, e_assemblyname, announcement_title AS title, announcement_body AS body
FROM assemblies
WHERE announcement_enabled AND trim(coalesce(announcement_body, '')) <> ''
ORDER BY announcement_updated_at DESC NULLS LAST
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM alert_source) THEN
    RAISE EXCEPTION 'No constituency has an alert switched on with a message. Write one on the dashboard first.';
  END IF;
END $$;

SELECT assembly_no AS copied_from, e_assemblyname AS name, title, left(body, 80) AS message_start FROM alert_source;

-- Prisma reads these columns as UTC; the server's clock is IST.
UPDATE assemblies a
SET announcement_enabled = true,
    announcement_title = s.title,
    announcement_body = s.body,
    announcement_updated_at = (now() AT TIME ZONE 'UTC'),
    updated_at = (now() AT TIME ZONE 'UTC')
FROM alert_source s
WHERE a.id <> s.id
  AND (NOT a.announcement_enabled
       OR a.announcement_title IS DISTINCT FROM s.title
       OR a.announcement_body IS DISTINCT FROM s.body);

SELECT assembly_no, e_assemblyname AS name, announcement_enabled AS alert_on,
       announcement_title AS title, announcement_updated_at AS sent
FROM assemblies ORDER BY assembly_no;

COMMIT;
