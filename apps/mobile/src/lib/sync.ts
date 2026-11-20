import * as Network from "expo-network";

import { getPendingCounts } from "@/lib/db";
import { sync } from "@/lib/sync-watermelon";

export type SyncOutcome = {
  pushedEdits: number;
  pushedEnrollments: number;
  pushedPrints: number;
  failed: { ref: string; message: string }[];
};

export async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return false;
  }
}

/** The sync in flight, if any. WatermelonDB refuses to run two at once. */
let inFlight: Promise<unknown> | null = null;

/**
 * One round trip: everything queued on the phone goes up, everything changed
 * on the server since the last sync comes down. WatermelonDB decides what is
 * pending and applies both sides in a single transaction.
 *
 * Calls queue behind one another rather than failing: a vote mark and a print
 * seconds apart each ask for a sync, and the second must still run so the
 * print goes up now, not on the next manual sync.
 */
export async function pushPendingChanges(token: string): Promise<SyncOutcome> {
  const previous = inFlight;
  const run = (async () => {
    if (previous) await previous.catch(() => undefined);
    return pushNow(token);
  })();

  inFlight = run;

  try {
    return await run;
  } finally {
    if (inFlight === run) inFlight = null;
  }
}

async function pushNow(token: string): Promise<SyncOutcome> {
  const before = await getPendingCounts();

  try {
    await sync(token);
  } catch (error) {
    return {
      pushedEdits: 0,
      pushedEnrollments: 0,
      pushedPrints: 0,
      failed: [{ ref: "sync", message: error instanceof Error ? error.message : "Sync failed." }],
    };
  }

  const after = await getPendingCounts();

  return {
    pushedEdits: Math.max(0, before.edits - after.edits),
    pushedEnrollments: Math.max(0, before.enrollments - after.enrollments),
    pushedPrints: Math.max(0, before.prints - after.prints),
    failed: [],
  };
}

export async function syncIfOnline(token: string | null): Promise<SyncOutcome | null> {
  if (!token) return null;
  if (!(await isOnline())) return null;

  return pushPendingChanges(token);
}
