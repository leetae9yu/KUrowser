import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { plainExcerpt, staffBoardPosts, staffNames } from "../engine/boards.ts";
import { LiveCommandError } from "../engine/errors.ts";
import { isUnauthorized, modules as learningxModules, workItems } from "../engine/learningx.ts";
import { ATTENDANCE_TOOL_ID, CANVAS_ORIGIN, fetchCourses, fetchRecordingPages, recordingAccessible, unwatchedRows } from "../engine/live.ts";
import { STATE_FILENAME, courseFolder, materialCandidates, syncMaterials } from "../engine/materials.ts";
import type { Assignment, Course, FileItem, Hue, Lecture, LoadPart, Notice, Snapshot } from "../shared/types.ts";
import { type ElectronBrowserSession, LoginRequired } from "./electron-cdp.ts";

type Raw = Record<string, any>;

const DAY = 86_400_000;
const NOTICE_NEW_DAYS = 7;
const NOTICE_KEEP_DAYS = 30;
const FILE_NEW_DAYS = 14;
const NOTICE_BODY_CHARS = 600;
/** Courses read at once. Every read is a fetch inside the one hidden window, so they can overlap. */
const COURSE_CONCURRENCY = 4;
/** Files downloaded at once. Each download runs in Node with the window's cookies. */
const DOWNLOAD_LANES = 3;

type DownloadResult = "done" | "failed" | "canceled";

interface QueuedDownload {
  row: Raw;
  token: { canceled: boolean };
  progress: DownloadProgress;
  settle: (result: DownloadResult) => void;
}

