import { gzipSync } from 'node:zlib';

/**
 * Pre-gzipped seed pages, so a first download costs the server one build per
 * page per roll version rather than one per phone. On polling-day eve every
 * agent downloads the same ~300k rows within the same hour; without this the
 * shared two-core box spends half a minute of CPU per phone producing pages
 * that are byte-for-byte identical.
 *
 * Correctness rests on the snapshot time. Every page of a roll version
 * carries the time the first page of that version was built, and the phone
 * stores that as its sync watermark — so a vote marked after the snapshot is
 * fetched by the first delta sync whether or not the cached page already had
 * it. Pages built later are merely fresher than the watermark, never staler.
 *
 * Cleared when the roll version moves on (a re-upload), when an import adds
 * rows, and after a fixed age so a long-lived snapshot does not make the
 * first delta sync pull half the roll.
 */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Rolls kept at once; the oldest goes when a new one arrives. ~35 MB each. */
const MAX_ROLLS = 3;
const GZIP_LEVEL = 4;

export type CachedPage = { gz: Buffer; builtAt: number };

type RollCache = {
  rollVersion: number;
  limit: number;
  snapshotAt: number;
  pages: Map<string, Promise<CachedPage>>;
};

class SeedPageCache {
  private rolls = new Map<number, RollCache>();

  /**
   * The page for `cursor`, from the cache or built with `build` (which is
   * given the snapshot time to stamp into the page). Concurrent requests for
   * the same page share one build.
   */
  async get(
    assemblyNo: number,
    rollVersion: number,
    limit: number,
    cursor: string,
    build: (snapshotAt: number) => Promise<unknown>,
  ): Promise<CachedPage> {
    let roll = this.rolls.get(assemblyNo);
    const stale =
      !roll ||
      roll.rollVersion !== rollVersion ||
      roll.limit !== limit ||
      Date.now() - roll.snapshotAt > MAX_AGE_MS;

    if (stale) {
      roll = { rollVersion, limit, snapshotAt: Date.now(), pages: new Map() };
      this.rolls.delete(assemblyNo);
      this.rolls.set(assemblyNo, roll);

      while (this.rolls.size > MAX_ROLLS) {
        const oldest = this.rolls.keys().next().value;
        if (oldest !== undefined) this.rolls.delete(oldest);
      }
    }

    const current = roll!;
    let page = current.pages.get(cursor);

    if (!page) {
      page = build(current.snapshotAt).then((body) => ({
        gz: gzipSync(JSON.stringify(body), { level: GZIP_LEVEL }),
        builtAt: Date.now(),
      }));

      current.pages.set(cursor, page);
      // A failed build must not poison the slot; the next request retries it.
      page.catch(() => current.pages.delete(cursor));
    }

    return page;
  }

  /** Forgets a roll's pages: after an import, a wipe, or anything else that adds or removes voters. */
  invalidate(assemblyNo: number): void {
    this.rolls.delete(assemblyNo);
  }
}

export const seedPageCache = new SeedPageCache();
