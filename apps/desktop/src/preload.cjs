// Bridge between the sandboxed page and the main process. Only paths and plain
// data cross this boundary.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("roll", {
  platform: process.platform,
  license: {
    status: () => ipcRenderer.invoke("license-status"),
    activate: (code) => ipcRenderer.invoke("license-activate", code),
    reset: () => ipcRenderer.invoke("license-reset"),
  },
  onLicense: (cb) => ipcRenderer.on("license", (_e, status) => cb(status)),
  onFullscreen: (cb) => ipcRenderer.on("fullscreen", (_e, on) => cb(on)),
  version: () => ipcRenderer.invoke("app-version"),
  update: {
    status: () => ipcRenderer.invoke("update-status"),
    install: () => ipcRenderer.invoke("update-install"),
  },
  onUpdate: (cb) => ipcRenderer.on("update", (_e, status) => cb(status)),
  pickPdfs: () => ipcRenderer.invoke("pick-pdfs"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  modelsPresent: () => ipcRenderer.invoke("models-present"),
  convert: (args) => ipcRenderer.invoke("convert", args),
  openPath: (p) => ipcRenderer.invoke("open-path", p),
  saveCopy: (p) => ipcRenderer.invoke("save-copy", p),
  historyList: () => ipcRenderer.invoke("history-list"),
  historyRemove: (id) => ipcRenderer.invoke("history-remove", id),
  historyClear: () => ipcRenderer.invoke("history-clear"),
  showInFolder: (p) => ipcRenderer.invoke("show-in-folder", p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on("progress", handler);
    return () => ipcRenderer.removeListener("progress", handler);
  },
});
