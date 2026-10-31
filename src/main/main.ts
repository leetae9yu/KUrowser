import { app, BrowserWindow, ipcMain, net, protocol, shell, type IpcMainInvokeEvent } from "electron";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { liveOptions } from "../engine/live.ts";
import type { DownloadEvent, ReadCommand, Settings, Snapshot } from "../shared/types.ts";
import { GatewayClient } from "./ai.ts";
import { devConfig } from "./dev.ts";
import { ElectronBrowserSession } from "./electron-cdp.ts";
import { isAiLoginUrl, isAllowedPage } from "./hosts.ts";
import { LmsService } from "./lms.ts";
import { ReminderScheduler } from "./reminders.ts";
import { keepLogin, makeEngineWindow, openSchoolWindow, schoolSession, signIn, signOut } from "./school.ts";
import { COMMAND_PROMPT, SUMMARY_PROMPT, commandUserPrompt, parseCommand, parseSummaries, summaryUserPrompt } from "./sentence.ts";
import { StateStore } from "./state.ts";

const APP_ORIGIN = "app://kurowser";
const DIST_DIR = join(app.getAppPath(), "dist");
const RENDERER_DIR = join(DIST_DIR, "renderer");
const STALE_MS = 10 * 60 * 1000;

let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

export function engineSession(): ElectronBrowserSession {
  return new ElectronBrowserSession(devConfig(), liveOptions({ timeoutSeconds: 60 }), makeEngineWindow);
}

function downloadDir(): string {
  const override = !app.isPackaged ? process.env.KUROWSER_DOWNLOAD_DIR : undefined;
  return override || join(homedir(), "Downloads", "KUrowser");
}

const store = new StateStore(join(app.getPath("userData"), "state.json"));
const reminders = new ReminderScheduler(store);
const gateway = new GatewayClient();
const lms = new LmsService({
  makeSession: engineSession,
  downloadDir,
  readNotices: () => new Set(store.get().readNotices),
  summaries: () => store.get().summaries,
  reminders: () => store.get().reminders.map((r) => r.id),
  onLogin: () => keepLogin(),
});

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function serveRenderer(): void {
  protocol.handle("app", (request) => {
    const { host, pathname } = new URL(request.url);
    const file = normalize(join(RENDERER_DIR, decodeURIComponent(pathname)));
    if (host !== "kurowser" || !file.startsWith(RENDERER_DIR + sep)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function settings(): Settings {
  return { notifyDue: store.get().notifyDue, downloadDir: downloadDir(), aiConnected: gateway.connected, aiLabel: gateway.label };
}

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)) throw new Error("unexpected sender");
    return fn(...(args as A));
  });
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

function openFromSnapshot(kind: "assignment" | "lecture" | "notice", id: unknown): void {
  const url = typeof id === "string" ? lms.url(kind, id) : null;
  if (url) openSchoolWindow(url);
}

