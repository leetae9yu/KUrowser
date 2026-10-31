import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { ATTENDANCE_TOOL_ID, CANVAS_ORIGIN, liveOptions } from "../engine/live.ts";
import type { ChatReply, DownloadEvent, ReadCommand, Settings, Snapshot } from "../shared/types.ts";
import { GatewayClient, type Opener } from "./ai.ts";
import { devConfig } from "./dev.ts";
import { ElectronBrowserSession } from "./electron-cdp.ts";
import { isAiLoginUrl, isAllowedPage, isDownloadHost } from "./hosts.ts";
import { LmsService } from "./lms.ts";
import { ReminderScheduler } from "./reminders.ts";
import { keepLogin, makeEngineWindow, openSchoolWindow, schoolSession, signIn, signOut } from "./school.ts";
import { COMMAND_PROMPT, SUMMARY_PROMPT, commandUserPrompt, parseCommand, parseSummaries, summaryUserPrompt } from "./sentence.ts";
import { CHAT_PROMPT, chatUserPrompt, CLARIFY_PROMPT, commandOf, jevRequest, pageUrl, parseJev, routeUserPrompt } from "./route.ts";
import { StateStore } from "./state.ts";

const APP_ORIGIN = "app://kurowser";
const DIST_DIR = join(app.getAppPath(), "dist");
const RENDERER_DIR = join(DIST_DIR, "renderer");
const STALE_MS = 10 * 60 * 1000;
/** Below this Jev confidence the app asks back in one sentence instead of acting. */
const ROUTE_CONFIDENCE = 0.6;
/** Longer than a normal keychain read; past this the OS is most likely showing an allow prompt. */
const KEYCHAIN_HINT_MS = 2500;

let mainWindow: BrowserWindow | null = null;
let gatewayRestored = false;
let aiAttempted = false;

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

export function engineSession(): ElectronBrowserSession {
  return new ElectronBrowserSession(devConfig(), liveOptions({ timeoutSeconds: 60, allowDownloadHost: isDownloadHost }), makeEngineWindow);
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
  onLogin: async () => {
    if (!store.get().signedInBefore) store.update((s) => (s.signedInBefore = true));
    await keepLogin();
  },
});

function send(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents.getURL().startsWith(`${APP_ORIGIN}/`)) return;
  mainWindow.webContents.send(channel, payload);
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
  return {
    notifyDue: store.get().notifyDue,
    downloadDir: downloadDir(),
    aiConnected: gateway.connected,
    aiLabel: gateway.label,
    signedInBefore: store.get().signedInBefore,
  };
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

/** Shows the AI site's login in a school window when the portal session has lapsed. */
const aiOpener: Opener = (() => {
  let win: BrowserWindow | null = null;
  return {
    open(url: string) {
      win = openSchoolWindow(url, mainWindow ?? undefined);
      return win?.webContents ?? null;
    },
    close() {
      if (win && !win.isDestroyed()) win.close();
      win = null;
    },
  };
})();

/**
 * The first portal sign-in also connects the AI: the AI site uses the same portal login, so the key is issued in
 * the background without a second login. It runs once per app run, and only when no stored key works.
 */
async function connectAi(): Promise<{ ok: boolean; text: string }> {
  aiAttempted = true;
  try {
    const text = await gateway.connect(aiOpener, (status) => send("aiStatus", status));
    return { ok: true, text };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : "연결하지 못했어요" };
  } finally {
    send("settings", settings());
  }
}

const when = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }) : "기한 없음";

/** The LMS facts the chat model may use: open work, unwatched lectures, recent notices, new files. */
function chatContext(): string {
  const snap = lms.snapshot();
  const name = new Map(snap.courses.map((c) => [c.id, c.name]));
  const now = Date.now();
  const lines = [
    ...snap.assignments.filter((a) => !a.submitted && Date.parse(a.due) > now).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 10).map((a) => `마감: ${name.get(a.courseId) ?? ""} ${a.title} ${when(a.due)}`),
    ...snap.lectures.filter((l) => l.available).slice(0, 10).map((l) => `안 본 강의: ${name.get(l.courseId) ?? ""} ${l.title}, 출석 인정 ${when(l.until)}까지`),
    ...snap.notices.slice(0, 8).map((n) => `공지: ${name.get(n.courseId) ?? ""} '${n.title}' ${n.summary || n.body.replace(/\s+/g, " ").slice(0, 200)}`),
    ...snap.files.filter((f) => f.isNew && !f.downloaded).slice(0, 8).map((f) => `새 자료: ${name.get(f.courseId) ?? ""} ${f.name}`),
  ];
  return [`오늘: ${when(new Date().toISOString())}`, `과목: ${snap.courses.map((c) => c.name).join(", ")}`, ...lines].join("\n");
}

