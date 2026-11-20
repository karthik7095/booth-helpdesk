"use server";

import { loginRequestSchema, voterPatchSchema, type VoterPatch } from "@voter/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { agentApi } from "@/lib/agent-api";
import { resendOtp, sendOtp, verifyOtp } from "@/lib/agent-otp";
import { clearAgentCookie, getAgentToken, requireAgent, setAgentCookie } from "@/lib/agent-session";
import { ApiError } from "@/lib/api";

export type FormState = { error?: string; message?: string };

const messageFor = (error: unknown, fallback: string) =>
  error instanceof ApiError || error instanceof Error ? error.message : fallback;

/** Step 1: name and mobile open a session; the code is texted when OTP is on. */
export async function agentLoginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginRequestSchema.safeParse({
    fullName: formData.get("fullName"),
    mobileNumber: String(formData.get("mobileNumber") ?? "").replace(/\D/g, "").slice(-10),
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details you entered." };

  let next: "/web/otp" | "/web/pin";
  try {
    const result = await agentApi.login(parsed.data);
    await setAgentCookie(result.token);

    if (result.requiresOtp) {
      // MSG91 can confirm the number without a code; then there is nothing to type.
      const accessToken = await sendOtp(parsed.data.mobileNumber);
      if (accessToken) await agentApi.confirmOtp(accessToken, result.token);
      next = accessToken ? "/web/pin" : "/web/otp";
    } else {
      next = "/web/pin";
    }
  } catch (error) {
    return { error: messageFor(error, "Could not sign in.") };
  }

  redirect(next);
}

/** Step 1b: the texted code. */
export async function agentOtpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = String(formData.get("otp") ?? "").replace(/\D/g, "");
  const token = await getAgentToken();

  if (!token) redirect("/web/login");
  if (code.length < 4) return { error: "Enter the code sent to your mobile." };

  try {
    await agentApi.confirmOtp(await verifyOtp(code), token);
  } catch (error) {
    return { error: messageFor(error, "The OTP could not be confirmed.") };
  }

  redirect("/web/pin");
}

export async function agentResendOtpAction(): Promise<FormState> {
  try {
    await resendOtp();
    return { message: "A new code is on its way." };
  } catch (error) {
    return { error: messageFor(error, "Could not resend the OTP.") };
  }
}

/** Step 2: the PIN unlocks one constituency; its token replaces the sign-in one. */
export async function agentPinAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const pin = String(formData.get("pin") ?? "").trim().toUpperCase();
  const token = await getAgentToken();

  if (!token) redirect("/web/login");
  if (!pin) return { error: "Enter the PIN your admin gave you." };

  try {
    const result = await agentApi.pin(pin, token);
    await setAgentCookie(result.token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403 && /OTP/i.test(error.message)) redirect("/web/otp");
    return { error: messageFor(error, "That PIN could not be checked.") };
  }

  redirect("/web");
}

export async function agentLogoutAction() {
  await clearAgentCookie();
  redirect("/web/login");
}

export async function markVotedAction(id: string, hasVoted: boolean): Promise<FormState> {
  const { token } = await requireAgent();

  try {
    await agentApi.markVoted(id, hasVoted, token);
  } catch (error) {
    return { error: messageFor(error, "Could not update the voter.") };
  }

  revalidatePath(`/web/voter/${id}`);
  return { message: hasVoted ? "Marked as voted." : "Marked as not voted." };
}

/** Saves what the agent changed on the voter screen; only changed fields are sent. */
export async function saveVoterAction(id: string, patch: VoterPatch): Promise<FormState> {
  const { token } = await requireAgent();
  const parsed = voterPatchSchema.safeParse(patch);

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details you entered." };
  if (Object.keys(parsed.data).length === 0) return { message: "Nothing to save." };

  try {
    await agentApi.update(id, parsed.data, token);
  } catch (error) {
    return { error: messageFor(error, "Could not save the changes.") };
  }

  revalidatePath(`/web/voter/${id}`);
  return { message: "Saved." };
}

/** Logged when the print dialog opens: the browser cannot say whether a page came out. */
export async function recordPrintAction(voters: { id: string; partNo: number }[]): Promise<void> {
  const { token } = await requireAgent();
  await agentApi.recordPrints(voters, token).catch(() => undefined);
}
