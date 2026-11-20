import { Q } from "@nozbe/watermelondb";
import { synchronize } from "@nozbe/watermelondb/sync";
import { setLastPulledAt } from "@nozbe/watermelondb/sync/impl";
import type { DirtyRaw } from "@nozbe/watermelondb/RawRecord";

import { database, votersCollection } from "@/lib/database";
import { countVoters, getMeta, removeMeta, setMeta } from "@/lib/db";
import { ensureBoothCounts, invalidateBoothCounts } from "@/lib/booth-counts";
import { FAST_PACE } from "@/lib/build-pace";
import {
  ensureSearchIndex,
  ensureWordLookupIndex,
  invalidateSearchIndex,
} from "@/lib/search-index";
import { SEARCH_INDEXES, voterSchema } from "@/model/schema";
import { deleteVoterPhotos } from "@/lib/voter-photos";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "ngrok-skip-browser-warning": "true",
});

/** A seed page is large and the phone may be on 2G; a delta sync is small. */
const SEED_TIMEOUT_MS = 60_000;
/**
 * Rows per seed page. Smaller than the server's 10k ceiling: about 450 KB
 * gzipped each, so one transfer is short enough to survive a weak signal and
 * a cut-off page costs little to fetch again.
 */
const SEED_PAGE_SIZE = 4000;
const SYNC_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

/**
 * A delta is held in memory until every page is in, unlike the seed, which
 * writes page by page. Past this many rows the delta is a re-import in all but
 * name, and the seed's streaming path is the safe way to take it.
 */
const MAX_PULL_ROWS = 60_000;

/**
 * React Native sets OkHttp's connect/read/write timeouts to 0 and expects the
 * JS layer to impose one, so a bare `fetch` whose connection is dropped mid-
 * flight — a carrier NAT expiring, a cell handoff, a tower switch, all routine
 * on rural mobile data — returns a promise that never settles. The download
 * then sits at whatever percentage it reached with no error to show, which is
 * indistinguishable from a hang. Every request gets a deadline, and transient
 * failures are retried with backoff rather than surfaced to the agent.
 */
async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      // 4xx will say the same thing next time; 5xx and timeouts are worth another go.
      if (response.status < 500) return response;

      lastError = new Error(`Server error (${response.status}).`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }

  throw describe(lastError);
}

/** An answer that stopped short: the body ended before its JSON did. */
class IncompleteResponse extends Error {
  constructor() {
    super("The server's answer was cut off before it finished.");
    this.name = "IncompleteResponse";
  }
}

/** The agent-facing reason a request gave up, from the last failure seen. */
function describe(lastError: unknown): Error {
  if (lastError instanceof Error && lastError.name === "AbortError") {
    return new Error(
      "The connection stalled. Move to somewhere with better signal and try again — the download continues from where it stopped.",
    );
  }

  if (lastError instanceof IncompleteResponse) {
    return new Error(
      "The download keeps getting cut off. Move to somewhere with better signal and try again — it continues from where it stopped.",
    );
  }

  return new Error("Could not reach the server. Check your connection and try again.");
}

/**
 * `request`, plus reading the body as JSON — and retrying when that fails.
 *
 * On a weak mobile signal a response can arrive with its headers intact and
 * its body cut short, which reaches the app as "JSON parse error: unexpected
 * end of input" and used to abandon the whole download. A cut-off body is as
 * transient as a dropped connection, so it gets the same retries and backoff.
 * A 4xx is returned to the caller to turn into its own message.
 */
async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: true; body: T } | { ok: false; status: number; message: string }> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response;

    try {
      response = await request(url, init, timeoutMs);
    } catch (error) {
      // `request` has already retried its own failures; one more round here
      // would only keep an agent waiting.
      throw error;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      let message = detail;

      try {
        const parsed = JSON.parse(detail) as { message?: unknown };
        if (typeof parsed.message === "string") message = parsed.message;
      } catch {
        // Not JSON — use the text as it came.
      }

      return { ok: false, status: response.status, message };
    }

    try {
      return { ok: true, body: (await response.json()) as T };
    } catch {
      lastError = new IncompleteResponse();
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
  }

  throw describe(lastError);
}

