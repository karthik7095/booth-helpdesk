-- Bulk updates run by hand stamped updated_at with now(), which this server
-- (TimeZone Asia/Kolkata) writes as IST into a column Prisma reads as UTC.
-- The rows then looked 5.5 h in the future, so every phone sync pulled them
-- again. Brings them back to the real time once; phones pull them one last time.
--
--   bash scripts/prod-sql.sh run scripts/fix-future-updated-at.sql
\set ON_ERROR_STOP on
BEGIN;
UPDATE voters SET updated_at = (now() AT TIME ZONE 'UTC')
WHERE updated_at > (now() AT TIME ZONE 'UTC');
SELECT assembly_no, max(updated_at) AS last_update,
       count(*) FILTER (WHERE updated_at > (now() AT TIME ZONE 'UTC')) AS still_future
FROM voters GROUP BY 1 ORDER BY 1;
COMMIT;
