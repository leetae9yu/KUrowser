import { app, BrowserWindow, ipcMain, net, protocol } from "electron";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { liveOptions } from "../engine/live.ts";
import { devConfig } from "./dev.ts";
import { ElectronBrowserSession } from "./electron-cdp.ts";
import { isAiLoginUrl, isAllowedPage } from "./hosts.ts";
import { makeEngineWindow, schoolSession } from "./school.ts";

let mainWindow: BrowserWindow | null = null;
const APP_ORIGIN = "app://kurowser";
const DIST_DIR = join(app.getAppPath(), "dist");
const RENDERER_DIR = join(DIST_DIR, "renderer");

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function serveRenderer(): void {
  protocol.handle("app", (request) => {
    const { host, pathname } = new URL(request.url);
    const file = normalize(join(RENDERER_DIR, decodeURIComponent(pathname)));
    if (host !== "kurowser" || !file.startsWith(RENDERER_DIR + sep)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

export function engineSession(): ElectronBrowserSession {
  return new ElectronBrowserSession(devConfig(), liveOptions({ timeoutSeconds: 60 }), makeEngineWindow);
}

function rendererUrl(): string {
  return `${APP_ORIGIN}/index.html`;
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: "KUrowser",
    backgroundColor: "#ffffff",
    webPreferences: { preload: join(DIST_DIR, "main", "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  void win.loadURL(rendererUrl());
  return win;
}

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`) && !isAllowedPage(url) && !isAiLoginUrl(url)) event.preventDefault();
  });
});

app.whenReady().then(async () => {
  serveRenderer();
  schoolSession();
  ipcMain.handle("version", () => app.getVersion());
  if (process.env.KUROWSER_PROBE && !app.isPackaged) {
    const { runProbe } = await import("./probe.ts");
    await runProbe(engineSession);
    app.exit(0);
    return;
  }
  mainWindow = createMainWindow();
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
