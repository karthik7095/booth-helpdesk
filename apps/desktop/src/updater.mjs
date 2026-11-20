// In-app updates from the dashboard's download feed (electron-updater, generic
// provider; the feed URL is `publish` in electron-builder.yml). Windows
// downloads the new installer in the background and installs it on restart.
// macOS cannot install updates into an ad-hoc signed app, so there it only
// checks and points the user at the download page.
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;
const DOWNLOAD_PAGE = "https://voters.iramediaconcepts.com/download";
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const MAC = process.platform === "darwin";

/**
 * Start checking for updates. `send(status)` receives
 * { state: "available" | "downloading" | "ready", version, percent?, url? }.
 */
export function startUpdater(send) {
  autoUpdater.autoDownload = !MAC;
  autoUpdater.autoInstallOnAppQuit = !MAC;
  autoUpdater.logger = null;

  let version = null;
  autoUpdater.on("update-available", (info) => {
    version = info.version;
    send(MAC ? { state: "available", version, url: DOWNLOAD_PAGE } : { state: "downloading", version, percent: 0 });
  });
  autoUpdater.on("download-progress", (p) => send({ state: "downloading", version, percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => send({ state: "ready", version: info.version }));
  // Offline, or the feed is unreachable: try again at the next check.
  autoUpdater.on("error", (err) => console.error("[updater]", err?.message || err));

  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
}

/** Quit and run the downloaded installer (Windows). */
export function installUpdate() {
  autoUpdater.quitAndInstall(false, true);
}
