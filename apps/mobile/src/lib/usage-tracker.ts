import * as Location from "expo-location";
import { useEffect } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { sendHeartbeat } from "@/lib/api";

/** How often a heartbeat goes out while the app is on screen. */
const INTERVAL_MS = 60_000;
/** The server's per-heartbeat ceiling; anything beyond it would be rejected. */
const MAX_SECONDS = 6 * 60 * 60;
/** A GPS fix that takes longer than this is skipped for this heartbeat. */
const FIX_TIMEOUT_MS = 8_000;

type Fix = { latitude: number; longitude: number; accuracy: number | null };

let permission: Promise<boolean> | null = null;

/** Asks once per launch; a denial just means heartbeats go out without a location. */
function locationAllowed(): Promise<boolean> {
  permission ??= Location.requestForegroundPermissionsAsync()
    .then((result) => result.granted)
    .catch(() => false);

  return permission;
}

/** The phone's position now, or null without permission or a fix. Shared with slip prints. */
export async function currentFix(): Promise<Fix | null> {
  if (!(await locationAllowed())) return null;

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FIX_TIMEOUT_MS));

  const position =
    (await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null),
      timeout,
    ])) ??
    // Indoors or with GPS off, a recent cached fix is better than none.
    (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 }).catch(() => null));

  if (!position) return null;

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
  };
}

/**
 * Reports how often and how long the app is used, and where from, while a PIN
 * has unlocked it. Time is only counted while the app is in the foreground.
 * If a heartbeat fails (offline), its time and "opened" flag carry over to the
 * next one, so nothing is lost — it just lands when the phone is back online.
 */
export function useUsageTracker(token: string | null, enabled: boolean) {
  useEffect(() => {
    if (!token || !enabled) return;

    let activeSince: number | null = AppState.currentState === "active" ? Date.now() : null;
    let pendingSeconds = 0;
    let pendingOpen = activeSince !== null;
    let inFlight = false;

    /** Moves time spent on screen so far into the pending total. */
    const bank = () => {
      if (activeSince === null) return;

      const now = Date.now();
      pendingSeconds += Math.round((now - activeSince) / 1000);
      activeSince = AppState.currentState === "active" ? now : null;
    };

    const flush = async () => {
      if (inFlight) return;
      inFlight = true;
      bank();

      const seconds = Math.min(pendingSeconds, MAX_SECONDS);
      const opened = pendingOpen;
      pendingSeconds = 0;
      pendingOpen = false;

      try {
        const location = await currentFix();
        await sendHeartbeat({ opened, seconds, location }, token);
      } catch {
        pendingSeconds += seconds;
        pendingOpen ||= opened;
      } finally {
        inFlight = false;
      }
    };

    const onChange = (state: AppStateStatus) => {
      if (state === "active") {
        activeSince = Date.now();
        pendingOpen = true;
        void flush();
      } else {
        bank();
        activeSince = null;
        // Best effort — the OS may suspend the app before this finishes.
        void flush();
      }
    };

    const subscription = AppState.addEventListener("change", onChange);
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void flush();
    }, INTERVAL_MS);

    if (activeSince !== null) void flush();

    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [token, enabled]);
}
