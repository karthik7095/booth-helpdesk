import "server-only";

import type { Access, Session } from "@voter/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { agentApi } from "@/lib/agent-api";
import { ApiError } from "@/lib/api";

/**
 * The web app for app users (agents on an iPhone, who have no app to
 * install). Its sign-in is the app's — name and mobile, OTP, then a PIN — kept
 * in its own cookie so an admin signed in to the dashboard in the same browser
 * is unaffected.
 */
const COOKIE = "voter_app_token";
const MAX_AGE = 60 * 60 * 24 * 30;

export async function setAgentCookie(token: string) {
  const store = await cookies();

  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // As the admin cookie: plain-HTTP deployments set COOKIE_SECURE=false.
    secure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === "true"
      : process.env.NODE_ENV === "production",
    path: "/web",
    maxAge: MAX_AGE,
  });
}

export async function clearAgentCookie() {
  const store = await cookies();
  store.delete({ name: COOKIE, path: "/web" });
}

export async function getAgentToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

/** The session behind the cookie, or null when there is none or it has lapsed. */
export async function currentAgent(): Promise<{ session: Session; token: string } | null> {
  const token = await getAgentToken();

  if (!token) return null;

  try {
    return { session: await agentApi.me(token), token };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}

/** For every page past sign-in: a session with its OTP done and a PIN entered. */
export async function requireAgent(): Promise<{ session: Session; access: Access; token: string }> {
  const agent = await currentAgent();

  if (!agent) redirect("/web/login");
  if (agent.session.otpPending) redirect("/web/otp");
  if (!agent.session.access) redirect("/web/pin");

  return { session: agent.session, access: agent.session.access, token: agent.token };
}
