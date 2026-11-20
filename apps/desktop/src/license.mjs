// Device licensing: the app is bound to this computer's hardware id and asks the
// API, on every launch and before every conversion, whether it may run.
import { execSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { dirname, join } from "node:path";
import { app, safeStorage } from "electron";

const require = createRequire(import.meta.url);
const { machineIdSync } = require("node-machine-id");

const PRODUCTION_API = "https://voters.iramediaconcepts.com/backend";
const LOCAL_API = "http://localhost:4100";
// A packaged app always talks to production. In development (`npm run desktop`)
// it uses the local API, or ROLL_API_URL when set.
export const API_URL = (app.isPackaged ? PRODUCTION_API : process.env.ROLL_API_URL || LOCAL_API).replace(/\/$/, "");
const TIMEOUT_MS = 12_000;

// Public half of the server's licence signing key (LICENSE_SIGNING_KEY on the API).
const LICENSE_PUBLIC_KEY = createPublicKey({
  key: Buffer.from("MCowBQYDK2VwAyEAObPeSS7qWaU4X2lYoPZ/0qcf7oihn4n7TkJCnzHRHhw=", "base64"),
  format: "der",
  type: "spki",
});

/** True when `lease` was signed by our server, for this computer, and has not expired. */
export function verifyLease(lease, fp) {
  try {
    if (!lease?.data || !lease?.sig) return false;
    const data = Buffer.from(lease.data, "base64url");
    if (!verify(null, data, LICENSE_PUBLIC_KEY, Buffer.from(lease.sig, "base64url"))) return false;
    const claim = JSON.parse(data.toString("utf8"));
    return claim.fingerprint === fp && typeof claim.exp === "number" && claim.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

/** sha256 of the hardware id; stable across reinstalls, different on another machine. */
export function fingerprint() {
  return createHash("sha256").update(`voter-roll-converter:${machineIdSync(true)}`).digest("hex");
}

/** The computer's friendly name (System Settings name on macOS), falling back to the hostname. */
function computerName() {
  try {
    if (process.platform === "darwin") return execSync("scutil --get ComputerName", { encoding: "utf8", timeout: 3000 }).trim();
    if (process.platform === "win32" && process.env.COMPUTERNAME) return process.env.COMPUTERNAME;
  } catch {
    // fall through
  }
  return os.hostname().replace(/\.local$/, "");
}

export function deviceInfo() {
  return {
    name: `${computerName()} (${os.userInfo().username})`.slice(0, 120),
    platform: process.platform,
    osVersion: `${os.type()} ${os.release()}`,
    appVersion: app.getVersion(),
  };
}

const tokenFile = () => join(app.getPath("userData"), "license.bin");

function readToken() {
  try {
    const raw = readFileSync(tokenFile());
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
  } catch {
    return null;
  }
}
function writeToken(token) {
  mkdirSync(dirname(tokenFile()), { recursive: true });
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, "utf8");
  writeFileSync(tokenFile(), data);
}
/**
 * Cloud mode: sends voter-box images to the server's OCR (POST /api/ocr/recognize)
 * with this computer's licence token, and returns one text per image. The
 * server only accepts activated, unblocked computers.
 * @param {Buffer[]} pngs
 * @returns {Promise<string[]>}
 */
export async function cloudOcr(pngs) {
  const token = readToken();
  if (!token) throw new Error("This computer is not activated");
  const res = await fetch(`${API_URL}/api/ocr/recognize`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ fingerprint: fingerprint(), images: pngs.map((b) => b.toString("base64")) }),
    // under the server proxy's two-minute limit, with room for a slow batch
    signal: AbortSignal.timeout(150_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.texts)) throw new Error(data.message || `server answered ${res.status}`);
  return data.texts;
}

/** Secondary-language columns: English words written in Telugu ("te") or Hindi ("hi") on the server. */
export async function cloudTransliterate(words, lang) {
  const token = readToken();
  if (!token) throw new Error("This computer is not activated");
  let res;
  try {
    res = await fetch(`${API_URL}/api/ocr/transliterate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ fingerprint: fingerprint(), lang, words }),
      // under the server proxy's two-minute limit
      signal: AbortSignal.timeout(115_000),
    });
  } catch (err) {
    // fetch's own message is just "fetch failed"; the reason is in its cause
    const cause = err?.cause?.code || err?.cause?.message;
    throw new Error(err?.name === "TimeoutError" ? "the server took too long to answer" : `could not reach the server${cause ? ` (${cause})` : ""}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(data.words)) throw new Error(data.message || `server answered ${res.status}`);
  return data.words;
}

export function clearToken() {
  if (existsSync(tokenFile())) rmSync(tokenFile());
}

async function post(path, body, token) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/**
 * @returns {Promise<{state:"ok", license:object} | {state:"blocked", reason:string, message:string} | {state:"needs-activation", message?:string} | {state:"offline", message:string}>}
 */
export async function check(stats) {
  const token = readToken();
  if (!token) return { state: "needs-activation" };
  try {
    const { status, data } = await post("/api/devices/check", { fingerprint: fingerprint(), appVersion: app.getVersion(), stats }, token);
    if (status === 200 && data.ok) {
      if (!verifyLease(data.lease, fingerprint())) {
        return { state: "offline", message: "The licence server's reply could not be verified. Try again, or contact IRA Media Concepts." };
      }
      return { state: "ok", license: data.license };
    }
    if (status === 401 || data.reason === "unknown_device" || data.reason === "fingerprint_mismatch") {
      clearToken();
      return { state: "needs-activation", message: data.message };
    }
    if (status === 403) return { state: "blocked", reason: data.reason, message: data.message };
    return { state: "offline", title: "Licence server unavailable", message: `The licence server answered with an error (${status}). Try again in a moment; if it keeps happening, contact IRA Media Concepts.` };
  } catch {
    return { state: "offline", title: "Internet connection required", message: "An internet connection is required to verify this computer's licence." };
  }
}

/** @returns {Promise<{ok:true, license:object} | {ok:false, reason?:string, message:string}>} */
export async function activate(code) {
  try {
    const { status, data } = await post("/api/devices/activate", { code, fingerprint: fingerprint(), ...deviceInfo() });
    if (status === 200 && data.token) {
      if (!verifyLease(data.lease, fingerprint())) {
        return { ok: false, message: "The licence server's reply could not be verified. Contact IRA Media Concepts." };
      }
      writeToken(data.token);
      return { ok: true, license: data.license };
    }
    if (status === 429) return { ok: false, message: "Too many attempts. Wait a few minutes and try again." };
    return { ok: false, reason: data.reason, message: data.message || "Activation failed." };
  } catch {
    return { ok: false, message: "Could not reach the licence server. Check the internet connection and try again." };
  }
}
