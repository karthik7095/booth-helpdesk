import { Q } from "@nozbe/watermelondb";

import { GENTLE_PACE, type BuildPace } from "@/lib/build-pace";
import { database, votersCollection } from "@/lib/database";

/**
 * Per-booth totals kept as a table, so the booths screen reads a few hundred
 * rows instead of grouping the whole roll on every open.
 *
 * Grouping ~300k rows takes several seconds on a field phone, and because
 * WatermelonDB's JSI mode runs SQL synchronously on the JS thread the screen
 * sat frozen for that long. Three triggers keep this table exact through
 * every write to the roll — a sync, a vote mark, an enrolment — so the read
 * is instant and never stale.
 *
 * Like the word index, it lives outside WatermelonDB's schema, is built once
 * after the roll lands (in chunks, with a yield between them), and goes with
 * the rest of the file on `unsafeResetDatabase`.
 */
// 2: the update trigger also carries a changed booth address or village; the
// rebuild picks up addresses that version 1 never refreshed.
const VERSION = "2";
const META_KEY = "booth.counts";
/**
 * Booths per build chunk; each chunk is an index range scan, not a full
 * scan, so a booth here costs about what a thousand rows cost the word index.
 */
const BOOTHS_PER_ROW_CHUNK = 1 / 100;

const IS_MALE = "CASE WHEN upper(%s) LIKE 'M%%' THEN 1 ELSE 0 END";
const IS_FEMALE = "CASE WHEN upper(%s) LIKE 'F%%' THEN 1 ELSE 0 END";
const VOTED = "CASE WHEN %s THEN 1 ELSE 0 END";

function expr(template: string, column: string): string {
  return template.replace("%s", column).replace("%%", "%");
}

/** The rows for one range of booths, straight from the roll. */
const GROUPED = `SELECT part_no,
         COUNT(*),
         SUM(${expr(VOTED, "has_voted")}),
         SUM(${expr(IS_MALE, "sex")}),
         SUM(${expr(IS_FEMALE, "sex")}),
         MAX(e_booth_address),
         MAX(e_village)
  FROM voters WHERE part_no > ? AND part_no <= ?
  GROUP BY part_no`;

