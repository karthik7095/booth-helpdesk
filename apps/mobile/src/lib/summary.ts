import type { VoterSummary } from "@voter/shared";

import * as api from "@/lib/api";
import { dropPrintsBefore, getMeta, setMeta } from "@/lib/db";
import { isOnline } from "@/lib/sync";

/**
 * The home screen's server-side counters, kept on the phone so they show at
 * once and still show with no signal. The cache is the last answer the server
 * gave; it is replaced whenever a fresh one arrives.
 */
const META_KEY = "home.summary";

export type CachedSummary = VoterSummary & { fetchedAt: string };

export async function readCachedSummary(): Promise<CachedSummary | null> {
  const raw = await getMeta(META_KEY).catch(() => null);

  try {
    return raw ? (JSON.parse(raw) as CachedSummary) : null;
  } catch {
    return null;
  }
}

/** The last admin print-count reset this phone has already applied. */
const RESET_KEY = "prints.resetAt";

/**
 * An admin's "reset print count" on the dashboard clears the server's print
 * records up to that moment. The phone keeps its own copy, which would leave
 * "Printed by you" standing and push the old prints back on the next sync,
 * so when a reset newer than the last one applied arrives, the prints from
 * before it go too. Prints made after the reset stay and sync as usual.
 */
export async function applyPrintsReset(printsResetAt: string | null): Promise<boolean> {
  if (!printsResetAt) return false;

  const applied = await getMeta(RESET_KEY).catch(() => null);

  if (applied === printsResetAt) return false;

  const resetAtMs = Date.parse(printsResetAt);

  if (Number.isNaN(resetAtMs)) return false;

  const dropped = await dropPrintsBefore(resetAtMs);
  await setMeta(RESET_KEY, printsResetAt);

  return dropped > 0;
}

/** Fetches when online and caches; returns null when offline or on failure. */
export async function refreshSummary(token: string): Promise<CachedSummary | null> {
  if (!(await isOnline())) return null;

  try {
    const summary: CachedSummary = {
      ...(await api.fetchSummary(token)),
      fetchedAt: new Date().toISOString(),
    };

    await setMeta(META_KEY, JSON.stringify(summary));
    // Done here, alongside the fetch, so every screen that refreshes the
    // summary also brings the phone's own print tally into line.
    await applyPrintsReset(summary.printsResetAt).catch(() => false);

    return summary;
  } catch {
    return null;
  }
}
