// Stages the desktop installers for the dashboard's /download page.
//
//   npm run desktop:stage
//
// Copies the newest *.dmg (macOS) and *.exe (Windows) from apps/desktop/dist into
// apps/web/public/downloads/ and writes manifest.json (version, size, sha256).
// The web app serves that folder at /downloads/, so the page works locally with
// `npm run web`. The folder is gitignored.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps/desktop/dist");
// Outside public/: the files are served only to the developer role by /api/downloads.
const target = join(root, "apps/web/downloads");
const version = JSON.parse(readFileSync(join(root, "apps/desktop/package.json"), "utf8")).version;

function newest(ext) {
  if (!existsSync(dist)) return null;
  const files = readdirSync(dist)
    .filter((f) => f.toLowerCase().endsWith(ext))
    .map((f) => ({ f, t: statSync(join(dist, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return files[0]?.f ?? null;
}

const picks = { mac: newest(".dmg"), win: newest(".exe") };
if (!picks.mac && !picks.win) {
  console.error(`No installers in ${dist}. Build first: npm run desktop:build -- --mac (or --win)`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
const manifestPath = join(target, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { files: {} };
manifest.files ??= {};

for (const [platform, file] of Object.entries(picks)) {
  if (!file) continue;
  const src = join(dist, file);
  copyFileSync(src, join(target, file));
  const buf = readFileSync(src);
  manifest.files[platform] = {
    file,
    size: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
    arch: platform === "mac" ? (file.includes("x64") ? "x64" : "arm64") : "x64",
  };
  console.log(`${platform}: ${file} (${Math.round(buf.length / 1e6)} MB)`);
}

// In-app update feed (apps/desktop/src/updater.mjs): electron-builder's latest*.yml
// plus the files they name. Listing them in the manifest lets /api/downloads serve
// them; the /download page only shows the mac and win entries.
for (const [platform, yml] of [["win", "latest.yml"], ["mac", "latest-mac.yml"]]) {
  if (!picks[platform] || !existsSync(join(dist, yml))) continue;
  for (const key of Object.keys(manifest.files)) if (key.startsWith(`${platform}-update-`)) delete manifest.files[key];
  const named = [...readFileSync(join(dist, yml), "utf8").matchAll(/^\s*(?:-\s*)?url:\s*(.+?)\s*$/gm)].map((m) => m[1]);
  // macOS only shows a notice (the app is ad-hoc signed and cannot self-install), so it needs just the yml.
  const files = platform === "win" ? named.flatMap((f) => [f, `${f}.blockmap`]) : [];
  const feed = [yml, ...new Set(files)].filter((f) => existsSync(join(dist, f)));
  feed.forEach((file, i) => {
    copyFileSync(join(dist, file), join(target, file));
    manifest.files[`${platform}-update-${i}`] = { file };
  });
  console.log(`${platform} update feed: ${feed.join(", ")}`);
}
manifest.version = version;
manifest.publishedAt = new Date().toISOString();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${manifestPath}\nOpen http://localhost:3000/download with the web app running.`);
