-- Sabbavaram MPTC-4: sets WARD_NO by roll serial, using the EPIC at each end
-- of the range (same ranges as mptc-booth-ranges.sql):
--
--   Ward 14  XJV2150134 – XJV2650778
--   Ward 15  XJV1149988 – XJV2651073
--   Ward 16  XJV2651107 – XJV1383744
--   Ward 17  XJV1278747 – XJV2062503
--   Ward 18  XJV0109967 – XJV0536854
--
-- Stamps updated_at in UTC so phones pull the change on their next sync.
-- Aborts if an EPIC is missing or a range is backwards.
--
--   bash scripts/prod-sql.sh run scripts/mptc-ward-ranges.sql <assembly_no>
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE ward_epics (ward int, epic_from text, epic_to text) ON COMMIT DROP;
INSERT INTO ward_epics VALUES
  (14, 'XJV2150134', 'XJV2650778'),
  (15, 'XJV1149988', 'XJV2651073'),
  (16, 'XJV2651107', 'XJV1383744'),
  (17, 'XJV1278747', 'XJV2062503'),
  (18, 'XJV0109967', 'XJV0536854');

CREATE TEMP TABLE ward_ranges ON COMMIT DROP AS
SELECT w.ward, f.srno AS sr_from, t.srno AS sr_to
FROM ward_epics w
LEFT JOIN voters f ON f.assembly_no = :assembly_no AND f.vcardid = w.epic_from
LEFT JOIN voters t ON t.assembly_no = :assembly_no AND t.vcardid = w.epic_to;

SELECT * FROM ward_ranges ORDER BY ward;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ward_ranges WHERE sr_from IS NULL OR sr_to IS NULL OR sr_from > sr_to)
     OR (SELECT count(*) FROM ward_ranges) <> 5 THEN
    RAISE EXCEPTION 'An EPIC was not found (or matched twice) or a range is backwards; nothing changed';
  END IF;
END $$;

UPDATE voters v
SET ward_no = r.ward,
    updated_at = (now() AT TIME ZONE 'UTC')
FROM ward_ranges r
WHERE v.assembly_no = :assembly_no
  AND v.srno BETWEEN r.sr_from AND r.sr_to
  AND v.ward_no IS DISTINCT FROM r.ward;

-- After: one row per ward, plus any voter left without one.
SELECT ward_no, count(*) AS voters, min(srno) AS first_sr, max(srno) AS last_sr,
       array_agg(DISTINCT part_no) AS ps
FROM voters WHERE assembly_no = :assembly_no
GROUP BY 1 ORDER BY 1 NULLS LAST;

COMMIT;
