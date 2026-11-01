import { app, BrowserWindow, ipcMain, net, protocol, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { ATTENDANCE_TOOL_ID, CANVAS_ORIGIN, liveOptions } from "../engine/live.ts";
import { courseFolder } from "../engine/materials.ts";
import type { ChatReply, TreeState, DownloadEvent, ReadCommand, Settings, Snapshot, SttEvent, SttPlan } from "../shared/types.ts";
import { GatewayClient } from "./ai.ts";
import { DiskCache } from "./cache.ts";
import { devConfig } from "./dev.ts";
import { ElectronBrowserSession } from "./electron-cdp.ts";
import { EngineHost } from "./engine-host.ts";
import { isAiLoginUrl, isAllowedPage, isDownloadHost } from "./hosts.ts";
import { type LmsCache, LmsService } from "./lms.ts";
import { ReminderScheduler } from "./reminders.ts";
import { SchoolPane } from "./pane.ts";
import { AmsService } from "./ams.ts";
import { amsPost, siteGet } from "./site-fetch.ts";
import { type SitesCache, SitesService } from "./sites.ts";
import { keepLogin, makeEngineWindow, schoolSession, signIn, signOut } from "./school.ts";
import { COMMAND_PROMPT, SUMMARY_LECTURE_PROMPT, SUMMARY_PROMPT, commandUserPrompt, parseCommand, parseSummaries, summaryUserPrompt } from "./sentence.ts";
import { classify, JEV_MODEL, JevGuard } from "./jev-guard.ts";
import { CHAT_PROMPT, chatUserPrompt, CLARIFY_PROMPT, intentOf, jevRequest, pageUrl, parseJev, parseLlmRoute, ROUTE_PROMPT, routeUserPrompt, unsure } from "./route.ts";
import { pick, PORTAL_GROUPS, portalScreens, readStep, stepOptions, stepPrompt, stepRequest, TREE_CONFIDENCE } from "./tree.ts";
import { StateStore } from "./state.ts";
import { captionText, estimateCredits, extractAudio, fetchCaption, resolveMedia, STT_MODEL, STT_SPEED, toSrt } from "./stt.ts";

const APP_ORIGIN = "app://kurowser";
const DIST_DIR = join(app.getAppPath(), "dist");
const RENDERER_DIR = join(DIST_DIR, "renderer");
const STALE_MS = 10 * 60 * 1000;
/** Below this Jev confidence the app asks back in one sentence instead of acting. */
const ROUTE_CONFIDENCE = 0.6;
/** A typed sentence costs at most two calls (Jev, then a question back), each with the 5-credit filter fee. */
const CHAT_MIN_CREDITS = 11;
const CREDITS_FRESH_MS = 60_000;
/** The AI account's credits left, read again (free) when older than a minute or after a paid call. */
const credits = { left: null as number | null, at: 0 };
/** Longer than a normal keychain read; past this the OS is most likely showing an allow prompt. */
const KEYCHAIN_HINT_MS = 2500;

let mainWindow: BrowserWindow | null = null;
let gatewayRestored = false;

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
/** The one hidden window every school site reads through. */
const engine = new EngineHost(engineSession);
const hidden = <T>(job: (wc: Electron.WebContents) => Promise<T>): Promise<T> => engine.exclusive((session) => job(session.webContents!));
const gateway = new GatewayClient(hidden);
const AI_LOG = (): string => join(app.getPath("userData"), "ai-errors.log");
/** Every failed AI call goes to the console, to ai-errors.log beside perf.log, and to the settings screen. */
const jevGuard = new JevGuard((failure) => {
  console.log(`AI_FAIL ${JSON.stringify(failure)}`);
  try {
    appendFileSync(AI_LOG(), `${JSON.stringify(failure)}\n`, { mode: 0o600 });
  } catch {
    // A read-only profile only loses the record; the settings screen still shows it.
  }
  send("settings", settings());
});
const lmsCache = new DiskCache<LmsCache>(join(app.getPath("userData"), "lms-cache.json"), 1);
const pane = new SchoolPane(
  () => mainWindow,
  (state) => send("pane", state),
  (event) => send("focus", event),
);
let aiAttempted = false;
const sitesCache = new DiskCache<SitesCache>(join(app.getPath("userData"), "sites-cache.json"), 1);
const sites = new SitesService({
  get: siteGet,
  hidden,
  keepLogin: () => keepLogin(),
  cache: sitesCache,
  readNotices: () => new Set(store.get().readNotices),
});
const ams = new AmsService({ get: siteGet, post: amsPost, hidden, onChange: (state) => send("ams", state), keepLogin: () => keepLogin() });
const lms = new LmsService({
  engine,
  cache: lmsCache,
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
    aiCredits: gateway.connected ? credits.left : null,
    aiErrors: { count: jevGuard.failures, last: jevGuard.last, pausedUntil: jevGuard.pausedUntil() },
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
  if (url) pane.open(url);
}

/**
 * The first portal sign-in also connects the AI: the AI site uses the same portal login, so the key is issued in
 * the background without a second login. It runs once per app run, and only when no stored key works.
 */
async function connectAi(): Promise<{ ok: boolean; text: string }> {
  aiAttempted = true;
  try {
    const text = await gateway.connect(pane, (status) => send("aiStatus", status));
    return { ok: true, text };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : "연결하지 못했어요" };
  } finally {
    send("settings", settings());
    if (gateway.connected) void refreshCredits();
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

async function refreshCredits(): Promise<number | null> {
  const left = await gateway.credits().catch(() => null);
  const changed = left !== credits.left;
  credits.left = left;
  credits.at = Date.now();
  if (changed) send("settings", settings());
  return left;
}

/**
 * A typed sentence. Jev classifies it in one decisions call: a confident read becomes an intent the chat runs like
 * a chip, a page request opens the school page on the left, a write request is refused with the page to do it on,
 * and conversation goes to the cheap chat model; an unsure read asks back in one sentence. Each Gateway call carries
 * a flat filter fee, so a sentence costs one or two calls. When Jev fails on the server side or is paused, the cheap
 * chat model classifies the sentence instead; when that fails too, or without the AI or enough credits, the chat
 * offers its common requests as buttons rather than guessing.
 */
async function chat(text: string): Promise<ChatReply> {
  if (!gateway.connected) return { kind: "fallback", reason: "offline" };
  const left = Date.now() - credits.at < CREDITS_FRESH_MS ? credits.left : await refreshCredits();
  // An unknown balance does not hold back a sentence the student typed; the Gateway refuses a call it cannot bill.
  if (left !== null && left < CHAT_MIN_CREDITS) return { kind: "fallback", reason: "credits" };
  const snap = lms.snapshot();
  const courses = snap.courses.map((c) => c.name);
  const menus = sites.snapshot().menus;
  const courseId = (n?: string) => snap.courses.find((c) => c.name === n)?.id;
  try {
    const { route } = await classify(jevGuard, JEV_MODEL, () => gateway.decide(jevRequest(text, courses, menus)), (body) => parseJev(body, courses, menus), {
      model: () => gateway.chatModelName,
      call: () => gateway.complete(ROUTE_PROMPT, routeUserPrompt(text, courses), 120),
      parse: (raw) => parseLlmRoute(raw, courses),
    });
    if (!route) return { kind: "fallback", reason: "failed" };
    const clarify = async (): Promise<ChatReply> => ({ kind: "clarify", text: await gateway.complete(CLARIFY_PROMPT, routeUserPrompt(text, courses), 80) });
    if (unsure(route, ROUTE_CONFIDENCE)) return await clarify();
    const open = (topic = route.topic): ChatReply =>
      pane.open(pageUrl(CANVAS_ORIGIN, topic, courseId(route.course), ATTENDANCE_TOOL_ID))
        ? { kind: "opened", text: `${route.course ? `${route.course} ` : ""}학교 화면을 왼쪽에 열었어요` }
        : { kind: "error", text: "그 화면을 열지 못했어요" };
    if (route.kind === "write") {
      const next = route.topic === "deadlines" ? nextAssignmentUrl(courseId(route.course)) : null;
      if (!next || !pane.open(next)) open();
      return { kind: "refused", text: "제출, 출석, 글쓰기처럼 학교에 무언가를 바꾸는 일은 앱이 하지 않아요. 왼쪽 학교 화면에서 직접 해 주세요." };
    }
    if (route.kind === "path" && treePage(route)) return await walkTree({ text, ...route.tree }, FIRST_CALL_STEPS);
    const action = intentOf(route);
    // Reading the academic system mails the student a sign-in code, so an unsure guess asks back first.
    const mailsCode = action && "intent" in action && action.intent.kind === "ams" && route.kind === "chat";
    if (mailsCode && (route.topicConfidence ?? 0) < ROUTE_CONFIDENCE) return await clarify();
    if (action && "intent" in action) return { kind: "intent", intent: action.intent };
    if (action) return open(action.open);
    if (route.kind === "chat") return { kind: "answer", text: await gateway.complete(CHAT_PROMPT, chatUserPrompt(text, chatContext()), 300) };
    return await clarify();
  } catch (error) {
    return { kind: "error", text: error instanceof Error ? error.message : "AI에 묻지 못했어요" };
  } finally {
    void refreshCredits();
  }
}

type TreeStep = "area" | "course" | "group" | "screen";
/** The steps the sentence's first Jev call already answered; one it was unsure of is asked back, not asked again. */
const FIRST_CALL_STEPS: ReadonlySet<TreeStep> = new Set(["area", "course", "group"]);
/** School menus outside the LMS and the portal tree keep their direct page. */
const OUTSIDE_TREE_MENUS: ReadonlySet<string> = new Set(["sugang", "loans", "seats", "calendar"]);

function treePage(route: { topic: string; menu?: string }): boolean {
  if (route.topic === "library_loans" || route.topic === "library_seats" || route.topic === "calendar") return false;
  return !(route.topic === "school_menu" && route.menu && OUTSIDE_TREE_MENUS.has(route.menu));
}

async function canSpend(): Promise<boolean> {
  if (!gateway.connected) return false;
  const left = Date.now() - credits.at < CREDITS_FRESH_MS ? credits.left : await refreshCredits();
  return left === null || left >= CHAT_MIN_CREDITS;
}

/**
 * Walks the page tree from `start`: a step Jev has not answered yet gets one Jev call, an unsure step is asked back
 * with its options, and a picked screen opens on the left. Addresses come only from the course tabs and the portal
 * table, never from the state the renderer sends back.
 */
async function walkTree(start: TreeState, jevAnswered: ReadonlySet<TreeStep>): Promise<ChatReply> {
  const courses = lms.snapshot().courses.map((c) => c.name);
  let state = start;
  for (let turn = 0; turn < 4; turn++) {
    const screens = state.area === "lms" && state.course ? await lms.courseTabs(state.course) : state.area === "portal" && state.group ? portalScreens(state.group) : null;
    const { step, labels } = stepOptions(state, courses, screens);
    if (step === "screen" && state.screen) {
      const screen = screens?.find((s) => s.label === state.screen);
      if (!screen) return { kind: "error", text: "그 화면을 찾지 못했어요" };
      const where = state.area === "lms" ? `${state.course} ${screen.label}` : `${state.group?.split(" > ").at(-1) ?? ""} ${screen.label}`;
      const ams = screen.url.startsWith("https://ams.korea.ac.kr/");
      return pane.open(screen.url)
        ? { kind: "opened", text: `왼쪽에 ${where} 화면을 열었어요${ams ? ". 학사시스템은 메일로 온 인증번호를 한 번 넣어야 해요" : ""}` }
        : { kind: "error", text: "그 화면을 열지 못했어요" };
    }
    if (!labels.length) return { kind: "error", text: "열 수 있는 화면을 찾지 못했어요" };
    const current = state;
    const ask = (): ChatReply => ({ kind: "choices", text: stepPrompt(step), options: labels.map((label) => ({ label, state: pick(current, step, label, labels)! })) });
    if (jevAnswered.has(step) || !(await canSpend())) return ask();
    const call = await jevGuard.run(JEV_MODEL, () => gateway.decide(stepRequest(state.text, step, labels)));
    const answer = readStep(call.ok ? call.body : null, labels);
    if (!answer.label || answer.confidence < TREE_CONFIDENCE) return ask();
    state = pick(state, step, answer.label, labels)!;
  }
  return { kind: "error", text: "그 화면을 열지 못했어요" };
}

/** A step the student picked, checked against the options the app offers before the walk goes on. */
function treeState(value: unknown): TreeState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.text !== "string" || !v.text.trim() || v.text.length > 300) return null;
  const state: TreeState = { text: v.text };
  if (v.area !== undefined) {
    if (v.area !== "lms" && v.area !== "portal") return null;
    state.area = v.area;
  }
  if (v.course !== undefined) {
    if (typeof v.course !== "string" || !lms.snapshot().courses.some((c) => c.name === v.course)) return null;
    state.course = v.course;
  }
  if (v.group !== undefined) {
    if (typeof v.group !== "string" || !PORTAL_GROUPS.includes(v.group)) return null;
    state.group = v.group;
  }
  if (v.screen !== undefined) {
    if (typeof v.screen !== "string" || v.screen.length > 80) return null;
    state.screen = v.screen;
  }
  return state;
}

/** The open assignment of a course that is due first; none without a course, since a guess could open the wrong one. */
function nextAssignmentUrl(courseId: string | undefined): string | null {
  if (!courseId) return null;
  const now = Date.now();
  const next = lms
    .snapshot()
    .assignments.filter((a) => a.courseId === courseId && !a.submitted && Date.parse(a.due) > now)
    .sort((a, b) => a.due.localeCompare(b.due))[0];
  return next ? lms.url("assignment", next.id) : null;
}

function ffmpegPath(): string {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  return app.isPackaged ? join(process.resourcesPath, "ffmpeg", exe) : join(app.getAppPath(), "node_modules", "ffmpeg-static", exe);
}

/** One summary call to the cheap chat model: about 0.3 credit for the model plus the 5-credit filter fee. */
const SUMMARY_CREDITS = 6;
const sttRunning = new Set<string>();

/** Dev runs may cap the audio (KUROWSER_STT_CLIP_SECONDS) so a real-account test spends only a clip's credits. */
function clipSeconds(): number | undefined {
  const n = Number(!app.isPackaged ? process.env.KUROWSER_STT_CLIP_SECONDS : "");
  return n > 0 ? n : undefined;
}

async function sttPlan(id: string): Promise<SttPlan> {
  const data = lms.mediaData(id);
  if (!data) return { ok: false, text: "그 강의를 찾지 못했어요" };
  try {
    const media = await resolveMedia(schoolSession(), data);
    if (!gateway.connected) return { ok: false, text: "고대 AI를 연결하면 자막과 요약을 만들 수 있어요" };
    if (media.captionUrls.length) {
      const remaining = await gateway.credits();
      const enough = remaining !== null && remaining >= SUMMARY_CREDITS;
      const text = `공식 자막 사용(0크레딧), 요약 약 ${SUMMARY_CREDITS}크레딧, 남은 크레딧 ${remaining === null ? "확인 못 함" : Math.floor(remaining)}`;
      return { ok: enough, source: "captions", credits: SUMMARY_CREDITS, remaining, text: enough ? text : `${text}. 크레딧이 모자라서 시작하지 않아요` };
    }
    if (media.duration <= 0) return { ok: false, source: "stt", text: "강의 길이를 알 수 없어서 크레딧을 어림할 수 없어요. 시작하지 않아요" };
    const seconds = Math.min(media.duration, clipSeconds() ?? Infinity);
    const credits = estimateCredits(seconds, STT_SPEED) + SUMMARY_CREDITS;
    const remaining = await gateway.credits();
    const minutes = Math.max(1, Math.round(seconds / 60));
    const enough = remaining !== null && remaining >= credits;
    const text = `STT 사용: 이 강의 ${minutes}분 ≈ ${credits.toFixed(1)}크레딧(요약 포함), 남은 크레딧 ${remaining === null ? "확인 못 함" : Math.floor(remaining)}`;
    return { ok: enough, source: "stt", minutes, credits, remaining, text: enough ? text : `${text}. 크레딧이 모자라서 시작하지 않아요` };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : "강의 정보를 읽지 못했어요" };
  }
}