/**
 * A sentence the local rules could not place. Jev classifies it in one decisions call; a confident read runs a
 * read command, a page request opens the school page, a write request is refused with the page to do it on, and
 * conversation goes to the cheap chat model. Each Gateway call carries a flat filter fee, so a sentence costs one
 * or two calls at most.
 */
async function chat(text: string): Promise<ChatReply> {
  if (!gateway.connected) return { kind: "error", text: "고대 AI가 아직 연결되지 않았어요" };
  const snap = lms.snapshot();
  const courses = snap.courses.map((c) => c.name);
  const courseId = (n?: string) => snap.courses.find((c) => c.name === n)?.id;
  try {
    const route = parseJev(await gateway.decide(jevRequest(text, courses)), courses);
    if (!route) return { kind: "error", text: "AI 답을 읽지 못했어요" };
    if (route.kind !== "chat" && route.confidence < ROUTE_CONFIDENCE) {
      return { kind: "clarify", text: await gateway.complete(CLARIFY_PROMPT, routeUserPrompt(text, courses), 80) };
    }
    const open = (): boolean => !!openSchoolWindow(pageUrl(CANVAS_ORIGIN, route.topic, courseId(route.course), ATTENDANCE_TOOL_ID));
    switch (route.kind) {
      case "write":
        open();
        return { kind: "refused", text: "제출, 출석, 글쓰기처럼 학교에 무언가를 바꾸는 일은 앱이 하지 않아요. 열어 둔 학교 화면에서 직접 해 주세요." };
      case "command": {
        const command = commandOf(route);
        if (command) return { kind: "command", command };
        return open() ? { kind: "opened", text: "학교 화면을 열었어요" } : { kind: "error", text: "그 화면을 열지 못했어요" };
      }
      case "path":
        return open() ? { kind: "opened", text: `${route.course ? `${route.course} ` : ""}학교 화면을 열었어요` } : { kind: "error", text: "그 화면을 열지 못했어요" };
      case "chat":
        return { kind: "answer", text: await gateway.complete(CHAT_PROMPT, chatUserPrompt(text, chatContext()), 300) };
    }
  } catch (error) {
    return { kind: "error", text: error instanceof Error ? error.message : "AI에 묻지 못했어요" };
  }
}

function registerIpc(): void {
  handle("chat", (text: unknown): Promise<ChatReply> | ChatReply =>
    typeof text === "string" && text.trim() ? chat(text.trim().slice(0, 300)) : { kind: "error", text: "" },
  );
  handle("snapshot", (): Snapshot => lms.snapshot());
  handle("refresh", () => lms.refresh());
  handle("login", async () => {
    const ok = await signIn(mainWindow ?? undefined);
    if (ok) {
      void lms.refresh();
      if (!gateway.connected) void connectAi();
    }
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
      send("download", { kind: "finished", ids: strings(ids), ...result } satisfies DownloadEvent);
    } catch {
      send("download", { kind: "finished", ids: strings(ids), done: 0, failed: strings(ids).length, canceled: false } satisfies DownloadEvent);
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
  handle("connectAi", () => connectAi());
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
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
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
  if (process.env.KUROWSER_BENCH && !app.isPackaged) {
    const { runBench } = await import("./bench.ts");
    await runBench(gateway, join(app.getAppPath(), "tests", "bench", "sentences.json"), process.env.KUROWSER_BENCH_OUT ?? join(app.getPath("temp"), "kurowser-bench.json"));
    app.exit(0);
    return;
  }
  registerIpc();
  lms.subscribe((snapshot) => {
    send("snapshot", snapshot);
    if (snapshot.phase === "ready" && !aiAttempted && !gateway.connected && gatewayRestored) void connectAi();
  });
  reminders.start();
  // The window comes first. Reading the stored AI key or the cookie key can wait on a macOS keychain
  // prompt (an unsigned or re-signed build asks again), and that wait must not keep the app windowless.
  mainWindow = createMainWindow();
  void startLoading();
});

/**
 * The cookie store and the AI key share one OS key. When macOS asks whether the app may read it (after an
 * update of an app without a team id), every school request waits on that prompt, so the first load waits for
 * the answer and the window explains the prompt meanwhile. A denied key leaves the cookies unreadable, and the
 * load then ends on the sign-in screen.
 */
async function startLoading(): Promise<void> {
  const hint = setTimeout(() => lms.waitingForKeychain(), KEYCHAIN_HINT_MS);
  await safeStorage.isAsyncEncryptionAvailable().catch(() => false);
  clearTimeout(hint);
  void gateway.restore().finally(() => {
    gatewayRestored = true;
    if (lms.snapshot().phase === "ready" && !aiAttempted && !gateway.connected) void connectAi();
  });
  void lms.refresh();
}

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
