import type { Access } from "@voter/shared";
import * as SecureStore from "expo-secure-store";
import { Alert, AppState, InteractionManager } from "react-native";
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import * as api from "@/lib/api";
import { ensureBoothCounts } from "@/lib/booth-counts";
import { getMeta } from "@/lib/db";
import { syncIfOnline } from "@/lib/sync";
import { ensureSearchIndex } from "@/lib/search-index";
import { discardLocalRoll, readyVoterCount, ROLL_VERSION, WARD_SCOPE } from "@/lib/sync-watermelon";

/**
 * The server answers these when the PIN or its constituency has been switched
 * off. Either way the phone must not keep the roll: the agent is signed out
 * and the downloaded list removed, as if they had signed out themselves.
 */
const ACCESS_REMOVED_CODES = new Set([
  "PIN_REVOKED",
  "ASSEMBLY_INACTIVE",
  // The admin switched this user, or this phone, off.
  "USER_DEACTIVATED",
  "DEVICE_BLOCKED",
  // Removed from this constituency by an admin.
  "ACCESS_REMOVED",
]);

/** Forgets the session on the phone, and the roll with it when asked. */
async function clearStoredSession(wipeRoll: boolean) {
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  await saveOtpPending(false);
  await saveAccess(null);
  await saveName(null);

  // The downloaded roll belongs to the PIN that fetched it, so it goes too.
  // `unsafeResetDatabase` also clears Watermelon's sync bookkeeping, so the
  // next PIN starts from a clean first sync rather than a stale cursor.
  if (wipeRoll) await discardLocalRoll().catch(() => undefined);
}

/**
 * Whether the roll on the server is a different upload from the one on the
 * phone. Only answerable once both versions are known: a phone with no roll
 * has nothing to replace, and an older server sends no version at all.
 */
async function rollWasReplaced(access: Access | null): Promise<boolean> {
  if (access?.rollVersion === undefined) return false;

  const downloaded = await getMeta(ROLL_VERSION).catch(() => null);

  if (downloaded === null) return false;
  if (Number(downloaded) !== access.rollVersion) return true;

  // The admin changed which wards this user may see: the copy is the wrong
  // slice of the roll. One downloaded before wards were recorded had them all.
  const wards = (await getMeta(WARD_SCOPE).catch(() => null)) ?? "";

  return wards !== (access.wardNos ?? []).join(",");
}

const TOKEN_KEY = "voter.session.token";
/** Last known access, so an offline launch still knows the constituency and poll details. */
const ACCESS_KEY = "voter.session.access";
/** The signed-in name, so a launch can show the home screen before the server answers. */
const NAME_KEY = "voter.session.name";
/** Set while the mobile number still has to be confirmed by OTP, so an offline launch knows. */
const OTP_KEY = "voter.session.otp";

async function saveOtpPending(pending: boolean) {
  if (pending) await SecureStore.setItemAsync(OTP_KEY, "pending").catch(() => undefined);
  else await SecureStore.deleteItemAsync(OTP_KEY).catch(() => undefined);
}

async function saveName(fullName: string | null) {
  if (fullName) await SecureStore.setItemAsync(NAME_KEY, fullName).catch(() => undefined);
  else await SecureStore.deleteItemAsync(NAME_KEY).catch(() => undefined);
}

async function saveAccess(access: Access | null) {
  if (access) await SecureStore.setItemAsync(ACCESS_KEY, JSON.stringify(access)).catch(() => undefined);
  else await SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => undefined);
}

export async function loadAccess(): Promise<Access | null> {
  const raw = await SecureStore.getItemAsync(ACCESS_KEY).catch(() => null);

  try {
    return raw ? (JSON.parse(raw) as Access) : null;
  } catch {
    return null;
  }
}

type AuthState = {
  /** True until the stored session has been restored. */
  loading: boolean;
  token: string | null;
  fullName: string | null;
  /** The mobile number signed in with: the OTP screen texts it. */
  mobileNumber: string | null;
  /** Signed in, but the mobile number has not been confirmed by OTP yet. */
  otpPending: boolean;
  /** Set once a valid PIN has unlocked the session. */
  access: Access | null;
  /** Voters ready to search — 0 while a download has yet to finish. */
  localCount: number;
  /** The admin re-uploaded the roll since this phone downloaded it. */
  rollUpdate: boolean;
  /** The download screen should start on its own, after a forced replacement. */
  autoDownload: boolean;
};

