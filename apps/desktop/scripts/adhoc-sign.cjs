// electron-builder afterSign hook.
//
// Without a Developer ID certificate electron-builder leaves the bundle with only
// the linker's partial signature, and a downloaded copy fails Gatekeeper with
// "is damaged and can't be opened". An ad-hoc signature over the whole bundle
// (every nested binary, then the app) turns that into the normal "unverified
// developer" prompt, which the user can allow in System Settings.
//
// When a real identity signed the app (CSC_* set / Developer ID in the keychain),
// this hook does nothing.
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) return;

  const info = execFileSync("codesign", ["-dv", appPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).toString();
  const alreadySigned = /Authority=/.test(info) && !/adhoc/.test(info);
  if (alreadySigned) {
    console.log("  • adhoc-sign: app already carries a real signature, skipping");
    return;
  }

  console.log("  • adhoc-sign: no signing identity, applying an ad-hoc signature to the whole bundle");
  // --deep signs nested frameworks/helpers; --force replaces the partial linker signature.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
};
