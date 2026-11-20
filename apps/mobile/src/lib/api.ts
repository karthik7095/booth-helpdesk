import {
  loginResponseSchema,
  pinResponseSchema,
  sessionSchema,
  voterSummarySchema,
  type LoginRequest,
  type LoginResponse,
  type PinResponse,
  type Session,
  type UsageHeartbeat,
  type VoterSummary,
} from "@voter/shared";

import { deviceId } from "@/lib/device-id";

/** Set EXPO_PUBLIC_API_URL in apps/mobile/.env (defaults to the local API). */
const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * React Native's fetch has no timeout of its own, so on a dropped mobile
 * connection a request can hang for minutes. Treated as offline past this.
 */
const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  let response: Response;
  const device = await deviceId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      method: options.method ?? "GET",
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(device ? { "x-device-id": device } : {}),
        // Free ngrok tunnels serve an HTML interstitial without this.
        "ngrok-skip-browser-warning": "true",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  } finally {
    clearTimeout(timer);
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    throw new ApiError(
      typeof payload?.message === "string"
        ? payload.message
        : "Something went wrong. Please try again.",
      response.status,
      typeof payload?.code === "string" ? payload.code : undefined,
    );
  }

  return payload as T;
}

/** Voters printed per booth, from every phone, by booth number. */
export async function fetchBoothPrintTotals(token: string): Promise<Map<number, number>> {
  const { booths } = await request<{ booths: Record<string, number> }>("/api/voters/prints", { token });

  return new Map(Object.entries(booths).map(([partNo, voters]) => [Number(partNo), voters]));
}

/** Times each voter of one booth has been printed, from every phone, by voter id. */
export async function fetchBoothPrints(partNo: number, token: string): Promise<Map<string, number>> {
  const { prints } = await request<{ prints: Record<string, number> }>(
    `/api/voters/booths/${partNo}/prints`,
    { token },
  );

  return new Map(Object.entries(prints));
}

/** Step 1 — open a session. The returned token cannot read voter data yet. */
export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  return loginResponseSchema.parse(
    await request<unknown>("/api/auth/login", { method: "POST", body: credentials }),
  );
}

/** Step 1b — confirm the mobile number with the MSG91 widget's access token. */
export async function confirmOtp(accessToken: string, token: string): Promise<void> {
  await request<unknown>("/api/auth/otp", { method: "POST", body: { accessToken }, token });
}

/** Step 2 — unlock the session with the booth agent's PIN. */
export async function verifyPin(pin: string, token: string): Promise<PinResponse> {
  return pinResponseSchema.parse(
    await request<unknown>("/api/auth/pin", { method: "POST", body: { pin }, token }),
  );
}

export async function fetchSession(token: string): Promise<Session> {
  return sessionSchema.parse(await request<unknown>("/api/auth/me", { token }));
}

/** The PIN's turnout and slip counters across every phone working its booths. */
export async function fetchSummary(token: string): Promise<VoterSummary> {
  return voterSummarySchema.parse(await request<unknown>("/api/voters/summary", { token }));
}

/** Reports time spent in the app (and, if allowed, where) since the last call. */
export async function sendHeartbeat(body: UsageHeartbeat, token: string): Promise<void> {
  await request<unknown>("/api/usage/heartbeat", { method: "POST", body, token });
}

/** Drops the PIN from the session; name and mobile stay signed in. */
export async function releasePin(token: string): Promise<void> {
  await request<unknown>("/api/auth/pin/release", { method: "POST", token });
}
