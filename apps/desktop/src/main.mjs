// Electron main process: window, file dialogs, and the conversion itself.
// The OCR runs here (tesseract.js spawns its own worker processes), so the
// renderer only ever sends paths and receives progress events.
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { convert } from "@voter/roll-converter";
import { History } from "./history.mjs";
import { activate, check, clearToken, cloudOcr, cloudTransliterate } from "./license.mjs";
import { installUpdate, startUpdater } from "./updater.mjs";

// Development-only hooks (screenshots, demo state, headless conversion) are
// disabled in packaged builds so they cannot be used to bypass licensing.
const DEV = !app.isPackaged;

const here = dirname(fileURLToPath(import.meta.url));
let history = null;
const getHistory = () =>
  (history ??= new History((DEV && process.env.ROLL_HISTORY_FILE) || join(app.getPath("userData"), "history.json")));

// Bundled OCR models: resources/tessdata in a packaged app, the package's own
// tessdata folder in development (fetched with `npm run roll:models`).
process.env.TESSDATA_DIR ||= app.isPackaged
  ? join(process.resourcesPath, "tessdata")
  : join(here, "../../../packages/roll-converter/tessdata");

// electron-builder bakes build/icon.png into packaged apps; in development the
// window and Dock would otherwise show Electron's own icon.
const ICON = join(here, "../build/icon.png");

let win = null;
let running = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1140,
    height: (DEV && Number(process.env.ROLL_SHOT_HEIGHT)) || 800,
    minWidth: 900,
    minHeight: 520,
    title: "Voter Roll Converter",
    icon: ICON,
    backgroundColor: "#f4fafa",
    // No separate title bar: the window controls sit inside the page header.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 18, y: 20 },
        }
      : { titleBarStyle: "hidden", titleBarOverlay: { color: "#f4fafa", symbolColor: "#16202a", height: 40 } }),
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.loadFile(join(here, "renderer/index.html"), DEV && process.env.ROLL_DEMO ? { hash: "demo" } : undefined);
  // Headless self-check used in development: ROLL_SCREENSHOT=/path/out.png
  if (DEV && process.env.ROLL_SCREENSHOT) {
    win.webContents.once("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, 800));
      const img = await win.webContents.capturePage();
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.ROLL_SCREENSHOT, img.toPNG());
      app.quit();
    });
  }
  // Let the page add top margin in full screen, where macOS overlays its title bar.
  for (const ev of ["enter-full-screen", "leave-full-screen"]) {
    win.on(ev, () => win.webContents.send("fullscreen", ev === "enter-full-screen"));
  }
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) console.error(`[renderer] ${message}`);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  // Headless self-check of a packaged build: ROLL_CONVERT=/path/roll.pdf
  if (DEV && process.env.ROLL_CONVERT) {
    const input = process.env.ROLL_CONVERT;
    const output = process.env.ROLL_OUTPUT || join(dirname(input), basename(input, extname(input)) + ".xlsx");
    try {
      const r = await convert({ input, output, workers: 4, log: (m) => console.log(m) });
      console.log(JSON.stringify({ voters: r.summary.ExtractedVoters, expected: r.summary.ExpectedTotalVoters, review: r.summary.ReviewItems, output }));
      app.exit(0);
    } catch (err) {
      console.error(err);
      app.exit(1);
    }
    return;
  }
  if (DEV && process.env.ROLL_ACTIVATE_CODE) {
    const r = await activate(process.env.ROLL_ACTIVATE_CODE);
    console.log("[dev] activation:", JSON.stringify(r));
  }
  if (DEV && process.platform === "darwin" && existsSync(ICON)) app.dock.setIcon(ICON);
  createWindow();
  // Packaged builds only: a development run has no app-update.yml.
  if (!DEV) {
    startUpdater((status) => {
      lastUpdate = status;
      win?.webContents.send("update", status);
    });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let lastUpdate = null;
ipcMain.handle("app-version", () => app.getVersion());
ipcMain.handle("update-status", () => lastUpdate);
ipcMain.handle("update-install", () => {
  // Never restart in the middle of a conversion.
  if (running) throw new Error("Wait for the conversion to finish, then restart to update.");
  installUpdate();
});

ipcMain.handle("pick-pdfs", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Choose electoral roll PDFs",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["openFile", "multiSelections"],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle("pick-folder", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Choose where to save the Excel files",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
});

