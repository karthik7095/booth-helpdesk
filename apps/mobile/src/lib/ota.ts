import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * Over-the-air updates. The app downloads a new JS bundle on launch by itself
 * (`checkAutomatically: ON_LOAD`); this also checks each time the app comes
 * back to the foreground, and offers a restart once an update is on the phone
 * instead of waiting for the agent to close the app completely.
 *
 * The offer is the app's own dialog (rendered by the root layout from the
 * state returned here), not the OS alert, so it matches every other prompt.
 */
export function useOtaUpdates(): {
  /** An update is downloaded and waiting for a restart. */
  updateReady: boolean;
  restart: () => void;
} {
  const { isUpdatePending } = Updates.useUpdates();
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    // Development builds and Expo Go have no update channel.
    if (__DEV__ || !Updates.isEnabled) return;

    const check = () => {
      Updates.checkForUpdateAsync()
        .then((result) => (result.isAvailable ? Updates.fetchUpdateAsync() : undefined))
        // No signal at a booth is normal; the next launch tries again.
        .catch(() => undefined);
    };

    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });

    return () => subscription.remove();
  }, []);

  const restart = useCallback(() => {
    setRestarting(true);
    Updates.reloadAsync().catch(() => setRestarting(false));
  }, []);

  // No "later": every phone must be on the same version, so the only way past
  // the offer is the restart.
  return { updateReady: isUpdatePending && !restarting, restart };
}

/**
 * What is running, for the home screen: the app version from the build plus
 * the over-the-air update on top of it, named by when it was published —
 * the one thing that changes with every `eas update`. Without an update
 * (a fresh install or a dev build) only the version shows.
 */
export function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? "dev";
  const publishedAt = Updates.isEmbeddedLaunch ? null : Updates.createdAt;

  if (!publishedAt) return `v${version}`;

  const stamp = publishedAt.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return `v${version} · update ${stamp}`;
}
