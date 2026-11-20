-- Removes the sessions opened by scripts/load-test.mjs. They are the only
-- rows the load test creates: names end in "(sample)" and mobile numbers
-- start 99999010. Any usage heartbeats they sent go with them.
--
--   bash scripts/prod-sql.sh run scripts/load-test-cleanup.sql
\set ON_ERROR_STOP on

SELECT 'load-test sessions before' AS what, count(*)
FROM login_sessions
WHERE full_name LIKE 'Load Test % (sample)' AND mobile_number LIKE '99999010%';

BEGIN;
DELETE FROM app_usage_days
WHERE session_id IN (
  SELECT id FROM login_sessions
  WHERE full_name LIKE 'Load Test % (sample)' AND mobile_number LIKE '99999010%'
);
DELETE FROM login_sessions
WHERE full_name LIKE 'Load Test % (sample)' AND mobile_number LIKE '99999010%';
COMMIT;

SELECT 'load-test sessions after' AS what, count(*)
FROM login_sessions
WHERE full_name LIKE 'Load Test % (sample)' AND mobile_number LIKE '99999010%';
