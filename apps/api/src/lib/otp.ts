import { env } from '../env.js';

/**
 * Mobile-number OTP through the MSG91 OTP widget. The app sends and checks the
 * code with the widget (widget id + token, configured in the app) and receives
 * an access token; the API confirms that token here with the secret auth key.
 * Without MSG91_AUTH_KEY the OTP step is off and sign-in goes straight to the
 * PIN, as before.
 */
const VERIFY_URL = 'https://control.msg91.com/api/v5/widget/verifyAccessToken';
const TIMEOUT_MS = 15_000;

export function otpEnabled(): boolean {
  return Boolean(env.MSG91_AUTH_KEY);
}

export class OtpError extends Error {}

export type OtpCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether the widget's access token is genuine and was issued for this mobile
 * number. A token for any other number is refused, so a code received on one
 * phone cannot confirm a sign-in made with someone else's number.
 */
export async function verifyAccessToken(accessToken: string, mobileNumber: string): Promise<OtpCheck> {
  let res: Response;
  try {
    res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authkey: env.MSG91_AUTH_KEY, 'access-token': accessToken }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new OtpError('Could not reach the SMS service. Please try again.');
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || data.type !== 'success') {
    return { ok: false, reason: typeof data?.message === 'string' ? data.message : `status ${res.status}` };
  }

  // The verified identifier comes back as 91XXXXXXXXXX (in `message`). Every
  // number in the answer is checked, so a change in where MSG91 puts it still
  // cannot let a different number through.
  const numbers = JSON.stringify(data).match(/\d{10,13}/g) ?? [];
  if (!numbers.length) return { ok: false, reason: 'no mobile number in the verification answer' };
  if (!numbers.some((n) => n.endsWith(mobileNumber))) {
    return { ok: false, reason: 'the OTP was verified for a different mobile number' };
  }
  return { ok: true };
}
