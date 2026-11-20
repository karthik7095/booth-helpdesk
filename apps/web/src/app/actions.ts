"use server";

import {
  type AppUserAction,
  adminLoginRequestSchema,
  createActivationCodeRequestSchema,
  createConstituencyAdminRequestSchema,
  updateActivationCodeRequestSchema,
  createPinRequestSchema,
  updatePollDetailsRequestSchema,
  type CreateConstituencyAdminRequest,
  type RollWipeImpact,
  type RollWipeResult,
  type UpdateAnnouncementRequest,
  type UpdateAppFeaturesRequest,
  type UpdateStatsVisibilityRequest,
} from "@voter/shared";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import {
  clearSessionCookie,
  requireAdmin,
  requireDeveloper,
  requireSuperAdmin,
  setSessionCookie,
} from "@/lib/session";

export type ActionState = { error?: string; message?: string };

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = adminLoginRequestSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the details you entered." };
  }

  try {
    const result = await api.login(parsed.data.email, parsed.data.password);
    await setSessionCookie(result.token);
  } catch (error) {
    return { error: messageFor(error, "Could not sign in.") };
  }

  redirect("/");
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}

/** The API generates the PIN itself; the admin only chooses its scope. */
export async function createPinAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { token } = await requireAdmin();

  const partNos = String(formData.get("partNos") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const parsed = createPinRequestSchema.safeParse({
    assemblyId: formData.get("assemblyId"),
    label: formData.get("label") || undefined,
    partNos,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the PIN details." };
  }

  try {
    const created = await api.createPin(parsed.data, token);
    revalidatePath("/pins");
    revalidatePath("/");
    return { message: created.pin };
  } catch (error) {
    return { error: messageFor(error, "Could not generate a PIN.") };
  }
}

/** Deletes a constituency and everything under it. There is no undo. */
/** Switches a constituency off (PINs stop working, phones are wiped on launch) or back on. */
export async function setAssemblyActiveAction(
  assemblyId: string,
  isActive: boolean,
): Promise<ActionState> {
  const { token } = await requireSuperAdmin();

  try {
    await api.setAssemblyActive(assemblyId, isActive, token);
    revalidatePath(`/constituencies/${assemblyId}`, "layout");
    revalidatePath("/constituencies");
    return {
      message: isActive
        ? "Constituency is active again. Its PINs unlock the app as before."
        : "Constituency deactivated. Its PINs no longer work, and phones holding its roll are signed out the next time the app opens.",
    };
  } catch (error) {
    return { error: messageFor(error, "Could not change the constituency's status.") };
  }
}

/** What re-uploading a roll would wipe, for the confirmation dialog. */
export async function rollWipeImpactAction(
  assemblyId: string,
): Promise<{ impact?: RollWipeImpact; error?: string }> {
  const { token } = await requireSuperAdmin();

  try {
    return { impact: await api.rollWipeImpact(assemblyId, token) };
  } catch (error) {
    return { error: messageFor(error, "Could not check what a re-upload would remove.") };
  }
}

/**
 * Wipes the roll ahead of a re-upload. The rows themselves are then sent in
 * chunks through the import route handler, as for a first import.
 */
export async function wipeRollAction(
  assemblyId: string,
): Promise<{ result?: RollWipeResult; error?: string }> {
  const { token } = await requireSuperAdmin();

  try {
    const result = await api.wipeRoll(assemblyId, token);
    revalidatePath(`/constituencies/${assemblyId}`);
    revalidatePath("/constituencies");
    return { result };
  } catch (error) {
    return { error: messageFor(error, "Could not clear the existing roll.") };
  }
}

/** Election heading and polling day/hours. Blank fields clear the saved value. */
export async function updatePollDetailsAction(
  assemblyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { token } = await requireAdmin();

  const parsed = updatePollDetailsRequestSchema.safeParse({
    electionTitle: formData.get("electionTitle") ?? "",
    pollDate: formData.get("pollDate") ?? "",
    pollTime: formData.get("pollTime") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the poll details." };
  }

  try {
    await api.updatePollDetails(assemblyId, parsed.data, token);
    revalidatePath(`/constituencies/${assemblyId}`);
    return { message: "Poll details saved — the app picks them up on its next launch." };
  } catch (error) {
    return { error: messageFor(error, "Could not save the poll details.") };
  }
}

// --- desktop app licensing

export async function createActivationCodeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const expires = String(formData.get("expiresAt") ?? "").trim();
  const parsed = createActivationCodeRequestSchema.safeParse({
    label: formData.get("label"),
    maxDevices: formData.get("maxDevices") || 1,
    expiresAt: expires ? new Date(expires).toISOString() : null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  try {
    const { token } = await requireDeveloper();
    const created = await api.createActivationCode(parsed.data, token);
    revalidatePath("/devices");
    return { message: created.code };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not create the code." };
  }
}

export async function updateActivationCodeAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const expires = String(formData.get("expiresAt") ?? "").trim();
  const parsed = updateActivationCodeRequestSchema.safeParse({
    label: formData.get("label"),
    maxDevices: formData.get("maxDevices") || undefined,
    expiresAt: expires ? new Date(expires).toISOString() : null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the details." };
  try {
    const { token } = await requireDeveloper();
    await api.updateActivationCode(id, parsed.data, token);
    revalidatePath("/devices");
    return { message: "Code updated." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update the code." };
  }
}

export async function setActivationCodeActiveAction(id: string, isActive: boolean): Promise<ActionState> {
  try {
    const { token } = await requireDeveloper();
    await api.updateActivationCode(id, { isActive }, token);
    revalidatePath("/devices");
    return { message: isActive ? "Code enabled. Its computers can use the app again." : "Code disabled. Its computers are locked out." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update the code." };
  }
}

export async function deleteActivationCodeAction(id: string): Promise<ActionState> {
  try {
    const { token } = await requireDeveloper();
    await api.deleteActivationCode(id, token);
    revalidatePath("/devices");
    return { message: "Code deleted; its computers are locked out." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not delete the code." };
  }
}

export async function setDeviceStatusAction(id: string, status: "active" | "revoked"): Promise<ActionState> {
  try {
    const { token } = await requireDeveloper();
    await api.updateDevice(id, { status }, token);
    revalidatePath("/devices");
    return { message: status === "revoked" ? "Computer blocked. It locks out on its next check." : "Computer unblocked." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not update the computer." };
  }
}

export async function deleteDeviceAction(id: string): Promise<ActionState> {
  try {
    const { token } = await requireDeveloper();
    await api.deleteDevice(id, token);
    revalidatePath("/devices");
    return { message: "Computer removed; its slot on the code is free again." };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not remove the computer." };
  }
}

export async function setPinActiveAction(id: string, isActive: boolean): Promise<ActionState> {
  const { token } = await requireAdmin();

  try {
    await api.setPinActive(id, isActive, token);
    revalidatePath("/pins");
    revalidatePath("/");
    return { message: isActive ? "PIN reactivated." : "PIN deactivated." };
  } catch (error) {
    return { error: messageFor(error, "Could not update the PIN.") };
  }
}

/**
 * Switches an app user off by mobile number (signed out, cannot sign in again
 * with it or on the phones it used) or back on.
 */
export async function setAppUserActiveAction(
  mobileNumber: string,
  active: boolean,
): Promise<ActionState> {
  const { token } = await requireAdmin();

  try {
    const result = await api.setAppUserActive(mobileNumber, active, token);
    revalidatePath("/users");

    if (active) return { message: `${mobileNumber} can sign in again.` };

    return {
      message:
        result.devices > 0
          ? `${mobileNumber} deactivated and signed out on ${result.devices} phone${result.devices === 1 ? "" : "s"}.`
          : `${mobileNumber} deactivated and signed out.`,
    };
  } catch (error) {
    return { error: messageFor(error, "Could not update the app user.") };
  }
}

/**
 * Gives someone a dashboard login limited to one constituency. Called from the
 * onboarding dialog right after the constituency is saved, and from its page.
 */
export async function createConstituencyAdminAction(
  assemblyId: string,
  input: CreateConstituencyAdminRequest,
): Promise<ActionState> {
  const { token } = await requireSuperAdmin();
  const parsed = createConstituencyAdminRequestSchema.safeParse(input);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the admin details." };
  }

  try {
    const created = await api.createConstituencyAdmin(assemblyId, parsed.data, token);
    revalidatePath(`/constituencies/${assemblyId}`);
    return { message: `${created.email} can now sign in to this constituency.` };
  } catch (error) {
    return { error: messageFor(error, "Could not create the admin login.") };
  }
}

export async function setConstituencyAdminActiveAction(
  assemblyId: string,
  id: string,
  isActive: boolean,
): Promise<ActionState> {
  const { token } = await requireSuperAdmin();

  try {
    await api.updateConstituencyAdmin(id, { isActive }, token);
    revalidatePath(`/constituencies/${assemblyId}`);
    return { message: isActive ? "Login reactivated." : "Login deactivated." };
  } catch (error) {
    return { error: messageFor(error, "Could not update the login.") };
  }
}

export async function resetConstituencyAdminPasswordAction(
  id: string,
  password: string,
): Promise<ActionState> {
  const { token } = await requireSuperAdmin();

  if (password.length < 8) return { error: "Password must be at least 8 characters" };

  try {
    await api.updateConstituencyAdmin(id, { password }, token);
    return { message: "Password reset." };
  } catch (error) {
    return { error: messageFor(error, "Could not reset the password.") };
  }
}

/** Shows or hides one booth breakdown for a constituency, on the web and in the app. */
export async function updateStatsVisibilityAction(
  assemblyId: string,
  patch: UpdateStatsVisibilityRequest,
): Promise<ActionState> {
  const { token } = await requireAdmin();

  try {
    await api.updateStatsVisibility(assemblyId, patch, token);
    revalidatePath(`/constituencies/${assemblyId}`, "layout");
    return { message: "Saved — the app picks this up on its next launch." };
  } catch (error) {
    return { error: messageFor(error, "Could not save the setting.") };
  }
}

/** Turns an optional voter-screen feature in the app on or off for one constituency. */
export async function updateAppFeaturesAction(
  assemblyId: string,
  patch: UpdateAppFeaturesRequest,
): Promise<ActionState> {
  const { token } = await requireSuperAdmin();

  try {
    await api.updateAppFeatures(assemblyId, patch, token);
    revalidatePath(`/constituencies/${assemblyId}`, "layout");
    return { message: "Saved — the app picks this up on its next launch." };
  } catch (error) {
    return { error: messageFor(error, "Could not save the setting.") };
  }
}

const APP_USER_DONE: Record<AppUserAction, string> = {
  approve: "Approved — they can open the app now.",
  remove: "Removed — they are signed out and cannot sign in to this constituency.",
  allow: "Allowed again — they can ask for access with the PIN.",
  "make-admin": "Made an app admin — they can approve users from the app.",
  "unmake-admin": "No longer an app admin.",
  "set-wards": "Wards saved — their phone downloads just those voters again.",
  "make-mayor": "Made the Mayor — they manage every user and admin from the app.",
  "unmake-mayor": "No longer the Mayor (still an app admin).",
};

/** How many app users the constituency may have at once. Super admins only. */
export async function setAppUserLimitAction(assemblyId: string, limit: number): Promise<ActionState> {
  const { token } = await requireSuperAdmin();

  try {
    await api.setAppUserLimit(assemblyId, limit, token);
    revalidatePath(`/constituencies/${assemblyId}`, "layout");
    return { message: `User limit set to ${limit}.` };
  } catch (error) {
    return { error: messageFor(error, "Could not change the limit.") };
  }
}

/** Approves, removes or allows back an app user of one constituency, or makes them an app admin. */
export async function appUserAction(
  assemblyId: string,
  mobile: string,
  action: AppUserAction,
  /** With approve, make-admin and set-wards where the constituency has wards; empty for all. */
  wardNos?: number[],
): Promise<ActionState> {
  const { token } = await requireAdmin();

  try {
    await api.appUserAction(assemblyId, mobile, action, token, wardNos);
    revalidatePath(`/constituencies/${assemblyId}`, "layout");
    return { message: APP_USER_DONE[action] };
  } catch (error) {
    return { error: messageFor(error, "Could not change that user.") };
  }
}

/** Saves the booth-agent alert for one constituency, or switches it on or off. */
export async function updateAnnouncementAction(
  assemblyId: string,
  patch: UpdateAnnouncementRequest,
): Promise<ActionState> {
  const { token } = await requireAdmin();

  try {
    await api.updateAnnouncement(assemblyId, patch, token);
    revalidatePath(`/constituencies/${assemblyId}`, "layout");
    return {
      message:
        patch.enabled === false
          ? "Alert switched off — phones stop showing it on their next launch."
          : "Saved — agents see the alert the next time they open the app.",
    };
  } catch (error) {
    return { error: messageFor(error, "Could not save the alert.") };
  }
}

/** Copies this constituency's alert to every constituency and switches it on there. */
export async function applyAnnouncementToAllAction(assemblyId: string): Promise<ActionState> {
  const { token } = await requireAdmin();

  try {
    const { updated } = await api.applyAnnouncementToAll(assemblyId, token);
    revalidatePath("/constituencies", "layout");
    return {
      message:
        updated === 0
          ? "Every constituency already has this alert."
          : `Sent to ${updated} more constituenc${updated === 1 ? "y" : "ies"} — agents see it the next time they open the app.`,
    };
  } catch (error) {
    return { error: messageFor(error, "Could not send the alert to all constituencies.") };
  }
}

/** Deletes every slip print record in a constituency, so its counts start from zero. */
export async function resetPrintsAction(assemblyId: string): Promise<ActionState> {
  const { token } = await requireAdmin();

  try {
    const { deleted } = await api.resetPrints(assemblyId, token);
    revalidatePath(`/constituencies/${assemblyId}`, "layout");
    return {
      message:
        deleted === 0
          ? "There were no slip prints to clear."
          : `Cleared ${deleted.toLocaleString()} slip print${deleted === 1 ? "" : "s"}. Counts start from zero; the reset is kept in the history.`,
    };
  } catch (error) {
    return { error: messageFor(error, "Could not reset the print counts.") };
  }
}
