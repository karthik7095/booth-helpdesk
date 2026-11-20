import { Q } from "@nozbe/watermelondb";

import { GENTLE_PACE, type BuildPace } from "@/lib/build-pace";
import { database, votersCollection } from "@/lib/database";

/**
 * The word index behind quick search: one row per (word, voter) taken from
 * `search_text`, keyed so that a typed prefix is an index range seek.
 *
 * A `LIKE '%word%'` has to read every row — ~300k here, a third of a second
 * on a laptop and several times that on a field phone, all of it on the JS
 * thread because WatermelonDB's JSI mode runs SQL synchronously. With this
 * table a rare name is found in a few milliseconds; common prefixes are left
 * to the scan, which stops early for them (see `indexedMatch` in db.ts).
 *
 * FTS5 would be the textbook answer, but WatermelonDB compiles the SQLite
 * amalgamation on Android without `SQLITE_ENABLE_FTS5`, so this is plain
 * tables and triggers that every build has.
 *
 * The table lives outside WatermelonDB's schema. Three triggers keep it in
 * step with every write — Watermelon's own sync, a field edit, an enrolment —
 * so nothing in JS has to remember to update it. `unsafeResetDatabase` wipes
 * the file, table and triggers included, which is why `invalidate` exists.
 *
 * Built in chunks with a yield between them, so the ~10 s it takes on a phone
 * does not freeze the app: on an upgrade it runs behind the home screen, and
 * search simply scans until it is ready.
 */
const INDEX_VERSION = "1";
const META_KEY = "search.index";

/**
 * Splits `search_text` on single spaces (it is already lower-cased and
 * collapsed) into (word, voter_rowid) rows. `seed` selects the rows to split:
 * a trigger's `new` row, or a rowid range of the voters table.
 */
function splitWords(seed: string): string {
  return `WITH RECURSIVE split(voter_rowid, word, rest) AS (
    ${seed}
    UNION ALL
    SELECT voter_rowid, substr(rest, 1, instr(rest, ' ') - 1), substr(rest, instr(rest, ' ') + 1)
    FROM split WHERE rest <> ''
  ) SELECT word, voter_rowid FROM split WHERE word <> ''`;
}

const INSERT_WORDS = "INSERT OR IGNORE INTO voter_words(word, voter_rowid)";
const NEW_ROW = "SELECT new.rowid, '', coalesce(new.search_text, '') || ' '";

/** Exported so the SQL can be exercised against a plain SQLite file. */
export const SEARCH_INDEX_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS voter_words (
     word TEXT NOT NULL,
     voter_rowid INTEGER NOT NULL,
     PRIMARY KEY (word, voter_rowid)
   ) WITHOUT ROWID`,
  // The update and delete triggers find a voter's words by rowid. The primary
  // key leads with the word, so without this each of them read the whole
  // table: a 25k-row sync took many minutes, frozen, and never finished.
  "CREATE INDEX IF NOT EXISTS voter_words_rowid ON voter_words (voter_rowid)",
  `CREATE TRIGGER IF NOT EXISTS voter_words_ai AFTER INSERT ON voters BEGIN
     ${INSERT_WORDS} ${splitWords(NEW_ROW)};
   END`,
  `CREATE TRIGGER IF NOT EXISTS voter_words_au AFTER UPDATE OF search_text ON voters BEGIN
     DELETE FROM voter_words WHERE voter_rowid = old.rowid;
     ${INSERT_WORDS} ${splitWords(NEW_ROW)};
   END`,
  `CREATE TRIGGER IF NOT EXISTS voter_words_ad AFTER DELETE ON voters BEGIN
     DELETE FROM voter_words WHERE voter_rowid = old.rowid;
   END`,
];

/** One chunk of the full build: the voters whose rowid is in (?, ?]. */
export const SEARCH_INDEX_BUILD_CHUNK =`${INSERT_WORDS} ${splitWords(
  "SELECT rowid, '', coalesce(search_text, '') || ' ' FROM voters WHERE rowid > ? AND rowid <= ?",
)}`;

/**
 * The upper bound of the index range for a prefix: U+10FFFF is the highest
 * code point, so every word starting with the prefix sorts below it.
 */
export function prefixRange(prefix: string): [string, string] {
  return [prefix, `${prefix}\u{10FFFF}`];
}

/**
 * Creates the table and its rowid index if missing — before a sync, which may
 * rewrite thousands of voters through the triggers before the full build has
 * run. Idempotent and quick once the index exists.
 */
export async function ensureWordLookupIndex(): Promise<void> {
  await database.adapter.unsafeExecute({
    sqls: SEARCH_INDEX_SCHEMA.slice(0, 2).map((sql) => [sql, []]),
  });
}

let ready = false;
let building: Promise<void> | null = null;
/** Bumped by `invalidateSearchIndex` so a build already running stops quietly. */
let generation = 0;

/** Whether quick search may use the index. False while it is being built. */
export function searchIndexReady(): boolean {
  return ready;
}

/**
 * Call after `unsafeResetDatabase`: the table went with the rest of the file.
 * A build in progress (an upgrade's background build, say, when the agent
 * re-downloads) is abandoned; the next `ensureSearchIndex` starts afresh.
 */
export function invalidateSearchIndex(): void {
  ready = false;
  building = null;
  generation += 1;
}

async function execute(sqls: [string, (string | number)[]][]): Promise<void> {
  await database.adapter.unsafeExecute({ sqls });
}

async function maxRowid(): Promise<number> {
  const query = votersCollection.query(
    Q.unsafeSqlQuery("SELECT coalesce(max(rowid), 0) AS max FROM voters"),
  );
  const rows = (await database.adapter.unsafeQueryRaw(query.serialize())) as { max: number }[];

  return Number(rows[0]?.max ?? 0);
}

/**
 * Makes sure the index exists and is complete. Cheap once built: a single
 * read of the version stamp. The triggers are created before the build, so a
 * sync landing mid-way is indexed too (the insert ignores duplicates).
 */
export async function ensureSearchIndex(
  onProgress?: (fraction: number) => void,
  pace: BuildPace = GENTLE_PACE,
): Promise<void> {
  if (ready) return;
  if (building) return building;

  const { chunk: CHUNK, yieldMs: YIELD_MS } = pace;

  const mine = generation;
  // Declared before the body so `finally` can tell whether it is still current.
  let run: Promise<void> | null = null;
  run = (async () => {
    try {
      await execute(SEARCH_INDEX_SCHEMA.map((sql) => [sql, []]));

      if ((await database.localStorage.get<string>(META_KEY)) === INDEX_VERSION) {
        if (mine === generation) ready = true;
        return;
      }

      // A crash mid-build leaves a partial table; starting clean is the only
      // way to be sure every voter is in.
      await execute([["DELETE FROM voter_words", []]]);

      const max = await maxRowid();

      for (let from = 0; from < max; from += CHUNK) {
        // The database was reset under this build; its table is gone.
        if (mine !== generation) return;

        await execute([[SEARCH_INDEX_BUILD_CHUNK, [from, from + CHUNK]]]);
        onProgress?.(Math.min(1, (from + CHUNK) / max));

        // Let the UI breathe: JSI runs each chunk synchronously on the JS thread.
        await new Promise((resolve) => setTimeout(resolve, YIELD_MS));
      }

      if (mine !== generation) return;

      await database.localStorage.set(META_KEY, INDEX_VERSION);
      ready = true;
    } finally {
      if (building === run) building = null;
    }
  })();

  building = run;

  return run;
}