/**
 * The server's roll version at the time of the download. The admin can wipe
 * and re-upload a roll; every row then has a new id, and merging that into the
 * copy on the phone would leave the old rows beside the new. A pull that
 * reports a different version means this copy is of a roll that no longer
 * exists, and the only honest move is to download again.
 */
export const ROLL_VERSION = "roll.version";

/**
 * The wards the download covers ("" for all), as the server reported them. An
 * admin changing this user's wards makes the copy the wrong slice of the roll,
 * so a different scope is treated like a replaced roll.
 */
export const WARD_SCOPE = "roll.wards";

/** Set by `pullChanges` when the server's roll is not the one on the phone. */
let rollReplaced = false;
/** Set with it when the reason is a change of wards, not a re-upload. */
let wardsChanged = false;

/** Throws away the local copy; `readyVoterCount` then sends the app to the download screen. */
export async function discardLocalRoll(): Promise<void> {
  await database.write(async () => {
    await database.unsafeResetDatabase();
  });
  invalidateSearchIndex();
  invalidateBoothCounts();
  // The photos belong to the roll (and the wards) that was downloaded.
  deleteVoterPhotos();
}

/**
 * Two-way sync. WatermelonDB tracks which records changed locally, asks the
 * server for everything newer than `lastPulledAt`, and applies both sides in
 * one transaction — so an interrupted sync leaves the database consistent.
 */
export async function sync(token: string): Promise<void> {
  rollReplaced = false;
  wardsChanged = false;

  try {
    await synchronizeWithServer(token);
  } catch (error) {
    if (!rollReplaced) throw error;

    // Whatever was queued was against voters that no longer exist on the
    // server; the pull runs before the push, so none of it was sent.
    await discardLocalRoll();

    if (wardsChanged) {
      throw new Error("Your admin changed the wards you can see. Download the voter list again to continue.");
    }

    throw new Error(
      "The voter list for this constituency was uploaded again by the admin. Download it again to continue.",
    );
  }
}

async function synchronizeWithServer(token: string): Promise<void> {
  // Phones built before this index existed get it here, ahead of the pull it speeds up.
  await ensureWordLookupIndex();

  await synchronize({
    database,

    pullChanges: async ({ lastPulledAt }) => {
      type TableChanges = {
        created: DirtyRaw[];
        updated: DirtyRaw[];
        deleted: string[];
      };
      type PullPage = {
        changes: { voters: TableChanges; slip_prints?: TableChanges };
        timestamp: number;
        nextCursor?: string | null;
        rollVersion?: number;
        wardScope?: string;
      };

      const fetchPage = async (cursor: string | null): Promise<PullPage> => {
        const params = new URLSearchParams();
        if (lastPulledAt) params.set("lastPulledAt", String(lastPulledAt));
        if (cursor) params.set("cursor", cursor);

        const result = await fetchJson<PullPage>(
          `${baseUrl}/api/sync/pull?${params.toString()}`,
          { headers: headers(token) },
          SYNC_TIMEOUT_MS,
        );

        if (!result.ok) {
          throw new Error(
            result.message || `Sync failed (${result.status}). Try again when you have signal.`,
          );
        }

        return result.body;
      };

      // The server pages a large delta; every page is collected before
      // Watermelon applies them in one transaction. The watermark is the first
      // page's, so anything edited mid-pull comes down next time rather than
      // being skipped.
      const first = await fetchPage(null);

      if (first.rollVersion !== undefined) {
        const known = await getMeta(ROLL_VERSION);

        if (known !== null && Number(known) !== first.rollVersion) {
          rollReplaced = true;
          throw new Error("The roll on the server has been replaced.");
        }

        // A phone seeded by a build that did not record the version adopts it now.
        if (known === null) await setMeta(ROLL_VERSION, String(first.rollVersion));
      }

      if (first.wardScope !== undefined) {
        // A copy downloaded before wards were recorded covered every ward.
        const known = (await getMeta(WARD_SCOPE)) ?? "";

        if (known !== first.wardScope) {
          rollReplaced = true;
          wardsChanged = true;
          throw new Error("Your wards have changed.");
        }
      }

      const updated = [...first.changes.voters.updated];
      let cursor = first.nextCursor ?? null;

      while (cursor) {
        if (updated.length >= MAX_PULL_ROWS) {
          throw new Error(
            "Too much of the voter list has changed to sync in place. Download the list again from the home screen.",
          );
        }

        const page = await fetchPage(cursor);
        updated.push(...page.changes.voters.updated);
        cursor = page.nextCursor ?? null;
      }

      // A big delta (an admin adding booth addresses or phone numbers to a
      // whole ward) goes straight to SQLite; Watermelon only gets the rows
      // that need its conflict handling.
      const remaining =
        updated.length > DIRECT_APPLY_ROWS ? await applyCleanRowsDirectly(updated) : updated;

      return {
        changes: {
          voters: { created: [], updated: remaining, deleted: [] },
          // Prints only go up; nothing ever comes back for them.
          slip_prints: { created: [], updated: [], deleted: [] },
        },
        timestamp: first.timestamp,
      };
    },

    pushChanges: async ({ changes, lastPulledAt }) => {
      const response = await request(
        `${baseUrl}/api/sync/push`,
        {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify({ changes, lastPulledAt }),
        },
        SYNC_TIMEOUT_MS,
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        let message = detail;

        // The API answers `{ message }`; show that rather than the raw JSON.
        try {
          const parsed = JSON.parse(detail) as { message?: unknown };
          if (typeof parsed.message === "string") message = parsed.message;
        } catch {
          // Not JSON — use the text as it came.
        }

        throw new Error(message || `Could not send your changes (${response.status}).`);
      }
    },

    // The roll is authoritative for rows the phone has not touched; a field
    // agent's own edit wins over a stale copy of the same record.
    sendCreatedAsUpdated: true,
  });
}

