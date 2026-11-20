-- Demo activity for one constituency: 40% of the roll marked as voted, and
-- slips printed for ~12% of voters by three sample agents at three spots in
-- the constituency. Run with psql against the API's database:
--
--   psql "$DATABASE_URL" -v assembly_no=60 -f scripts/sample-data.sql
--
-- It RESETS every voted mark and every slip print on that roll first, so do
-- not run it on a constituency that has real field activity. Undo with
-- scripts/sample-data-cleanup.sql. Everything it creates is marked "sample":
-- the agents' names end in "(sample)", their mobiles start 99999001, and the
-- print ids start with "sample-".
\set ON_ERROR_STOP on
\set QUIET on
SELECT id AS aid, e_assemblyname AS aname FROM assemblies WHERE assembly_no = :assembly_no \gset
SELECT id AS pid, pin FROM access_pins WHERE assembly_id = :'aid' AND is_active ORDER BY created_at LIMIT 1 \gset
\set QUIET off
\echo Target: :aname (assembly :assembly_no), agents on PIN :pin

SELECT 'before: voters' AS what, count(*) FROM voters WHERE assembly_id = :'aid'
UNION ALL SELECT 'before: voted', count(*) FROM voters WHERE assembly_id = :'aid' AND has_voted
UNION ALL SELECT 'before: prints', count(*) FROM slip_prints WHERE assembly_id = :'aid';

BEGIN;

-- Three sample agents on the constituency's PIN.
DELETE FROM login_sessions WHERE mobile_number IN ('9999900101', '9999900102', '9999900103');
INSERT INTO login_sessions (id, full_name, mobile_number, access_pin_id, verified_at, last_seen_at, created_at) VALUES
  ('sample-agent-1', 'Ravi Kumar (sample)',  '9999900101', :'pid', now() - interval '3 days', now(), now() - interval '3 days'),
  ('sample-agent-2', 'Sunitha Rao (sample)', '9999900102', :'pid', now() - interval '3 days', now(), now() - interval '3 days'),
  ('sample-agent-3', 'Imran Ali (sample)',   '9999900103', :'pid', now() - interval '3 days', now(), now() - interval '3 days');

-- A clean slate for the roll.
DELETE FROM slip_prints WHERE assembly_id = :'aid';
UPDATE voters SET has_voted = false, voted_at = NULL, marked_by_session_id = NULL
WHERE assembly_id = :'aid' AND has_voted;

-- 40% voted during today's polling hours, marked by the agent for the booth.
UPDATE voters SET
  has_voted = true,
  voted_at = date_trunc('day', now()) + interval '7 hours' + (random() * interval '9 hours'),
  marked_by_session_id = (ARRAY['sample-agent-1', 'sample-agent-2', 'sample-agent-3'])[(part_no % 3) + 1]
WHERE assembly_id = :'aid' AND random() < 0.40;

-- Slips for ~12% of voters over the last three days, at three spots
-- (Khairatabad, Banjara Hills, Somajiguda) with ~150 m of scatter. Two thirds
-- of those printed went on to vote, so the cross-filters tell a story.
INSERT INTO slip_prints (id, voter_id, session_id, assembly_id, part_no, method, latitude, longitude, accuracy, printed_at, received_at)
SELECT 'sample-' || v.id,
       v.id,
       (ARRAY['sample-agent-1', 'sample-agent-2', 'sample-agent-3'])[(v.part_no % 3) + 1],
       v.assembly_id,
       v.part_no,
       CASE WHEN random() < 0.9 THEN 'printer' ELSE 'dialog' END,
       (ARRAY[17.4075, 17.4156, 17.4239])[(v.part_no % 3) + 1] + (random() - 0.5) * 0.0027,
       (ARRAY[78.4615, 78.4347, 78.4583])[(v.part_no % 3) + 1] + (random() - 0.5) * 0.0027,
       8 + random() * 25,
       now() - (random() * interval '3 days'),
       now()
FROM voters v
WHERE v.assembly_id = :'aid'
  AND random() < CASE WHEN v.has_voted THEN 0.20 ELSE 0.0667 END;

COMMIT;

SELECT 'after: voters' AS what, count(*) FROM voters WHERE assembly_id = :'aid'
UNION ALL SELECT 'after: voted', count(*) FROM voters WHERE assembly_id = :'aid' AND has_voted
UNION ALL SELECT 'after: prints', count(*) FROM slip_prints WHERE assembly_id = :'aid'
UNION ALL SELECT 'after: printed and voted', count(*)
  FROM slip_prints p JOIN voters v ON v.id = p.voter_id
  WHERE p.assembly_id = :'aid' AND v.has_voted;
