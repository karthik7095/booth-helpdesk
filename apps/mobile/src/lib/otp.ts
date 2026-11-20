/**
 * MSG91 OTP widget, called over plain HTTPS (the same endpoints the official
 * SDK uses, without its native modules). The widget texts the code and checks
 * it; a correct code returns an access token that the API confirms with its
 * own secret key (POST /api/auth/otp).
 *
 * Set EXPO_PUBLIC_MSG91_WIDGET_ID and EXPO_PUBLIC_MSG91_TOKEN_AUTH (MSG91 →
 * OTP → Widget). Both are meant to live in the app; the auth key never does.
 */
const BASE = "https://control.msg91.com/api/v5/widget";
const widgetId = process.env.EXPO_PUBLIC_MSG91_WIDGET_ID ?? "";
const tokenAuth = process.env.EXPO_PUBLIC_MSG91_TOKEN_AUTH ?? "";
const TIMEOUT_MS = 20_000;

export const otpWidgetConfigured = Boolean(widgetId && tokenAuth);

type WidgetAnswer = { type?: string; message?: unknown; "access-token"?: unknown };

async function post(path: string, body: Record<string, unknown>): Promise<WidgetAnswer> {
  if (!otpWidgetConfigured) throw new Error("OTP is not set up in this version of the app. Please update the app.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ widgetId, tokenAuth, ...body }),
      signal: controller.signal,
    });
    return ((await res.json().catch(() => ({}))) ?? {}) as WidgetAnswer;
  } catch {
    throw new Error("No internet connection. Check your signal and try again.");
  } finally {
    clearTimeout(timer);
  }
}

const failure = (answer: WidgetAnswer, fallback: string) =>
  new Error(typeof answer.message === "string" && answer.message ? answer.message : fallback);

/**
 * Texts a code to the number. Usually answers with a request id for
 * verifyOtp; with invisible verification on, it may answer with the access
 * token straight away.
 */
export async function sendOtp(mobileNumber: string): Promise<{ reqId: string } | { accessToken: string }> {
  const answer = await post("/sendOtpMobile", { identifier: `91${mobileNumber}` });
  if (answer.type !== "success") throw failure(answer, "Could not send the OTP. Please try again.");
  if (typeof answer["access-token"] === "string") return { accessToken: answer["access-token"] };
  return { reqId: String(answer.message ?? "") };
}

/** Checks the code; a correct one returns the widget's access token. */
export async function verifyOtp(reqId: string, otp: string): Promise<string> {
  const answer = await post("/verifyOtp", { reqId, otp });
  if (answer.type !== "success" || typeof answer.message !== "string") {
    throw failure(answer, "That OTP is not correct. Please check and try again.");
  }
  return answer.message;
}

/** The code length set on the widget in MSG91 (4 today), or null if it cannot be read. */
export async function getOtpLength(): Promise<number | null> {
  if (!otpWidgetConfigured) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${BASE}/getWidgetProcess?widgetId=${encodeURIComponent(widgetId)}&tokenAuth=${encodeURIComponent(tokenAuth)}`;
    const answer = (await (await fetch(url, { signal: controller.signal })).json()) as { data?: { otpLength?: unknown } };
    const length = Number(answer?.data?.otpLength);
    return length >= 4 && length <= 8 ? length : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sends the code again by SMS. */
export async function retryOtp(reqId: string): Promise<void> {
  const answer = await post("/retryOtp", { reqId, retryChannel: 11 });
  if (answer.type !== "success") throw failure(answer, "Could not resend the OTP. Please try again.");
}
