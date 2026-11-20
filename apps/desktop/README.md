# @voter/desktop — Voter Roll Converter

Electron app that turns ECI electoral-roll PDFs (Marathi) into Excel voter lists using
the `@voter/roll-converter` package. All OCR runs on the machine; nothing is uploaded.

## Run in development

```
npm run roll:models   # once: downloads the Marathi + English OCR models (~8 MB)
npm run desktop
```

Drop one or more roll PDFs on the window (or choose them), optionally pick an output
folder, and press Convert. Each PDF becomes `<name>.xlsx` with four sheets:
`Meta data`, `voters`, `summary` and `review` (rows a person should check).

## Build installers

```
npm run desktop:build -- --mac     # dmg + zip in apps/desktop/dist
npm run desktop:build -- --win     # NSIS installer (.exe)
```

The Windows installer can be built on a Mac, but `sharp` ships a native binary per
platform and npm only installs the one for the current machine. Before a Windows
build, switch the installed binary, build, then switch back:

```
npm install --os=win32 --cpu=x64
cd apps/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win --x64 && cd ../..
npm install
node apps/desktop/scripts/verify-nsis.mjs "apps/desktop/dist/Voter Roll Converter Setup <version>.exe"
```

The last line checks the installer and its embedded uninstaller the way NSIS does at
launch. An installer cross-built on a Mac can carry an uninstaller with a wrong
checksum (electron-builder issue #10258), which installs fine but then fails every
uninstall and upgrade with "Installer integrity check has failed". Keeping
`nsis.installerIcon` and `nsis.uninstallerIcon` on the same `build/icon.ico` avoids
it; the script is the guard. On a PC that already has such a build, uninstall it with
`"%LOCALAPPDATA%\Programs\Voter Roll Converter\Uninstall Voter Roll Converter.exe" /NCRC`.

Then stage the installers for the dashboard's download page (served locally at
http://localhost:3000/download by `npm run web`):

```
npm run desktop:stage     # copies dist/*.dmg and dist/*.exe to apps/web/public/downloads + manifest.json
```

The OCR models from `packages/roll-converter/tessdata` are bundled as extra resources,
so the installed app works offline. Run `npm run roll:models` before building.

For a quick unsigned local build (no Apple signing identity involved):

```
cd apps/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir
```

The app lands in `apps/desktop/dist/mac-arm64/`. A signed, notarised build for
distribution needs a Developer ID certificate in the keychain and the usual
`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` variables.

### Signing

**Windows.** An unsigned installer makes SmartScreen say "Windows protected your PC"
and shows an "Unknown publisher" prompt. Signing needs a code signing certificate issued
to IRA Media Concepts by a certificate authority (Sectigo, SSL.com, Certum, GlobalSign,
DigiCert; Microsoft's Azure Trusted Signing is not offered in India). Since 2023 these
certificates live on a hardware token or in the CA's cloud signing service, never in a
file, so pick a provider with a cloud signer that runs on a Mac (SSL.com eSigner,
Certum SimplySign) unless the Windows builds move to a Windows machine. The build is
already wired: every Windows binary (app, elevate helper, uninstaller, installer) goes
through `scripts/sign-windows.cjs`, which runs the command in `WIN_SIGN_CMD` with
`{file}` replaced, and does nothing when it is unset. Set `publisherName` in
`electron-builder.yml` to the certificate's exact CN. Even signed, SmartScreen may
warn for the first downloads until the publisher has built reputation; that is normal
and fades as signed copies are installed.

**macOS.**

- **No certificate (current):** `scripts/adhoc-sign.cjs` ad-hoc signs the whole bundle
  after packaging. A downloaded copy then opens after the user allows it once in
  System Settings > Privacy & Security > "Open Anyway" (macOS otherwise reports an
  unsigned bundle as "damaged"). On a Mac you control, `xattr -d com.apple.quarantine
  "/Applications/Voter Roll Converter.app"` has the same effect.
- **Developer ID + notarisation (recommended for clients):** create a "Developer ID
  Application" certificate in the Apple Developer account and install it in the
  keychain; electron-builder picks it up automatically (drop
  `CSC_IDENTITY_AUTO_DISCOVERY=false`), signs with the hardened runtime and the
  entitlements in `build/`, and the ad-hoc hook steps aside. For notarisation add
  `mac.notarize: true` to `electron-builder.yml` and export `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` before building. Notarised builds
  open on any Mac with no prompt.

A packaged build can be checked headlessly:

```
ROLL_CONVERT=/path/roll.pdf "dist/mac-arm64/Voter Roll Converter.app/Contents/MacOS/Voter Roll Converter"
```

## Checks

```
npm run roll:test                                   # converter unit tests
npx electron apps/desktop/src/smoke.mjs roll.pdf    # headless end-to-end conversion in Electron
ROLL_SCREENSHOT=/tmp/app.png npm run desktop        # renders the window to a PNG and quits
```

## Layout

- `src/main.mjs` — window, file dialogs, runs the conversion and streams progress.
- `src/preload.cjs` — the small bridge the page is allowed to call.
- `src/renderer/` — the page (plain HTML/CSS/JS, no bundler).
- `electron-builder.yml` — packaging; native modules (sharp) and the Tesseract worker
  files are unpacked from the asar archive.
- `build/icon.png` — the app icon (IRA Media Concepts mark on a white rounded plate);
  electron-builder derives the macOS `.icns` from it, and in development it is set on
  the window and the Dock. Regenerate from the wordmark with
  `node apps/desktop/scripts/make-icon.mjs apps/mobile/assets/IMC_Logo_Transparent.png apps/desktop/build/icon.png`,
  then `node apps/desktop/scripts/make-ico.mjs apps/desktop/build/icon.png apps/desktop/build/icon.ico`
  for the Windows `.ico` (app, installer and uninstaller all use it; see above).

Note for the main process: Electron defers the `ready` event until the ESM entry module
has finished evaluating, so never top-level `await app.whenReady()`.

## Licensing

The app only runs on an activated computer, and it verifies the licence with the
API on every launch, before every conversion, and every ten minutes while open.
There is no offline mode: without a connection to the licence server the app shows
"Internet connection required" and stays locked.

- Codes are issued on the dashboard's **Desktop app** page (super admin), each with a
  number of computers it may activate and an optional expiry. Disabling or deleting a
  code locks out every computer that used it; a single computer can be blocked or
  removed there too.
- The computer is identified by a sha256 of its hardware id (`node-machine-id`), so
  copying the installer, or the app's data folder, to another machine does not carry
  the licence across. The device token lives in the OS keychain-backed `safeStorage`.
- API: `POST /api/devices/activate` (code + fingerprint → token) and
  `POST /api/devices/check` (bearer token + fingerprint → ok / reason). Admin CRUD under
  `/api/admin/activation-codes` and `/api/admin/devices`.
- The server the app talks to is `https://voters.iramediaconcepts.com/backend`; override with
  `ROLL_API_URL` (development only, e.g. `ROLL_API_URL=http://localhost:4100`).
- Development-only hooks (`ROLL_SCREENSHOT`, `ROLL_DEMO`, `ROLL_CONVERT`,
  `ROLL_HISTORY_FILE`, `ROLL_ACTIVATE_CODE`) are ignored in packaged builds.
