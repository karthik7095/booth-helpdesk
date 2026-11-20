import "server-only";

import type { AdminUser } from "@voter/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { api, ApiError } from "@/lib/api";

const COOKIE = "voter_admin_token";
const MAX_AGE = 60 * 60 * 24 * 7;

export async function setSessionCookie(token: string) {
  const store = await cookies();

  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // A `Secure` cookie is dropped by the browser over plain HTTP, which logs
    // the admin straight back out. Set COOKIE_SECURE=false only for an
    // http:// deployment; it must be true once the site is on HTTPS.
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function getToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

/** Server-side guard for dashboard pages and actions. */
export async function requireAdmin(): Promise<{ admin: AdminUser; token: string }> {
  const token = await getToken();

  if (!token) redirect("/login");

  try {
    return { admin: await api.me(token), token };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect("/login");
    }

    throw error;
  }
}

/** Where an admin lands: the overview, or for a constituency admin its dashboard. */
export function homeFor(): string {
  return "/";
}

/** For pages and actions that span every constituency. Others are sent home. */
export async function requireSuperAdmin(): Promise<{ admin: AdminUser; token: string }> {
  const session = await requireAdmin();

  if (session.admin.role !== "super_admin" && session.admin.role !== "developer") redirect(homeFor());

  return session;
}

/** Licence management: only the hidden developer role. Everyone else is sent home. */
export async function requireDeveloper(): Promise<{ admin: AdminUser; token: string }> {
  const session = await requireAdmin();

  if (session.admin.role !== "developer") redirect(homeFor());

  return session;
}
