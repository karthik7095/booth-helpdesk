import "server-only";

import { cookies } from "next/headers";

/**
 * The MSG91 OTP widget, called from the server the way the phone app calls it
 * (apps/mobile/src/lib/otp.ts): it texts the code and checks it, and a correct
 * code gives an access token the API confirms with its own secret key. The
 * widget id and token are public by design (the phone app ships them); these
 * defaults are the ones the app build uses, overridable per environment.
 */
const BASE = "https://control.msg91.com/api/v5/widget";
const widgetId = process.env.MSG91_WIDGET_ID ?? "366a6e6a3059373336313133";
const tokenAuth = process.env.MSG91_TOKEN_AUTH ?? "581545TRrxqlHo6acf554dP1";

/** MSG91's request id between texting the code and checking it. */
const REQUEST_COOKIE = "voter_app_otp";

type WidgetAnswer = { type?: string; message?: unknown; "access-token"?: unknown };

async function post(path: string, body: Record<string, unknown>): Promise<WidgetAnswer> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId, tokenAuth, ...body }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    return ((await res.json().catch(() => ({}))) ?? {}) as WidgetAnswer;
  } catch {
    throw new Error("Could not reach the SMS service. Please try again.");
  }
}

const failure = (answer: WidgetAnswer, fallback: string) =>
  new Error(typeof answer.message === "string" && answer.message ? answer.message : fallback);

async function remember(reqId: string) {
  const store = await cookies();
  store.set(REQUEST_COOKIE, reqId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    path: "/web",
    maxAge: 15 * 60,
  });
}

/**
 * Texts a code to the number. Returns the widget's access token straight away
 * when MSG91 verifies the number without a code, otherwise null.
 */
export async function sendOtp(mobileNumber: string): Promise<string | null> {
  const answer = await post("/sendOtpMobile", { identifier: `91${mobileNumber}` });

  if (answer.type !== "success") throw failure(answer, "Could not send the OTP. Please try again.");
  if (typeof answer["access-token"] === "string") return answer["access-token"];

  await remember(String(answer.message ?? ""));
  return null;
}

/** Sends the code again on the request already open. */
export async function resendOtp(): Promise<void> {
  const reqId = (await cookies()).get(REQUEST_COOKIE)?.value;

  if (!reqId) throw new Error("The code has expired. Please sign in again.");

  const answer = await post("/retryOtp", { reqId, retryChannel: 11 });
  if (answer.type !== "success") throw failure(answer, "Could not resend the OTP. Please wait a minute and try again.");
}

/** Checks the code; a correct one returns the widget's access token. */
export async function verifyOtp(otp: string): Promise<string> {
  const store = await cookies();
  const reqId = store.get(REQUEST_COOKIE)?.value;

  if (!reqId) throw new Error("The code has expired. Please sign in again.");

  const answer = await post("/verifyOtp", { reqId, otp });
  if (answer.type !== "success" || typeof answer.message !== "string") {
    throw failure(answer, "That OTP is not correct. Please check and try again.");
  }

  store.delete({ name: REQUEST_COOKIE, path: "/web" });
  return answer.message;
}
