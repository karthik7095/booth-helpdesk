// electron-builder custom Windows signing hook (win.signtoolOptions.sign).
//
// electron-builder calls this once per file it would normally hand to
// signtool: the app exe, elevate.exe, the uninstaller and the installer.
// Which signing service is used is decided by one environment variable, so
// the same build works with any provider:
//
//   WIN_SIGN_CMD   a shell command run per file, with {file} replaced by the
//                  path. Unset: the build is left unsigned and says so once.
//
// Examples:
//   SSL.com eSigner (cloud, works from a Mac):
//     WIN_SIGN_CMD='CodeSignTool sign -username "$ESIGNER_USER" -password "$ESIGNER_PASS" \
//       -totp_secret "$ESIGNER_TOTP" -input_file_path "{file}" -override'
//   signtool with a hardware token, on a Windows machine:
//     WIN_SIGN_CMD='signtool sign /a /fd sha256 /tr http://timestamp.digicert.com /td sha256 "{file}"'
//
// Signing is checksum-safe for NSIS: the signature is appended after the
// installer data and the PE header edits fall in the first 512 bytes, which
// the NSIS integrity check skips.
const { execSync } = require("node:child_process");

let warned = false;

module.exports = async function signWindows(configuration) {
  const command = process.env.WIN_SIGN_CMD;
  if (!command) {
    if (!warned) {
      console.log("  • sign-windows: WIN_SIGN_CMD is not set, leaving Windows binaries unsigned");
      warned = true;
    }
    return;
  }
  const file = configuration.path;
  console.log(`  • sign-windows: signing ${file}`);
  execSync(command.split("{file}").join(file.replace(/"/g, '\\"')), { stdio: "inherit", shell: true });
};