export const BOOTH_COUNTS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS booth_counts (
     part_no INTEGER PRIMARY KEY,
     total INTEGER NOT NULL DEFAULT 0,
     voted INTEGER NOT NULL DEFAULT 0,
     male INTEGER NOT NULL DEFAULT 0,
     female INTEGER NOT NULL DEFAULT 0,
     booth_address TEXT,
     village TEXT
   )`,
  `CREATE TRIGGER IF NOT EXISTS booth_counts_ai AFTER INSERT ON voters BEGIN
     INSERT INTO booth_counts (part_no, total, voted, male, female, booth_address, village)
     VALUES (new.part_no, 1, ${expr(VOTED, "new.has_voted")}, ${expr(IS_MALE, "new.sex")},
             ${expr(IS_FEMALE, "new.sex")}, new.e_booth_address, new.e_village)
     ON CONFLICT(part_no) DO UPDATE SET
       total = total + 1,
       voted = voted + excluded.voted,
       male = male + excluded.male,
       female = female + excluded.female,
       booth_address = coalesce(booth_address, excluded.booth_address),
       village = coalesce(village, excluded.village);
   END`,
  `CREATE TRIGGER IF NOT EXISTS booth_counts_ad AFTER DELETE ON voters BEGIN
     UPDATE booth_counts SET
       total = total - 1,
       voted = voted - ${expr(VOTED, "old.has_voted")},
       male = male - ${expr(IS_MALE, "old.sex")},
       female = female - ${expr(IS_FEMALE, "old.sex")}
     WHERE part_no = old.part_no;
   END`,
  // A sync rewrites every column, so the trigger adds the difference rather
  // than assuming anything changed. A voter moving booths (never from the
  // app, but a corrected roll could) is handled as a delete plus an insert.
  `CREATE TRIGGER IF NOT EXISTS booth_counts_au AFTER UPDATE ON voters
   WHEN new.part_no = old.part_no BEGIN
     UPDATE booth_counts SET
       voted = voted + ${expr(VOTED, "new.has_voted")} - ${expr(VOTED, "old.has_voted")},
       male = male + ${expr(IS_MALE, "new.sex")} - ${expr(IS_MALE, "old.sex")},
       female = female + ${expr(IS_FEMALE, "new.sex")} - ${expr(IS_FEMALE, "old.sex")},
       booth_address = coalesce(new.e_booth_address, booth_address),
       village = coalesce(new.e_village, village)
     WHERE part_no = new.part_no;
   END`,
  `CREATE TRIGGER IF NOT EXISTS booth_counts_au_moved AFTER UPDATE ON voters
   WHEN new.part_no <> old.part_no BEGIN
     UPDATE booth_counts SET
       total = total - 1,
       voted = voted - ${expr(VOTED, "old.has_voted")},
       male = male - ${expr(IS_MALE, "old.sex")},
       female = female - ${expr(IS_FEMALE, "old.sex")}
     WHERE part_no = old.part_no;
     INSERT INTO booth_counts (part_no, total, voted, male, female, booth_address, village)
     VALUES (new.part_no, 1, ${expr(VOTED, "new.has_voted")}, ${expr(IS_MALE, "new.sex")},
             ${expr(IS_FEMALE, "new.sex")}, new.e_booth_address, new.e_village)
     ON CONFLICT(part_no) DO UPDATE SET
       total = total + 1,
       voted = voted + excluded.voted,
       male = male + excluded.male,
       female = female + excluded.female;
   END`,
];

/** One chunk of the full build: booths in (?, ?], replacing whatever is there. */
export const BOOTH_COUNTS_BUILD_CHUNK = `INSERT OR REPLACE INTO booth_counts
  (part_no, total, voted, male, female, booth_address, village) ${GROUPED}`;

let ready = false;
let building: Promise<void> | null = null;
let generation = 0;

export function boothCountsReady(): boolean {
  return ready;
}

/** Call after `unsafeResetDatabase`: the table went with the rest of the file. */
export function invalidateBoothCounts(): void {
  ready = false;
  building = null;
  generation += 1;
}

async function execute(sqls: [string, (string | number)[]][]): Promise<void> {
  await database.adapter.unsafeExecute({ sqls });
}

async function raw<T>(sql: string): Promise<T[]> {
  const query = votersCollection.query(Q.unsafeSqlQuery(sql));

  return (await database.adapter.unsafeQueryRaw(query.serialize())) as T[];
}

/** Makes sure the table exists and is complete; a single meta read once built. */
export async function ensureBoothCounts(
  onProgress?: (fraction: number) => void,
  pace: BuildPace = GENTLE_PACE,
): Promise<void> {
  if (ready) return;
  if (building) return building;

  const CHUNK = Math.max(5, Math.round(pace.chunk * BOOTHS_PER_ROW_CHUNK));
  const YIELD_MS = pace.yieldMs;

  const mine = generation;
  let run: Promise<void> | null = null;
  run = (async () => {
    try {
      const current = (await database.localStorage.get<string>(META_KEY)) === VERSION;

      // `CREATE TRIGGER IF NOT EXISTS` keeps an older trigger, so a new
      // version drops it first.
      if (!current) await execute([["DROP TRIGGER IF EXISTS booth_counts_au", []]]);

      await execute(BOOTH_COUNTS_SCHEMA.map((sql) => [sql, []]));

      if (current) {
        if (mine === generation) ready = true;
        return;
      }

      await execute([["DELETE FROM booth_counts", []]]);

      const [range] = await raw<{ lo: number; hi: number }>(
        "SELECT coalesce(min(part_no), 0) AS lo, coalesce(max(part_no), 0) AS hi FROM voters",
      );
      const lo = Number(range?.lo ?? 0);
      const hi = Number(range?.hi ?? 0);

      for (let from = lo - 1; from < hi; from += CHUNK) {
        if (mine !== generation) return;

        await execute([[BOOTH_COUNTS_BUILD_CHUNK, [from, from + CHUNK]]]);
        onProgress?.(Math.min(1, (from + CHUNK - lo + 1) / Math.max(1, hi - lo + 1)));

        // Let the UI breathe: JSI runs each chunk synchronously on the JS thread.
        await new Promise((resolve) => setTimeout(resolve, YIELD_MS));
      }

      if (mine !== generation) return;

      await database.localStorage.set(META_KEY, VERSION);
      ready = true;
    } finally {
      if (building === run) building = null;
    }
  })();

  building = run;

  return run;
}
