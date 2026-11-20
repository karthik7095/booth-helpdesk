import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { request } from "@/lib/api";

export type PendingApprovals = {
  pending: number;
  latest: { name: string; mobileNumber: string; requestedAt: string } | null;
};

const EVERY_MS = 30_000;

/**
 * For app admins: how many people wait for approval, polled while the screen
 * is focused and the app is in front (and at once when it comes back), so a
 * new request shows on the home screen without opening Approvals. Null for
 * everyone else, and while offline the last answer stays.
 */
export function usePendingApprovals(token: string | null, enabled: boolean): PendingApprovals | null {
  const [state, setState] = useState<PendingApprovals | null>(null);
  const focused = useRef(false);

  const check = useCallback(async () => {
    if (!token || !enabled || !focused.current) return;

    try {
      setState(await request<PendingApprovals>("/api/voters/app-users/pending", { token }));
    } catch {
      // Offline or an older server: keep what we had.
    }
  }, [token, enabled]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void check();
      const timer = setInterval(() => {
        if (AppState.currentState === "active") void check();
      }, EVERY_MS);

      return () => {
        focused.current = false;
        clearInterval(timer);
      };
    }, [check]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void check();
    });

    return () => sub.remove();
  }, [check]);

  return enabled ? state : null;
}