/**
 * Past this many rows a pulled delta is written with plain UPDATEs instead of
 * through Watermelon. Watermelon builds a JS model for every row it applies,
 * all in one go on the JS thread: 25k rows held the app frozen — taps and the
 * back button ignored — for as long as that took.
 */
const DIRECT_APPLY_ROWS = 1000;
/** Rows per write; the JS thread is handed back between them so taps get through. */
const DIRECT_APPLY_CHUNK = 400;

const toSqlValue = (value: unknown): string | number | null =>
  value === undefined || value === null
    ? null
    : typeof value === "boolean"
      ? value
        ? 1
        : 0
      : typeof value === "number" || typeof value === "string"
        ? value
        : String(value);

/**
 * Writes the pulled rows the phone holds unchanged straight to SQLite, a chunk
 * at a time, and returns the rest — rows edited on this phone and not yet
 * pushed, or not on the phone at all — for Watermelon to apply as usual.
 * The roll is authoritative for untouched rows, which is what Watermelon
 * would have done with them too. The booth-count and search-word triggers
 * fire on these UPDATEs as on Watermelon's own.
 */
async function applyCleanRowsDirectly(rows: DirtyRaw[]): Promise<DirtyRaw[]> {
  const known = new Set(Object.keys(voterSchema.tables.voters!.columns));
  const columns = Object.keys(rows[0] ?? {}).filter((column) => known.has(column));
  const update = `UPDATE voters SET ${columns.map((column) => `${column} = ?`).join(", ")}
                  WHERE id = ? AND _status = 'synced'`;
  const rest: DirtyRaw[] = [];
  // Models already in memory (a voter opened earlier) would keep showing the
  // old values, since these writes bypass Watermelon; their raw rows are
  // brought up to date in place. Internal API, hence the guarded lookup.
  const cached = (
    votersCollection as unknown as {
      _cache?: { map?: Map<string, { _raw: Record<string, unknown> }> };
    }
  )._cache?.map;

  for (let start = 0; start < rows.length; start += DIRECT_APPLY_CHUNK) {
    const chunk = rows.slice(start, start + DIRECT_APPLY_CHUNK);
    const ids = chunk.map((row) => String(row.id));
    const query = votersCollection.query(
      Q.unsafeSqlQuery(
        `SELECT id FROM voters WHERE _status = 'synced' AND id IN (${ids.map(() => "?").join(", ")})`,
        ids,
      ),
    );
    const clean = new Set(
      (
        (await database.adapter.unsafeQueryRaw(query.serialize())) as {
          id: string;
        }[]
      ).map((row) => row.id),
    );

    const sqls: [string, (string | number | null)[]][] = [];

    for (const row of chunk) {
      if (clean.has(String(row.id))) {
        sqls.push([update, [...columns.map((column) => toSqlValue(row[column])), String(row.id)]]);

        const model = cached?.get(String(row.id));
        if (model) for (const column of columns) model._raw[column] = row[column] ?? null;
      } else {
        rest.push(row);
      }
    }

    if (sqls.length > 0) await database.adapter.unsafeExecute({ sqls });

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return rest;
}

/**
 * Where an unfinished seed stopped. A first sync takes minutes on a field
 * phone and dies often — signal drops, the OS kills the app, the screen locks
 * — leaving pages already on disk. Without a record of how far it got, the
 * retry starts at page one and re-inserts ids SQLite already holds, which is
 * the `UNIQUE constraint failed: voters.id` an agent sees on the second try.
 */
const SEED_CURSOR = "seed.cursor";
const SEED_TOTAL = "seed.total";
const SEED_WATERMARK = "seed.watermark";

/** Stored as the cursor once the last page is in; no voter id is empty. */
const ALL_PAGES_FETCHED = "";

/**
 * The voters table's columns in insert order: WatermelonDB's own three, then
 * the roll's, straight from the schema so a new column needs no change here.
 */
const SEED_COLUMNS = [
  "id",
  "_status",
  "_changed",
  ...Object.keys(voterSchema.tables.voters!.columns),
];
/** SQLite allows 32,766 bound values per statement; stay well inside it. */
const ROWS_PER_INSERT = Math.floor(30_000 / SEED_COLUMNS.length);
const SEED_INSERT = `INSERT OR REPLACE INTO voters (${SEED_COLUMNS.join(", ")}) VALUES `;
const SEED_ROW = `(${SEED_COLUMNS.map(() => "?").join(", ")})`;

/**
 * Writes one seed page with a handful of multi-row INSERTs in one transaction.
 *
 * WatermelonDB's `batch` of `prepareCreateFromDirtyRaw` builds a model object
 * and a statement per voter — fine for a few hundred, but a first download is
 * ~300k of them and that overhead was most of the time a download took. These
 * rows are server-authored, already in the schema's shape and never touched
 * locally yet, so the model layer has nothing to add. `OR REPLACE` keeps a
 * resumed page idempotent, and the write bypasses no trigger: none exist until
 * the indexes are built after the last page.
 */
async function insertSeedRows(rows: DirtyRaw[]): Promise<void> {
  const sqls: [string, (string | number | null)[]][] = [];

  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    const chunk = rows.slice(start, start + ROWS_PER_INSERT);
    const args: (string | number | null)[] = [];

    for (const row of chunk) {
      args.push(String(row.id), "synced", "");

      for (const column of SEED_COLUMNS.slice(3)) {
        const value = row[column];

        if (value === undefined || value === null) args.push(null);
        else if (typeof value === "boolean") args.push(value ? 1 : 0);
        else if (typeof value === "number" || typeof value === "string") args.push(value);
        else args.push(String(value));
      }
    }

    sqls.push([SEED_INSERT + chunk.map(() => SEED_ROW).join(", "), args]);
  }

  await database.adapter.unsafeExecute({ sqls });
}