/** Map with at most `limit` calls in flight, keeping input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const hash = (...parts: unknown[]): string => createHash("sha256").update(parts.map(String).join("\u0000")).digest("hex").slice(0, 16);
const isRecord = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const iso = (value: unknown): string => {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
};

export function displayName(name: string): string {
  return courseFolder(name);
}

export function aliasesFor(name: string): string[] {
  const short = displayName(name);
  const compact = short.replace(/\s+/g, "").toLowerCase();
  const out = new Set([compact]);
  const after = name.includes(short) ? name.slice(name.indexOf(short) + short.length) : "";
  const english = /^\s*\(([^)]+)\)/.exec(after)?.[1]?.replace(/\s+/g, "").toLowerCase();
  if (english) out.add(english);
  if ([...compact].length >= 4) out.add([...compact].slice(0, 2).join(""));
  return [...out];
}

function emptySnapshot(phase: Snapshot["phase"]): Snapshot {
  return { phase, error: null, courses: [], assignments: [], lectures: [], notices: [], files: [], pending: [], reminders: [], fetchedAt: null };
}

interface Links {
  assignments: Map<string, string>;
  lectures: Map<string, string>;
  notices: Map<string, string>;
  files: Map<string, Raw>;
}

export interface LmsDeps {
  makeSession: () => ElectronBrowserSession;
  downloadDir: () => string;
  readNotices: () => ReadonlySet<string>;
  summaries: () => Readonly<Record<string, string>>;
  reminders: () => string[];
  onLogin: () => Promise<void>;
}

export type DownloadProgress = (fileId: string, state: "active" | "done" | "failed", error?: string) => void;

export class LmsService {
  private chain: Promise<unknown> = Promise.resolve();
  private snap: Snapshot = emptySnapshot("loading");
  private raws = new Map<string, Raw>();
  /** Attendance read while getting the LearningX token, reused by the lecture pass of the same load. */
  private warmAttendance = new Map<string, Raw>();
  private links: Links = { assignments: new Map(), lectures: new Map(), notices: new Map(), files: new Map() };
  private listeners = new Set<(s: Snapshot) => void>();
  private refreshing: Promise<void> | null = null;
  private readonly downloadTokens = new Set<{ canceled: boolean }>();
  private readonly downloadQueue: QueuedDownload[] = [];
  private downloadWorker: Promise<void> | null = null;

  constructor(private readonly deps: LmsDeps) {}

  snapshot(): Snapshot {
    return {
      ...this.snap,
      notices: this.snap.notices.map((n) => ({ ...n, read: n.read || this.deps.readNotices().has(n.id), summary: this.deps.summaries()[n.id] ?? n.summary })),
      reminders: this.deps.reminders(),
    };
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    const s = this.snapshot();
    for (const fn of this.listeners) fn(s);
  }

  private set(change: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...change };
    this.emit();
  }

  /**
   * Loads share one queue so two of them never drive the school at once. Downloads pass `queued = false`:
   * they open their own hidden window and start while a load is still checking lectures.
   */
  private withSession<T>(body: (session: ElectronBrowserSession) => Promise<T>, queued = true): Promise<T> {
    const run = async (): Promise<T> => {
      const session = this.deps.makeSession();
      await session.enter();
      try {
        await session.login();
        await this.deps.onLogin();
        return await body(session);
      } finally {
        await session.exit();
      }
    };
    if (!queued) return run();
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** The first load waits on an OS keychain prompt; the window says so instead of a bare spinner. */
  waitingForKeychain(): void {
    if (this.snap.phase === "loading" && !this.snap.courses.length) this.set({ phase: "keychain" });
  }

  refresh(): Promise<void> {
    this.refreshing ??= this.load().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async load(): Promise<void> {
    if (this.snap.phase !== "ready") this.set({ phase: "loading", error: null });
    else this.set({ pending: ["lectures", "files"] });
    try {
      // One hidden window for the whole load. Files come before lectures: new files feed
      // [한 번에 끝내기], and lectures need one attendance page per course, which is the slow part.
      await this.withSession(async (session) => {
        await this.loadCourses(session);
        this.set({ phase: "ready", pending: ["files", "lectures"], fetchedAt: new Date().toISOString() });
        await this.loadFiles(session).catch((error) => this.partFailed("files", error));
        this.set({ pending: this.snap.pending.filter((p) => p !== "files") });
        await this.loadLectures(session).catch((error) => this.partFailed("lectures", error));
        this.set({ pending: [] });
      });
    } catch (error) {
      if (error instanceof LoginRequired) this.set({ ...emptySnapshot("login") });
      else this.set({ phase: this.snap.courses.length ? "ready" : "error", pending: [], error: friendly(error) });
    }
  }

  private partFailed(part: LoadPart, error: unknown): void {
    if (error instanceof LoginRequired) throw error;
    this.set({ pending: this.snap.pending.filter((p) => p !== part), error: friendly(error) });
  }

  private async loadCourses(session: ElectronBrowserSession): Promise<void> {
    const raw = await fetchCourses(session);
    this.raws = new Map(raw.map((c) => [String(c.id), c]));
    await this.warmLearningx(session, raw);
    const courses: Course[] = raw.map((c, index) => ({
      id: String(c.id),
      name: displayName(String(c.name ?? "")),
      prof: ((c.teachers ?? []) as Raw[]).map((t) => String(t.display_name ?? "")).filter(Boolean)[0] ?? "",
      hue: ((index % 5) + 1) as Hue,
      aliases: aliasesFor(String(c.name ?? "")),
    }));
    const assignments: Assignment[] = [];
    const notices: Notice[] = [];
    const links: Links = { ...this.links, assignments: new Map(), notices: new Map() };
    const perCourse = await mapLimit(raw, COURSE_CONCURRENCY, async (course) => ({
      course,
      items: await this.courseAssignments(session, course),
      notices: await this.courseNotices(session, course, links),
    }));
    for (const { course, items, notices: courseNotices } of perCourse) {
      const courseId = String(course.id);
      for (const item of items) {
        const due = iso(item.due_at);
        if (!due) continue;
        const id = item.id ? String(item.id) : hash(courseId, item.name, due);
        const sub = isRecord(item.submission) ? item.submission : {};
        const submitted = !!sub.submitted_at || ["submitted", "graded", "complete"].includes(String(sub.workflow_state ?? ""));
        assignments.push({ id, courseId, title: String(item.name ?? item.title ?? "").trim(), due, submitted });
        links.assignments.set(id, String(item.html_url || `${CANVAS_ORIGIN}/courses/${courseId}/assignments`));
      }
      notices.push(...courseNotices);
    }
    this.links = links;
    this.set({ courses, assignments, notices: notices.sort((a, b) => b.postedAt.localeCompare(a.postedAt)) });
  }

  private async courseAssignments(session: ElectronBrowserSession, course: Raw): Promise<Raw[]> {
    try {
      const data = await session.fetchJson(`/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission&order_by=due_at`);
      return Array.isArray(data) ? data.filter(isRecord) : [];
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
      return workItems(await learningxModules(session, course.id));
    }
  }

  private async courseNotices(session: ElectronBrowserSession, course: Raw, links: Links): Promise<Notice[]> {
    const courseId = String(course.id);
    const since = Date.now() - NOTICE_KEEP_DAYS * DAY;
    const newSince = Date.now() - NOTICE_NEW_DAYS * DAY;
    const out: Notice[] = [];
    const add = (id: string, source: string, title: unknown, posted: unknown, body: unknown, readOnSchool: boolean, url: string): void => {
      const postedAt = iso(posted);
      if (!postedAt || Date.parse(postedAt) < since) return;
      out.push({
        id,
        courseId,
        title: String(title ?? "").trim(),
        summary: "",
        body: plainExcerpt(body, NOTICE_BODY_CHARS),
        source,
        postedAt,
        read: readOnSchool || Date.parse(postedAt) < newSince,
      });
      links.notices.set(id, url);
    };
    let topics: Raw[] = [];
    try {
      topics = await fetchRecordingPages(session, `/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=100`);
    } catch (error) {
      if (!isUnauthorized(error)) throw error;
    }
    for (const t of topics) {
      add(`n-${t.id}`, "공지", t.title, t.posted_at || t.created_at, t.message, t.read_state === "read", String(t.html_url || `${CANVAS_ORIGIN}/courses/${courseId}/announcements`));
    }
    for (const post of await staffBoardPosts(session, course, await staffNames(session, course)).catch(() => [] as Raw[])) {
      add(`b-${hash(courseId, post.board, post.id)}`, `게시판 · ${post.board}`, post.title, post.created_at, post.content, false, `${CANVAS_ORIGIN}/courses/${courseId}`);
    }
    return out;
  }

  private async loadLectures(session: ElectronBrowserSession): Promise<void> {
    const lectures: Lecture[] = [];
    const urls = new Map<string, string>();
    const courses = [...this.raws.values()].filter((course) => course.workflow_state !== "unpublished");
    // Module links are plain fetches and can overlap; attendance navigates the window, so it goes one course at a time after them.
    const links = await mapLimit(courses, COURSE_CONCURRENCY, (course) => this.moduleLinks(session, String(course.id)));
    for (const [i, course] of courses.entries()) {
      const courseId = String(course.id);
      const attendance = this.warmAttendance.get(courseId) ?? (await session.fetchAttendance(course.id));
      const pages = links[i]!;
      for (const row of unwatchedRows(course, attendance)) {
        if (!row.available) continue;
        const until = iso(row.due_at) || null;
        if (until && Date.parse(until) < Date.now()) continue;
        const id = hash(courseId, row.week, row.lesson, row.title);
        lectures.push({ id, courseId, week: typeof row.week === "number" ? row.week : null, title: String(row.title), until, available: true });
        urls.set(id, pages.get(normalizeTitle(String(row.title))) ?? `${CANVAS_ORIGIN}/courses/${courseId}/external_tools/${ATTENDANCE_TOOL_ID}`);
      }
    }
    this.links = { ...this.links, lectures: urls };
    this.set({ lectures });
  }

  /**
   * LearningX board reads need the xn_api_token cookie, which only a LearningX tool launch sets. Without it
   * the board posts (notices and files) silently come back empty, so open one course's attendance tab first.
   */
  private async warmLearningx(session: ElectronBrowserSession, raw: Raw[]): Promise<void> {
    this.warmAttendance = new Map();
    if (await session.evaluate("document.cookie.includes('xn_api_token=')").catch(() => false)) return;
    const first = raw.find((course) => course.workflow_state !== "unpublished");
    if (!first) return;
    try {
      this.warmAttendance.set(String(first.id), await session.fetchAttendance(first.id));
    } catch (error) {
      if (!(error instanceof LiveCommandError)) throw error;
    }
  }

  private async moduleLinks(session: ElectronBrowserSession, courseId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    try {
      for (const module of await fetchRecordingPages(session, `/api/v1/courses/${courseId}/modules?per_page=100&include[]=items`)) {
        for (const item of (module.items ?? []) as Raw[]) {
          if (item.type === "ExternalTool" && item.html_url) out.set(normalizeTitle(String(item.title ?? "")), String(item.html_url));
        }
      }
    } catch (error) {
      if (!(error instanceof LiveCommandError)) throw error;
    }
    return out;
  }

  private async loadFiles(session: ElectronBrowserSession): Promise<void> {
    const dest = this.deps.downloadDir();
    const state = readSyncState(dest);
    const files: FileItem[] = [];
    const rows = new Map<string, Raw>();
    const newSince = Date.now() - FILE_NEW_DAYS * DAY;
    const courses = [...this.raws.values()];
    const perCourse = await mapLimit(courses, COURSE_CONCURRENCY, (course) => materialCandidates(session, course, fetchRecordingPages, recordingAccessible));
    for (const [i, course] of courses.entries()) {
      for (const row of perCourse[i]!) {
        const known = state[row.key];
        const downloaded = !!known?.path && existsSync(join(dest, known.path)) && statSync(join(dest, known.path)).isFile() && known.updated_at === row.updated_at;
        const updated = Date.parse(row.updated_at);
        rows.set(row.key, row);
        files.push({
          id: row.key,
          courseId: String(course.id),
          name: row.file,
          folder: (row.folders as string[]).join(" · "),
          size: row.size,
          updatedAt: iso(row.updated_at),
          downloaded,
          available: !!row.download_url,
          isNew: !downloaded && !!row.download_url && Number.isFinite(updated) && updated >= newSince,
        });
      }
    }
    this.links = { ...this.links, files: rows };
    this.set({ files });
  }

  url(kind: "assignment" | "lecture" | "notice", id: string): string | null {
    const map = kind === "assignment" ? this.links.assignments : kind === "lecture" ? this.links.lectures : this.links.notices;
    return map.get(id) ?? null;
  }

  cancelDownloads(): void {
    for (const token of this.downloadTokens) token.canceled = true;
  }

  async download(ids: string[], progress: DownloadProgress): Promise<{ done: number; failed: number; canceled: boolean }> {
    const rows = ids.map((id) => this.links.files.get(id)).filter((row): row is Raw => !!row && !!row.download_url);
    for (const id of ids) if (!rows.some((row) => row.key === id)) progress(id, "failed", "받을 수 없는 자료예요");
    const token = { canceled: false };
    this.downloadTokens.add(token);
    const results = rows.map((row) => new Promise<DownloadResult>((settle) => this.downloadQueue.push({ row, token, progress, settle })));
    this.startDownloads();
    const settled = await Promise.all(results).finally(() => this.downloadTokens.delete(token));
    this.emit();
    const done = settled.filter((r) => r === "done").length;
    const failed = ids.length - rows.length + settled.filter((r) => r === "failed").length;
    return { done, failed, canceled: token.canceled };
  }

  /** One hidden window serves every queued download, a few files at a time, and closes when the queue is empty. */
  private startDownloads(): void {
    if (this.downloadWorker || !this.downloadQueue.length) return;
    const lane = async (session: ElectronBrowserSession): Promise<void> => {
      for (let item = this.downloadQueue.shift(); item; item = this.downloadQueue.shift()) {
        if (item.token.canceled) {
          item.settle("canceled");
          continue;
        }
        item.progress(item.row.key, "active");
        try {
          await syncMaterials(session, [item.row], this.deps.downloadDir(), { termFolders: false });
          this.snap = { ...this.snap, files: this.snap.files.map((f) => (f.id === item!.row.key ? { ...f, downloaded: true, isNew: false } : f)) };
          item.progress(item.row.key, "done");
          item.settle("done");
        } catch (error) {
          if (process.env.KUROWSER_LOG_BLOCKED) console.log(`DOWNLOAD_FAIL ${error instanceof Error ? error.message : String(error)}`);
          item.progress(item.row.key, "failed", friendly(error));
          item.settle("failed");
          if (error instanceof LoginRequired) throw error;
        }
      }
    };
    this.downloadWorker = this.withSession((session) => Promise.all(Array.from({ length: DOWNLOAD_LANES }, () => lane(session))).then(() => undefined), false)
      .catch((error) => {
        for (const item of this.downloadQueue.splice(0)) {
          item.progress(item.row.key, "failed", friendly(error));
          item.settle("failed");
        }
        if (error instanceof LoginRequired) this.set({ ...emptySnapshot("login") });
      })
      .finally(() => {
        this.downloadWorker = null;
        this.startDownloads();
      });
  }

  loggedOut(): void {
    this.links = { assignments: new Map(), lectures: new Map(), notices: new Map(), files: new Map() };
    this.raws.clear();
    this.set({ ...emptySnapshot("login") });
  }
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, "").toLowerCase();
}

function readSyncState(dest: string): Record<string, { path?: string; updated_at?: string }> {
  const path = join(dest, STATE_FILENAME);
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return isRecord(data) && isRecord(data.files) ? data.files : {};
  } catch {
    return {};
  }
}

function friendly(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out|timeout/i.test(message)) return "학교 서버가 늦게 답해서 일부를 못 가져왔어요";
  if (/HTTP 5\d\d/.test(message)) return "학교 서버에 문제가 있어서 일부를 못 가져왔어요";
  return "학교 정보를 가져오지 못했어요";
}