function registerIpc(): void {
  handle("snapshot", (): Snapshot => lms.snapshot());
  handle("refresh", () => lms.refresh());
  handle("login", async () => {
    const ok = await signIn(mainWindow ?? undefined);
    if (ok) void lms.refresh();
    return { ok, text: ok ? "로그인했어요" : "로그인 창이 닫혔어요" };
  });
  handle("logout", async () => {
    await signOut();
    lms.loggedOut();
  });
  handle("openAssignment", (id: unknown) => openFromSnapshot("assignment", id));
  handle("openLecture", (id: unknown) => openFromSnapshot("lecture", id));
  handle("openNotice", (id: unknown) => openFromSnapshot("notice", id));
  handle("markRead", (ids: unknown) => {
    store.update((s) => {
      s.readNotices = [...new Set([...s.readNotices, ...strings(ids)])];
    });
    lms.emit();
  });
  handle("summarize", async (ids: unknown) => {
    const wanted = new Set(strings(ids));
    const notices = lms.snapshot().notices.filter((n) => wanted.has(n.id) && !n.summary);
    if (!notices.length) return { ok: true, text: "" };
    if (!gateway.connected) return { ok: false, text: "AI를 연결하면 공지를 한 줄로 줄여 드려요" };
    try {
      const raw = await gateway.complete(SUMMARY_PROMPT, summaryUserPrompt(notices), 80 * notices.length + 100);
      const lines = parseSummaries(raw, notices.length);
      if (!lines) return { ok: false, text: "AI 답을 읽지 못해서 제목만 보여 드려요" };
      store.update((s) => {
        notices.forEach((n, i) => {
          if (lines[i]) s.summaries[n.id] = lines[i]!;
        });
      });
      lms.emit();
      return { ok: true, text: "" };
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : "AI 요약에 실패했어요" };
    }
  });
  handle("remind", (ids: unknown) => {
    const snap = lms.snapshot();
    const wanted = new Set(strings(ids));
    const names = new Map(snap.courses.map((c) => [c.id, c.name]));
    const added = reminders.add(
      snap.assignments.filter((a) => wanted.has(a.id)).map((a) => ({ id: a.id, title: a.title, course: names.get(a.courseId) ?? "", due: a.due })),
    );
    if (!store.get().notifyDue) store.update((s) => (s.notifyDue = true));
    lms.emit();
    return { ok: added > 0, text: added ? `마감 ${added}개에 알림을 켰어요` : "알림을 켤 마감이 없어요" };
  });
  handle("download", async (ids: unknown) => {
    mkdirSync(downloadDir(), { recursive: true });
    const progress = (fileId: string, state: "active" | "done" | "failed", error?: string): void =>
      send("download", { kind: "progress", fileId, state, error } satisfies DownloadEvent);
    try {
      const result = await lms.download(strings(ids), progress);
      send("download", { kind: "finished", ...result } satisfies DownloadEvent);
    } catch {
      send("download", { kind: "finished", done: 0, failed: strings(ids).length, canceled: false } satisfies DownloadEvent);
    }
  });
  handle("cancelDownloads", () => lms.cancelDownloads());
  handle("openDownloads", async () => {
    mkdirSync(downloadDir(), { recursive: true });
    await shell.openPath(downloadDir());
  });
  handle("settings", () => settings());
  handle("setNotifyDue", (on: unknown) => {
    store.update((s) => (s.notifyDue = on === true));
    return settings();
  });
  handle("connectAi", async () => {
    try {
      const text = await gateway.connect(mainWindow, (status) => send("aiStatus", status));
      return { ok: true, text };
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : "연결하지 못했어요" };
    }
  });
  handle("interpret", async (text: unknown): Promise<{ via: "ai"; command: ReadCommand } | null> => {
    if (typeof text !== "string" || !text.trim() || !gateway.connected) return null;
    const courses = lms.snapshot().courses.map((c) => c.name);
    try {
      const command = parseCommand(await gateway.complete(COMMAND_PROMPT, commandUserPrompt(text.slice(0, 300), courses), 120), courses);
      return command ? { via: "ai", command } : null;
    } catch {
      return null;
    }
  });
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 480,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: "KUrowser",
    webPreferences: { preload: join(DIST_DIR, "main", "preload.js"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("focus", () => {
    const fetchedAt = lms.snapshot().fetchedAt;
    if (fetchedAt && Date.now() - Date.parse(fetchedAt) > STALE_MS) void lms.refresh();
  });
  void win.loadURL(`${APP_ORIGIN}/index.html`);
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
  if (process.env.KUROWSER_PROBE && !app.isPackaged) {
    const { runProbe } = await import("./probe.ts");
    await runProbe(engineSession);
    app.exit(0);
    return;
  }
  registerIpc();
  lms.subscribe((snapshot) => send("snapshot", snapshot));
  await gateway.restore();
  reminders.start();
  mainWindow = createMainWindow();
  void lms.refresh();
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
