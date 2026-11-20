// Desktop app installers. `npm run desktop:stage` copies them into apps/web/downloads
// (outside public/, so only files named in the manifest are ever served) with a
// manifest.json; the /download page and the /api/downloads route serve them to
// anyone, since the app is licensed per computer with an activation code.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type DownloadPlatform = "mac" | "win" | "android";

export type DownloadFile = {
  file: string;
  size: number;
  sha256?: string;
  arch?: string;
};

export type DownloadManifest = {
  version: string;
  publishedAt: string;
  files: Partial<Record<DownloadPlatform, DownloadFile>>;
};

/**
 * The staged folder: next to the app in development, under apps/web in the standalone build.
 * The turbopackIgnore hints keep Next from tracing the installers (~300 MB) into the
 * standalone build; the deploy script uploads them separately.
 */
export function downloadsDir(): string {
  const candidates = [
    join(/*turbopackIgnore: true*/ process.cwd(), "downloads"),
    join(/*turbopackIgnore: true*/ process.cwd(), "apps", "web", "downloads"),
  ];
  return candidates.find((d) => existsSync(d)) ?? candidates[0];
}

export async function getDownloadManifest(): Promise<DownloadManifest | null> {
  try {
    const data = JSON.parse(
      await readFile(join(/*turbopackIgnore: true*/ downloadsDir(), "manifest.json"), "utf8"),
    ) as DownloadManifest;
    if (!data?.version || !data.files) return null;
    return data;
  } catch {
    return null;
  }
}

/** Absolute path of a staged installer, or null if it is not in the manifest. */
export async function downloadPath(file: string): Promise<string | null> {
  const name = basename(file);
  const manifest = await getDownloadManifest();
  const known = manifest && Object.values(manifest.files).some((f) => f?.file === name);
  if (!known) return null;
  const path = join(/*turbopackIgnore: true*/ downloadsDir(), name);
  return existsSync(/*turbopackIgnore: true*/ path) ? path : null;
}

export function downloadUrl(file: DownloadFile) {
  return `/api/downloads/${encodeURIComponent(file.file)}`;
}

export function formatSize(bytes: number) {
  if (!bytes) return "";
  const mb = bytes / 1_000_000;
  return mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${Math.round(mb)} MB`;
}

export function formatDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