/**
 * The number of voters ready to work with. A half-downloaded roll is worse
 * than none — search silently misses people — so it counts as zero until the
 * seed finishes, which keeps the app on the download screen.
 */
export async function readyVoterCount(): Promise<number> {
  return (await getMeta(SEED_CURSOR)) === null ? countVoters() : 0;
}

/**
 * The first load of a constituency — ~296k rows for Khairatabad.
 *
 * Deliberately not WatermelonDB's `unsafeTurbo`: that mode needs the entire
 * pull response to exist as one JS string (185 MB here, ~370 MB as UTF-16)
 * before native code parses it, which no phone survives. Paging keeps peak
 * memory at one page and lets the screen show real progress.
 *
 * Resumable: calling it again after a failure picks up at the page that did
 * not land, so a dropped connection costs one page, not the whole download.
 */
export async function firstSync(
  token: string,
  onProgress?: (stage: string, progress?: { loaded: number; total: number }) => void,
): Promise<void> {
  type SeedPage = {
    rows: DirtyRaw[];
    nextCursor: string | null;
    total?: number;
    timestamp: number;
    /** Only on the first page, like `total`. */
    rollVersion?: number;
    wardScope?: string;
  };

  const fetchPage = async (cursor: string | null): Promise<SeedPage> => {
    const params = new URLSearchParams({ limit: String(SEED_PAGE_SIZE) });
    if (cursor) params.set("cursor", cursor);

    const result = await fetchJson<SeedPage>(
      `${baseUrl}/api/sync/seed?${params.toString()}`,
      { headers: headers(token) },
      SEED_TIMEOUT_MS,
    );

    if (!result.ok) {
      throw new Error(result.message || `Could not download the voter list (${result.status}).`);
    }

    return result.body;
  };

  const cursor = await getMeta(SEED_CURSOR);

  // Rows on disk with no cursor to resume from — a seed from before this
  // bookkeeping existed, or a roll being downloaded again. An empty database
  // is the only starting point that cannot collide with what is already there.
  if (cursor === null && (await countVoters()) > 0) {
    await discardLocalRoll();
  }

  let loaded = cursor === null ? 0 : await countVoters();
  let total = Number(await getMeta(SEED_TOTAL)) || 0;
  let watermark = Number(await getMeta(SEED_WATERMARK)) || Date.now();

  const report = () =>
    onProgress?.(
      total > 0
        ? `Saving voters… ${Math.round((loaded / total) * 100)}%`
        : `Saving voters… ${loaded.toLocaleString()}`,
      { loaded, total },
    );

  onProgress?.(loaded > 0 ? "Resuming download…" : "Downloading voter list…");

  // The next page is requested before the current one is written, so the
  // network wait and the SQLite writes overlap instead of alternating.
  let pending: Promise<SeedPage> | null = cursor === ALL_PAGES_FETCHED ? null : fetchPage(cursor);

  while (pending) {
    const page: SeedPage = await pending;

    if (page.total !== undefined) {
      total = page.total;
      // The watermark comes from the first page, so an edit made on the server
      // while the seed runs is not skipped by the first delta sync. Both are
      // stored because a resumed seed never sees the first page again.
      watermark = page.timestamp;
      await setMeta(SEED_TOTAL, String(total));
      await setMeta(SEED_WATERMARK, String(watermark));
      if (page.rollVersion !== undefined) await setMeta(ROLL_VERSION, String(page.rollVersion));
      if (page.wardScope !== undefined) await setMeta(WARD_SCOPE, page.wardScope);
    }

    const next = page.nextCursor ? fetchPage(page.nextCursor) : null;

    // The next page is in flight while this one is written, so a rejection can
    // land before anything awaits it. Attaching a no-op handler keeps it from
    // being reported as an unhandled rejection; the loop still sees the error
    // when it awaits `pending` on the next pass.
    next?.catch(() => undefined);

    pending = next;

    await insertSeedRows(page.rows);

    // Written only once the page's transaction has committed: a crash in
    // between resumes at the page just saved instead of skipping past it, and
    // a page is either wholly in or wholly out, never half.
    await setMeta(SEED_CURSOR, page.nextCursor ?? ALL_PAGES_FETCHED);

    loaded += page.rows.length;
    report();
  }

  // Tell the sync engine where to pick up from, so the next sync is a delta.
  await setLastPulledAt(database, watermark);

  onProgress?.("Preparing search…");

  // Build the search indexes now that every row is in — far cheaper than
  // keeping them up to date through 296k inserts.
  await database.adapter.unsafeExecute({
    sqls: SEARCH_INDEXES.map((sql) => [sql, []]),
  });

  // Then the word index and booth totals, which take long enough to deserve
  // their own progress. Nobody is using the app during a download, so they
  // run flat out rather than at the gentle pace used behind a live screen.
  await ensureSearchIndex(
    (fraction) => onProgress?.(`Preparing search… ${Math.round(fraction * 100)}%`),
    FAST_PACE,
  );
  await ensureBoothCounts(
    (fraction) => onProgress?.(`Preparing booths… ${Math.round(fraction * 100)}%`),
    FAST_PACE,
  );

  // Cleared last, so a failure anywhere above still leaves a seed to resume.
  await removeMeta(SEED_CURSOR);
  await removeMeta(SEED_TOTAL);
  await removeMeta(SEED_WATERMARK);
}