/** Ask where to save a workbook; returns the chosen path or null. */
async function askSavePath(defaultPath, title = "Save Excel file") {
  const r = await dialog.showSaveDialog(win, {
    title,
    defaultPath,
    filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (r.canceled || !r.filePath) return null;
  return r.filePath.toLowerCase().endsWith(".xlsx") ? r.filePath : `${r.filePath}.xlsx`;
}

ipcMain.handle("save-copy", async (_e, source) => {
  const dest = await askSavePath(join(app.getPath("documents"), basename(source)), "Save a copy of the Excel file");
  if (!dest) return null;
  await copyFile(source, dest);
  return dest;
});

ipcMain.handle("history-list", () => getHistory().list());
ipcMain.handle("history-remove", (_e, id) => getHistory().remove(id));
ipcMain.handle("history-clear", () => getHistory().clear());

ipcMain.handle("open-path", (_e, p) => shell.openPath(p));
ipcMain.handle("show-in-folder", (_e, p) => shell.showItemInFolder(p));
ipcMain.handle("models-present", () => {
  const dir = process.env.TESSDATA_DIR;
  return ["mar", "eng"].every((l) => existsSync(join(dir, `${l}.traineddata`)));
});

// ---------------------------------------------------------------- licensing
let licenseOk = false;
const pendingStats = { conversions: 0, voters: 0 };

/** Ask the API whether this computer may run; reports work done since the last check. */
async function verifyLicense() {
  const status = await check({ ...pendingStats });
  licenseOk = status.state === "ok";
  if (licenseOk) {
    pendingStats.conversions = 0;
    pendingStats.voters = 0;
  }
  return status;
}

ipcMain.handle("license-status", () => verifyLicense());
ipcMain.handle("license-activate", async (_e, code) => {
  const result = await activate(String(code ?? ""));
  licenseOk = result.ok;
  return result;
});
ipcMain.handle("license-reset", () => {
  clearToken();
  licenseOk = false;
});

// Re-verify while the app stays open, so a block from the dashboard takes effect soon.
setInterval(async () => {
  if (!win || win.isDestroyed()) return;
  const status = await verifyLicense().catch(() => null);
  if (status && status.state !== "ok") win.webContents.send("license", status);
}, 10 * 60 * 1000);

/**
 * Convert the given PDFs one after another. Progress is streamed to the renderer
 * as "progress" events keyed by the input path.
 */
ipcMain.handle("convert", async (event, { files, outDir, workers, askEach, languages = {}, secondary = [], mode = "local" }) => {
  const cloud = mode === "cloud";
  if (running) throw new Error("A conversion is already running");
  // Every conversion starts with a fresh licence check against the server.
  const status = await verifyLicense();
  if (status.state !== "ok") {
    event.sender.send("license", status);
    throw new Error(status.message || "This computer is not activated.");
  }
  running = true;
  const results = [];
  try {
    // Decide every output path first, so the save dialogs (when asked for) all
    // appear before the long-running OCR starts.
    const plan = [];
    for (const input of files) {
      const stem = basename(input, extname(input)).replace(/ \(\d+\)$/, "");
      // Cloud results get their own file so both readings can be compared.
      let output = join(outDir || dirname(input), `${stem}${cloud ? ".cloud" : ""}.xlsx`);
      if (askEach) {
        output = await askSavePath(output, `Save Excel for ${basename(input)}`);
        if (!output) {
          results.push({ input, output: null, ok: false, skipped: true, error: "Skipped: no save location chosen" });
          event.sender.send("progress", { input, output: null, stage: "skipped", message: "Skipped" });
          continue;
        }
      }
      plan.push({ input, output });
    }

    for (const { input, output } of plan) {
      const send = (payload) => event.sender.send("progress", { input, output, ...payload });
      const started = Date.now();
      try {
        const r = await convert({
          input,
          output,
          workers: Number(workers) || 4,
          lang: languages[input] || "auto",
          remoteOcr: cloud ? cloudOcr : null,
          secondary,
          transliterate: cloudTransliterate,
          log: (message) => send({ stage: "log", message }),
          onProgress: (p) => send(p),
        });
        const result = {
          input,
          output,
          ok: true,
          voters: r.summary.ExtractedVoters,
          expected: r.summary.ExpectedTotalVoters,
          review: r.summary.ReviewItems,
          seconds: Math.round((Date.now() - started) / 1000),
          constituency: r.meta.AssemblyConstituency,
          part: r.meta.PartNo,
          pages: r.meta.TotalPages,
          mode: cloud ? "cloud" : "local",
          cloudFields: r.summary.CloudFieldsReplaced ?? 0,
          cloudBoxes: r.summary.CloudBoxesSent ?? 0,
          secondary: r.summary.SecondaryLanguages ?? "",
          secondaryError: r.summary.SecondaryLanguageError ?? "",
        };
        results.push(result);
        getHistory().add(result);
        pendingStats.conversions += 1;
        pendingStats.voters += Number(result.voters) || 0;
      } catch (err) {
        const result = { input, output, ok: false, error: err?.message || String(err), seconds: Math.round((Date.now() - started) / 1000) };
        results.push(result);
        getHistory().add(result);
        send({ stage: "error", message: result.error });
      }
    }
  } finally {
    running = false;
  }
  // Report the work done; a block that happened meanwhile locks the app now.
  verifyLicense()
    .then((s) => s.state !== "ok" && event.sender.send("license", s))
    .catch(() => {});
  return results;
});
