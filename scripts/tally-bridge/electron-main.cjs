const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// Store config in userData (no sidecar files beside the portable EXE).
process.env.BRIDGE_CONFIG_DIR = app.getPath("userData");
process.env.ELECTRON_RUN = "1";

const { startServer } = require("./index.cjs");

let mainWindow = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 860,
    minWidth: 720,
    minHeight: 640,
    title: "PH PathLabs — Tally Bridge",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(process.env.BRIDGE_CONFIG_DIR, { recursive: true });
    const { url } = await startServer();
    createWindow(url);
  } catch (e) {
    dialog.showErrorBox("Tally Bridge failed to start", e instanceof Error ? e.message : String(e));
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
});
