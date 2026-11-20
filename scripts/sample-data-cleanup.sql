-- Removes everything scripts/sample-data.sql created, on every constituency:
-- the sample prints, the voted marks the sample agents made, and the agents.
--
--   psql "$DATABASE_URL" -f scripts/sample-data-cleanup.sql
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM slip_prints WHERE id LIKE 'sample-%';
UPDATE voters SET has_voted = false, voted_at = NULL, marked_by_session_id = NULL
WHERE marked_by_session_id LIKE 'sample-agent-%';
DELETE FROM login_sessions WHERE id LIKE 'sample-agent-%';
COMMIT;
SELECT 'sample prints left' AS what, count(*) FROM slip_prints WHERE id LIKE 'sample-%'
UNION ALL SELECT 'sample agents left', count(*) FROM login_sessions WHERE id LIKE 'sample-agent-%';