type AuthContextValue = AuthState & {
  signIn: (fullName: string, mobileNumber: string) => Promise<void>;
  /** Sends the MSG91 widget's access token; the PIN screen follows. */
  confirmOtp: (accessToken: string) => Promise<void>;
  submitPin: (pin: string) => Promise<void>;
  /**
   * Signs out of the constituency: the PIN and the downloaded roll go, but the
   * name and confirmed mobile stay, so signing back in asks only for the PIN.
   * Offline, it falls back to a full sign-out, since the server still holds the PIN.
   */
  lockPin: () => Promise<void>;
  /** Forgets everything, name and mobile too: "sign in as someone else". */
  signOut: () => Promise<void>;
  refreshLocalCount: () => Promise<void>;
  /** Re-reads the session from the server: banner, feature switches, party list. */
  refreshSession: () => Promise<void>;
  /** Removes the outdated roll so the download screen can fetch the new one. */
  replaceRoll: () => Promise<void>;
  /** The download screen calls this once it has started the automatic download. */
  consumeAutoDownload: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    loading: true,
    token: null,
    fullName: null,
    mobileNumber: null,
    otpPending: false,
    access: null,
    localCount: 0,
    rollUpdate: false,
    autoDownload: false,
  });

  const refreshLocalCount = useCallback(async () => {
    const localCount = await readyVoterCount().catch(() => 0);
    setState((prev) => ({ ...prev, localCount }));
  }, []);

  /**
   * Confirms the stored session with the server and picks up any change an
   * admin made (features, party list, banner). A dead connection keeps what
   * is on the phone; a rejected session signs the agent out.
   */
  const confirmSession = useCallback(async (token: string, syncAfter = true) => {
    try {
      const session = await api.fetchSession(token);
      await saveAccess(session.access);
      await saveName(session.fullName);
      await saveOtpPending(session.otpPending);

      // Checked on every open: a re-uploaded roll must be replaced before any
      // more work is done against the outdated copy.
      const rollUpdate = await rollWasReplaced(session.access);

      setState((prev) => ({
        ...prev,
        loading: false,
        token,
        fullName: session.fullName,
        mobileNumber: session.mobileNumber,
        otpPending: session.otpPending,
        access: session.access,
        rollUpdate,
      }));

      // Anything queued while offline goes out as soon as the app opens online.
      // Not while the roll is outdated, though: the server would refuse it.
      // The count is re-read afterwards, since a sync can also discover a
      // replaced roll and discard the local copy.
      if (syncAfter && !rollUpdate) void syncIfOnline(token).then(() => refreshLocalCount());
    } catch (caught) {
      // A dead connection must not sign the agent out of an offline-capable app.
      const offline = caught instanceof api.ApiError && caught.status === 0;

      if (offline) {
        const [access, otp] = await Promise.all([
          loadAccess(),
          SecureStore.getItemAsync(OTP_KEY).catch(() => null),
        ]);

        setState((prev) => ({ ...prev, loading: false, token, access, otpPending: otp === "pending" }));
        return;
      }

      // A PIN or constituency switched off by the admin: the roll goes with
      // the session, and the agent is told why they are back at sign-in.
      const removed =
        caught instanceof api.ApiError && caught.code !== undefined && ACCESS_REMOVED_CODES.has(caught.code);

      await clearStoredSession(removed);
      setState((prev) => ({
        ...prev,
        loading: false,
        token: null,
        fullName: null,
        mobileNumber: null,
        otpPending: false,
        access: null,
        rollUpdate: false,
        ...(removed ? { localCount: 0 } : {}),
      }));

      if (removed) {
        Alert.alert(
          "Access removed",
          `${caught.message} The voter list has been removed from this phone.`,
        );
      }
    }
  }, [refreshLocalCount]);

  /** The "Voter list updated" dialog's one button. */
  const replaceRoll = useCallback(async () => {
    await discardLocalRoll();
    setState((prev) => ({ ...prev, rollUpdate: false, localCount: 0, autoDownload: true }));
  }, []);

  const consumeAutoDownload = useCallback(() => {
    setState((prev) => (prev.autoDownload ? { ...prev, autoDownload: false } : prev));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Read together: each is a separate trip to secure storage or SQLite.
      const [token, access, fullName, localCount] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY).catch(() => null),
        loadAccess(),
        SecureStore.getItemAsync(NAME_KEY).catch(() => null),
        readyVoterCount().catch(() => 0),
      ]);

      // A phone that already holds the roll builds (or confirms) the word
      // index and booth totals behind whatever screen opens; search scans and
      // booths group the roll until they are ready. Started only once the
      // first screen has settled, since each build chunk holds the JS thread.
      if (localCount > 0) {
        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => {
            ensureSearchIndex()
              .then(() => ensureBoothCounts())
              .catch((error: unknown) => {
                console.warn("local index build failed", error);
              });
          }, 1500);
        });
      }

      if (!token) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false, localCount }));
        return;
      }

      // Everything needed to work is already on the phone, so open straight
      // away and let the server check run behind it. Waiting for it first
      // left agents on a loading screen for as long as a weak signal took.
      if (access) {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false, token, fullName, access, localCount }));
        }
        void confirmSession(token);
        return;
      }

      // No PIN on record yet — the server decides which screen comes next.
      if (!cancelled) setState((prev) => ({ ...prev, localCount }));
      await confirmSession(token);
    })();

    return () => {
      cancelled = true;
    };
  }, [confirmSession]);

  const signIn = useCallback(async (fullName: string, mobileNumber: string) => {
    const result = await api.login({ fullName, mobileNumber });
    await SecureStore.setItemAsync(TOKEN_KEY, result.token);
    await saveAccess(null);
    await saveName(result.session.fullName);
    await saveOtpPending(result.requiresOtp);
    setState((prev) => ({
      ...prev,
      loading: false,
      token: result.token,
      fullName: result.session.fullName,
      mobileNumber: result.session.mobileNumber,
      otpPending: result.requiresOtp,
      access: null,
    }));
  }, []);

  const confirmOtp = useCallback(async (accessToken: string) => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);

    if (!token) {
      throw new api.ApiError("Please sign in again.", 401);
    }

    await api.confirmOtp(accessToken, token);
    await saveOtpPending(false);
    setState((prev) => ({ ...prev, otpPending: false }));
  }, []);

  const submitPin = useCallback(async (pin: string) => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);

    if (!token) {
      throw new api.ApiError("Please sign in again.", 401);
    }

    const result = await api.verifyPin(pin, token);
    // The PIN response carries a new token that grants voter access.
    await SecureStore.setItemAsync(TOKEN_KEY, result.token);
    await saveAccess(result.access);
    setState((prev) => ({ ...prev, token: result.token, access: result.access }));
  }, []);

  const lockPin = useCallback(async () => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
    const released = token
      ? await api.releasePin(token).then(
          () => true,
          () => false,
        )
      : false;

    if (!released) {
      await clearStoredSession(true);
      setState({
        loading: false,
        token: null,
        fullName: null,
        mobileNumber: null,
        otpPending: false,
        access: null,
        localCount: 0,
        rollUpdate: false,
        autoDownload: false,
      });
      return;
    }

    // The roll belongs to the PIN that fetched it; the next PIN may be another constituency's.
    await saveAccess(null);
    await discardLocalRoll().catch(() => undefined);
    setState((prev) => ({
      ...prev,
      loading: false,
      access: null,
      localCount: 0,
      rollUpdate: false,
      autoDownload: false,
    }));
  }, []);

  const signOut = useCallback(async () => {
    await clearStoredSession(true);
    setState({
      loading: false,
      token: null,
      fullName: null,
      mobileNumber: null,
      otpPending: false,
      access: null,
      localCount: 0,
      rollUpdate: false,
      autoDownload: false,
    });
  }, []);

  // Brought back from the background, the app shows whatever it had before:
  // an admin switching a feature off (enrolling, say) would not take effect
  // until the app was killed. Re-checking here picks it up on every return.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;

      void SecureStore.getItemAsync(TOKEN_KEY)
        .catch(() => null)
        .then((token) => (token ? confirmSession(token, false) : undefined));
    });

    return () => subscription.remove();
  }, [confirmSession]);

  // No sync of its own: callers run one alongside, and Watermelon refuses two at once.
  const refreshSession = useCallback(async () => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);

    if (token) await confirmSession(token, false);
  }, [confirmSession]);

  const value = useMemo(
    () => ({
      ...state,
      signIn,
      confirmOtp,
      submitPin,
      lockPin,
      signOut,
      refreshLocalCount,
      refreshSession,
      replaceRoll,
      consumeAutoDownload,
    }),
    [
      state,
      signIn,
      confirmOtp,
      submitPin,
      lockPin,
      signOut,
      refreshLocalCount,
      refreshSession,
      replaceRoll,
      consumeAutoDownload,
    ],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }

  return context;
}
