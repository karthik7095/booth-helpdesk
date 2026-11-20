// Checks a Windows installer and its embedded uninstaller the way the NSIS
// stub does at launch, so a broken uninstaller fails here instead of on a
// client's PC ("Installer integrity check has failed" on uninstall).
//
//   node apps/desktop/scripts/verify-nsis.mjs "apps/desktop/dist/Voter Roll Converter Setup 0.2.0.exe"
//
// The uninstaller is pulled out with the 7-Zip that electron-builder caches
// (set SEVEN_ZIP to another 7zz/7za binary if needed). Exits 1 on a mismatch.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";

const SIGNATURE = Buffer.from("\xef\xbe\xad\xdeNullsoftInst", "latin1");

/** Returns "ok", "skipped" (built without a checksum) or a description of the mismatch. */
function verify(file) {
  const data = readFileSync(file);
  for (let offset = 0; offset + 32 < data.length; offset += 512) {
    const flags = data.readUInt32LE(offset);
    if ((flags & ~0xf) !== 0 || !data.subarray(offset + 4, offset + 20).equals(SIGNATURE)) continue;
    if (flags & 0x2) return "skipped";
    const crcOffset = offset + data.readUInt32LE(offset + 24) - 4;
    const stored = data.readUInt32LE(crcOffset);
    const actual = crc32(data.subarray(offset === 0 ? 0 : 512, crcOffset));
    return stored === actual ? "ok" : `stored ${stored.toString(16)}, actual ${actual.toString(16)}`;
  }
  return "no NSIS header found";
}

function sevenZip() {
  if (process.env.SEVEN_ZIP) return process.env.SEVEN_ZIP;
  const cache = join(homedir(), "Library/Caches/electron-builder/7zip@1.0.0");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache)) {
      const bin = join(cache, dir, "bin/7zz");
      if (existsSync(bin)) return bin;
    }
  }
  return "7zz";
}

const installer = process.argv[2];
if (!installer) {
  console.error("usage: verify-nsis.mjs <Setup.exe>");
  process.exit(1);
}

const results = { installer: verify(installer) };
const tmp = mkdtempSync(join(tmpdir(), "nsis-verify-"));
try {
  execFileSync(sevenZip(), ["x", "-y", `-o${tmp}`, installer, "$R0/Uninstall *.exe"], { stdio: "ignore" });
  const found = readdirSync(join(tmp, "$R0")).find((f) => f.startsWith("Uninstall "));
  results.uninstaller = found ? verify(join(tmp, "$R0", found)) : "not found in installer";
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

let failed = false;
for (const [name, result] of Object.entries(results)) {
  const good = result === "ok" || result === "skipped";
  failed ||= !good;
  console.log(`${good ? "✓" : "✗"} ${name}: ${result}`);
}
process.exit(failed ? 1 : 0);