/**
 * Subtitles and a summary for one recorded lecture. Official captions come first (no credits); otherwise the main
 * video's audio, sped up 1.5x, goes to the Gateway STT. Only the content description and the media file are read:
 * no viewer, playback, progress or attendance request is made. Files land beside the course's materials.
 */
async function sttRun(id: string): Promise<void> {
  const emit = (e: SttEvent): void => send("stt", e);
  if (sttRunning.size) return emit({ id, kind: "failed", text: "다른 강의 자막을 만드는 중이에요. 끝난 뒤에 다시 눌러 주세요" });
  sttRunning.add(id);
  try {
    await sttRunOnce(id, emit);
  } finally {
    sttRunning.delete(id);
  }
}

async function sttRunOnce(id: string, emit: (e: SttEvent) => void): Promise<void> {
  const plan = await sttPlan(id);
  if (!plan.ok) return emit({ id, kind: "failed", text: plan.text });
  const rec = lms.snapshot().recordings.find((r) => r.id === id)!;
  const course = lms.snapshot().courses.find((c) => c.id === rec.courseId)?.name ?? "기타";
  const folder = join(downloadDir(), courseFolder(course));
  const base = join(folder, `${rec.week ?? ""}주차 ${rec.title}`.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 80));
  const work = mkdtempSync(join(app.getPath("temp"), "kurowser-stt-"));
  try {
    mkdirSync(folder, { recursive: true });
    const media = await resolveMedia(schoolSession(), lms.mediaData(id)!);
    let text: string;
    if (plan.source === "captions") {
      emit({ id, kind: "progress", text: "공식 자막을 받는 중이에요" });
      const raw = await fetchCaption(media.captionUrls[0]!);
      writeFileSync(`${base}_자막${/-->/.test(raw) && raw.includes("WEBVTT") ? ".vtt" : ".srt"}`, raw);
      text = captionText(raw);
    } else {
      emit({ id, kind: "progress", text: "강의 음성을 뽑는 중이에요" });
      const audio = join(work, "lecture.mp3");
      const audioSeconds = await extractAudio(ffmpegPath(), media.mediaUrl, audio, { clipSeconds: clipSeconds(), speed: STT_SPEED, normalize: true });
      // Billing follows the uploaded audio, so the balance is checked again against what was actually extracted.
      const cost = estimateCredits(audioSeconds) + SUMMARY_CREDITS;
      const balance = await gateway.credits();
      if (audioSeconds <= 0 || balance === null || balance < cost || cost > (plan.credits ?? 0) * 1.1 + 1) {
        return emit({ id, kind: "failed", text: `예상과 다르게 약 ${cost.toFixed(1)}크레딧이 들어서 시작하지 않았어요` });
      }
      emit({ id, kind: "progress", text: "받아쓰는 중이에요" });
      const result = await gateway.transcribe(audio, STT_MODEL);
      // Timestamps come back on the sped-up audio; scale them to the lecture's own clock.
      const segments = result.segments.map((s) => ({ ...s, start_ms: Math.round(s.start_ms * STT_SPEED), end_ms: Math.round(s.end_ms * STT_SPEED) }));
      writeFileSync(`${base}_자막.srt`, toSrt(segments));
      writeFileSync(`${base}_자막.txt`, result.text);
      text = result.text;
    }
    emit({ id, kind: "progress", text: "요약하는 중이에요" });
    const summary = await gateway.complete(SUMMARY_LECTURE_PROMPT, text.slice(0, 60_000), 700);
    writeFileSync(`${base}_요약.md`, summary);
    emit({ id, kind: "done", text: plan.source === "captions" ? "공식 자막으로 요약했어요" : "자막과 요약을 만들었어요", summary, folder });
  } catch (error) {
    emit({ id, kind: "failed", text: error instanceof Error ? error.message : "자막을 만들지 못했어요" });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const PERF_LOG = (): string => join(app.getPath("userData"), "perf.log");
let firstScreenSeconds: number | null = null;

/** Seconds since the process started and the memory of every app process; no school data goes into the log. */
function recordPerf(event: "firstScreen" | "loaded"): void {
  const memoryMb = Math.round(app.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024);
  const line = { at: new Date().toISOString(), version: app.getVersion(), event, seconds: Math.round(process.uptime() * 100) / 100, memoryMb, cached: lms.fromCache };
  try {
    appendFileSync(PERF_LOG(), `${JSON.stringify(line)}\n`, { mode: 0o600 });
  } catch {
    // A read-only profile only loses the measurement.
  }
}

function registerIpc(): void {
  handle("firstScreen", () => {
    if (firstScreenSeconds !== null) return;
    firstScreenSeconds = process.uptime();
    recordPerf("firstScreen");
  });
  handle("sttPlan", (id: unknown) => (typeof id === "string" ? sttPlan(id) : { ok: false, text: "" }));
  handle("sttRun", (id: unknown) => {
    if (typeof id === "string") void sttRun(id);
  });
  handle("openFolder", async (path: unknown) => {
    if (typeof path !== "string") return;
    const target = normalize(path);
    if (target.startsWith(downloadDir() + sep) && existsSync(target) && statSync(target).isDirectory()) await shell.openPath(target);
  });
  handle("treeContinue", async (value: unknown): Promise<ChatReply> => {
    const state = treeState(value);
    if (!state) return { kind: "error", text: "그 화면을 열지 못했어요" };
    try {
      // A picked step goes on without asking Jev again before the screen, so a sentence stays at two paid calls.
      return await walkTree(state, FIRST_CALL_STEPS);
    } catch (error) {
      return { kind: "error", text: error instanceof Error ? error.message : "그 화면을 열지 못했어요" };
    } finally {
      void refreshCredits();
    }
  });
  handle("chat", (text: unknown): Promise<ChatReply> | ChatReply =>
    typeof text === "string" && text.trim() ? chat(text.trim().slice(0, 300)) : { kind: "error", text: "" },
  );
  handle("snapshot", (): Snapshot => lms.snapshot());
  handle("sites", () => sites.snapshot());
  handle("refreshSites", () => sites.refresh());
  handle("seats", () => sites.seats());
  handle("ams", () => ams.snapshot());
  handle("amsStart", () => {
    void ams.start();
  });
  handle("amsCode", (code: unknown) => typeof code === "string" && ams.enterCode(code));
  handle("amsCancel", () => ams.cancel());
  handle("openMenu", (id: unknown) => {
    const menu = sites.snapshot().menus.find((m) => m.id === id);
    return !!menu && !!pane.open(menu.url);
  });
  handle("openPortalNotice", (id: unknown) => {
    const url = typeof id === "string" ? sites.noticeUrl(id) : null;
    if (url) pane.open(url);
  });
  handle("refresh", () => lms.refresh());
  handle("login", async () => {
    const ok = await signIn(pane);
    if (ok) {
      void lms.refresh();
      // The sites read at start ran before this login; the library sign-in needs the portal session it brings.
      void sites.refresh();
      if (!gateway.connected) void connectAi();
    }
    return { ok, text: ok ? "로그인했어요" : "로그인 창이 닫혔어요" };
  });
  handle("logout", async () => {
    await signOut();
    engine.signedIn = false;
    void engine.close();
    lms.loggedOut();
    sites.clear();
    ams.clear();
  });
  handle("openAssignment", (id: unknown) => openFromSnapshot("assignment", id));
  handle("openLecture", (id: unknown) => openFromSnapshot("lecture", id));
  handle("openNotice", (id: unknown) => openFromSnapshot("notice", id));
  handle("markRead", (ids: unknown) => {
    store.update((s) => {
      s.readNotices = [...new Set([...s.readNotices, ...strings(ids)])];
    });
    lms.emit();
    sites.emit();
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
  handle("paneState", () => pane.state());
  handle("paneBack", () => pane.back());
  handle("paneClose", () => pane.close());
  handle("paneWiden", () => pane.widen());
  handle("paneFocus", () => pane.toggleFocus());
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
  win.on("resize", () => pane.layout());
  win.on("focus", () => {
    const fetchedAt = lms.snapshot().fetchedAt;
    if (fetchedAt && Date.now() - Date.parse(fetchedAt) > STALE_MS) void lms.refresh();
    const sitesAt = sites.snapshot().portal.fetchedAt;
    if (!sitesAt || Date.now() - Date.parse(sitesAt) > STALE_MS) void sites.refresh();
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
  sites.subscribe((s) => send("sites", s));
  let loadedRecorded = false;
  lms.subscribe((snapshot) => {
    send("snapshot", snapshot);
    if (!loadedRecorded && snapshot.phase === "ready" && !snapshot.pending.length && snapshot.loaded.includes("lectures")) {
      loadedRecorded = true;
      recordPerf("loaded");
    }
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
    if (gateway.connected) void refreshCredits();
    else if (lms.snapshot().phase === "ready" && !aiAttempted) void connectAi();
  });
  void lms.refresh();
  void sites.refresh();
}

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
});

app.on("before-quit", () => {
  lmsCache.flush();
  sitesCache.flush();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
