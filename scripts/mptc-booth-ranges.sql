-- Sabbavaram MPTC: moves voters into their polling stations by roll serial
-- number, from the handwritten ward sheet:
--
--   Ward 14  srno  7671 –  8260  -> PS 42
--   Ward 15  srno  8261 –  8850  -> PS 43
--   Ward 16  srno  8851 –  9440  -> PS 44
--   Ward 17  srno  9441 – 10030  -> PS 45
--   Ward 18  srno 10031 – 10634  -> PS 46
--
-- Sets part_no, copies the booth address from the booths table when one
-- exists for that PS, and stamps updated_at in UTC (see
-- fix-future-updated-at.sql) so phones pull the change on their next sync.
-- Aborts without changing anything if a target (part_no, srno) is already taken.
--
--   bash scripts/prod-sql.sh run scripts/mptc-booth-ranges.sql <assembly_no>
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE ps_ranges (ward int, sr_from int, sr_to int, ps int) ON COMMIT DROP;
INSERT INTO ps_ranges VALUES
  (14,  7671,  8260, 42),
  (15,  8261,  8850, 43),
  (16,  8851,  9440, 44),
  (17,  9441, 10030, 45),
  (18, 10031, 10634, 46);

-- Before: where these serials sit today.
SELECT r.ward, r.ps AS new_ps, v.part_no AS current_part, count(*) AS voters,
       min(v.srno) AS first_sr, max(v.srno) AS last_sr
FROM ps_ranges r
JOIN voters v ON v.assembly_no = :assembly_no AND v.srno BETWEEN r.sr_from AND r.sr_to
GROUP BY 1, 2, 3 ORDER BY 1, 3;

-- psql variables do not reach inside DO blocks; pass it as a session setting.
SELECT set_config('vars.assembly_no', :'assembly_no', true) \gset

-- Refuse if any target slot is held by a different voter (unique assembly_no, part_no, srno).
DO $$
DECLARE clashes int;
BEGIN
  SELECT count(*) INTO clashes
  FROM voters v
  JOIN ps_ranges r ON v.srno BETWEEN r.sr_from AND r.sr_to
  JOIN voters o ON o.assembly_no = v.assembly_no AND o.part_no = r.ps
               AND o.srno = v.srno AND o.id <> v.id
  WHERE v.assembly_no = current_setting('vars.assembly_no')::int;
  IF clashes > 0 THEN
    RAISE EXCEPTION '% voters would collide with existing rows in PS 42-46; nothing changed', clashes;
  END IF;
END $$;

UPDATE voters v
SET part_no = r.ps,
    e_boothaddress = COALESCE(b.address, v.e_boothaddress),
    updated_at = (now() AT TIME ZONE 'UTC')
FROM ps_ranges r
LEFT JOIN booths b ON b.part_no = r.ps
  AND b.assembly_id = (SELECT id FROM assemblies WHERE assembly_no = :assembly_no)
WHERE v.assembly_no = :assembly_no
  AND v.srno BETWEEN r.sr_from AND r.sr_to
  AND v.part_no IS DISTINCT FROM r.ps;

-- After: one row per PS.
SELECT r.ward, r.ps, count(v.id) AS voters, min(v.srno) AS first_sr, max(v.srno) AS last_sr,
       r.sr_to - r.sr_from + 1 AS expected,
       bool_or(b.id IS NOT NULL) AS booth_address_set
FROM ps_ranges r
LEFT JOIN voters v ON v.assembly_no = :assembly_no AND v.part_no = r.ps
                  AND v.srno BETWEEN r.sr_from AND r.sr_to
LEFT JOIN booths b ON b.part_no = r.ps
  AND b.assembly_id = (SELECT id FROM assemblies WHERE assembly_no = :assembly_no)
GROUP BY 1, 2, r.sr_from, r.sr_to ORDER BY 1;

COMMIT;
