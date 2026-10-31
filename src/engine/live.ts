/**
 * Live KU LMS provider built on a small, fakeable Chrome DevTools Protocol boundary.
 *
 * The public provider methods intentionally return title/name/status metadata only. Raw LMS
 * identifiers, launch URLs, cookies, headers, tokens, and credential material stay inside the
 * browser session and are never part of CLI payloads.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { decodeHTML } from "entities";

import { publicPost, staffBoardPosts, staffNames } from "./boards.ts";
import { isKoreanCaptionTrack } from "./captions.ts";
import type { KuLmsConfig } from "./config.ts";
import { LiveCommandError } from "./errors.ts";
import { isUnauthorized, modules as learningxModules, workItems } from "./learningx.ts";
import { materialCandidates, publicMaterial, syncMaterials } from "./materials.ts";
import { redactData, redactText } from "./redaction.ts";
import { parseIsoDatetime, pyStr, sleep } from "./util.ts";

export const CANVAS_ORIGIN = "https://mylms.korea.ac.kr";
export const CANVAS_HOSTS: ReadonlySet<string> = new Set(["canvas.korea.ac.kr", "mylms.korea.ac.kr"]);
export const ATTENDANCE_TOOL_ID = 2; // LearningX "출결현황" course tab
export const DEFAULT_ENTRY_URL = "https://canvas.korea.ac.kr/accounts/1/external_tools/9?launch_type=global_navigation";

/** PATH lookup that replaces Bun.which so the engine runs inside Electron's Node. */
function which(command: string): string | null {
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (dir && existsSync(join(dir, command))) return join(dir, command);
  }
  return null;
}

type Raw = Record<string, any>;

export const timing = { sleep };

export interface LiveOptions {
  entryUrl: string;
  headless: boolean;
  timeoutSeconds: number;
  chromePath: string | null;
  attachPort: number | null;
}

export function liveOptions(overrides: Partial<LiveOptions> = {}): LiveOptions {
  return { entryUrl: DEFAULT_ENTRY_URL, headless: true, timeoutSeconds: 60, chromePath: null, attachPort: null, ...overrides };
}

export interface BrowserSession {
  enter(): Promise<BrowserSession>;
  exit(): Promise<void>;
  login(): Promise<void>;
  fetchJson(pathOrUrl: string): Promise<any>;
  getCalendarFeedUrl?(): Promise<string>;
  extractCaptions?(url: string): Promise<Raw[]>;
  fetchAttendance?(courseId: unknown): Promise<Raw>;
  downloadFile?(url: string, target: string): Promise<number>;
  fetchLearningxJson(path: string): Promise<any>;
}

export type SessionFactory = () => BrowserSession;

export async function withSession<T>(factory: SessionFactory, body: (session: BrowserSession) => Promise<T>): Promise<T> {
  const session = await factory().enter();
  try {
    return await body(session);
  } finally {
    await session.exit();
  }
}

const isRecord = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const get = (obj: Raw, key: string, fallback: unknown = null): any => (key in obj ? obj[key] : fallback);

/**
 * Read-only live provider.
 *
 * All browser operations are performed through an async session factory so tests can replace
 * the browser with deterministic fakes.
 */
export class LiveLmsProvider {
  readonly options: LiveOptions;
  readonly sessionFactory: SessionFactory;

  constructor(
    readonly config: KuLmsConfig,
    options?: LiveOptions,
    sessionFactory?: SessionFactory,
  ) {
    this.options = options ?? liveOptions();
    this.sessionFactory = sessionFactory ?? (() => new CdpBrowserSession(config, this.options));
  }

  private loggedIn<T>(body: (session: BrowserSession) => Promise<T>): Promise<T> {
    return withSession(this.sessionFactory, async (session) => {
      await session.login();
      return body(session);
    });
  }

  courses(): Promise<Raw[]> {
    return runLive(() => this.loggedIn(async (session) => (await fetchCourses(session)).map(publicCourse)));
  }

  assignments(courseQuery: string): Promise<Raw[]> {
    return runLive(async () => {
      const assignments = await this.loggedIn(async (session) => {
        const course = await selectCourse(session, courseQuery);
        try {
          return await session.fetchJson(`/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission`);
        } catch (error) {
          if (!isUnauthorized(error)) throw error;
          return workItems(await learningxModules(session, course.id));
        }
      });
      if (!Array.isArray(assignments)) throw new LiveCommandError("assignment API returned an unexpected shape");
      return assignments.filter(isRecord).map(publicAssignment);
    });
  }

  async deadlines(courseQuery: string): Promise<Raw[]> {
    return (await this.assignments(courseQuery)).map((item) => ({
      title: item.title,
      due_at: get(item, "due_at"),
      remaining_candidate: get(item, "remaining_candidate", false),
    }));
  }

  calendarEvents(startDate = "", endDate = "", courseQuery = ""): Promise<Raw[]> {
    return runLive(async () => {
      const events = await this.loggedIn(async (session) => {
        const params = new URLSearchParams([["per_page", "100"], ["type", "assignment"], ["type", "event"]]);
        if (startDate) params.append("start_date", startDate);
        if (endDate) params.append("end_date", endDate);
        if (courseQuery) {
          const course = await selectCourse(session, courseQuery);
          params.append("context_codes[]", `course_${course.id}`);
        }
        return session.fetchJson("/api/v1/calendar_events?" + params.toString());
      });
      if (!Array.isArray(events)) throw new LiveCommandError("calendar events API returned an unexpected shape");
      return events.filter(isRecord).map(publicCalendarEvent);
    });
  }

  calendarUpcoming(startDate = "", endDate = ""): Promise<Raw[]> {
    return runLive(async () => {
      const items = await this.loggedIn(async (session) => {
        const params = new URLSearchParams([["per_page", "100"]]);
        if (startDate) params.append("start_date", startDate);
        if (endDate) params.append("end_date", endDate);
        return session.fetchJson("/api/v1/planner/items?" + params.toString());
      });
      if (!Array.isArray(items)) throw new LiveCommandError("planner API returned an unexpected shape");
      return items.filter(isRecord).map(publicPlannerItem);
    });
  }

  calendarTodo(): Promise<Raw[]> {
    return runLive(async () => {
      const items = await this.loggedIn((session) => session.fetchJson("/api/v1/users/self/todo?per_page=100"));
      if (!Array.isArray(items)) throw new LiveCommandError("todo API returned an unexpected shape");
      return items.filter(isRecord).map(publicTodoItem);
    });
  }

  calendarFeed(delivery = "inspect"): Promise<Raw> {
    return runLive(async () => {
      if (!["inspect", "copy", "open", "open_google"].includes(delivery)) throw new LiveCommandError("unsupported calendar feed delivery");
      const feedUrl = await this.loggedIn((session) => session.getCalendarFeedUrl!());
      if (!feedUrl || !feedUrl.endsWith(".ics")) throw new LiveCommandError("calendar feed URL was not found");
      const urlShape = feedUrlShape(feedUrl);
      if (delivery === "copy") {
        const [copied, detail] = desktop.copyToClipboard(feedUrl);
        if (!copied) throw new LiveCommandError(`calendar feed URL was found but clipboard copy failed: ${detail}`);
        return { delivery: "copy", copied: true, opened: false, url_shape: urlShape, raw_url_printed: false };
      }
      if (delivery === "open") {
        return { delivery: "open", copied: false, opened: desktop.openBrowser(feedUrl), url_shape: urlShape, raw_url_printed: false };
      }
      if (delivery === "open_google") {
        const googleUrl = "https://calendar.google.com/calendar/r?cid=" + pyQuote(feedUrl);
        return { delivery: "open_google", copied: false, opened: desktop.openBrowser(googleUrl), url_shape: urlShape, raw_url_printed: false };
      }
      return { delivery: "inspect", copied: false, opened: false, url_shape: urlShape, raw_url_printed: false };
    });
  }

  recordings(courseQuery: string): Promise<Raw[]> {
    return runLive(() =>
      this.loggedIn(async (session) => (await recordingCandidates(session, await selectCourse(session, courseQuery))).map(publicRecording)),
    );
  }

  recordingCaptions(courseQuery: string, titleQuery = ""): Promise<Raw> {
    return runLive(async () => {
      const found = await this.loggedIn(async (session) => {
        const course = await selectCourse(session, courseQuery);
        const candidates = await recordingCandidates(session, course);
        const recordings = titleQuery ? [selectRecording(candidates, titleQuery)] : candidates;
        for (const recording of recordings) {
          const captions = (await session.extractCaptions!(recording.url)).filter((caption) => isKoreanCaptionTrack(caption));
          if (captions.length) return publicCaptions(recording, captions);
        }
        return null;
      });
      if (found) return found;
      const detail = titleQuery ? "selected recording page" : "recordings in the selected course";
      throw new LiveCommandError(`no official Korean captions were found on ${detail}`);
    });
  }

  unwatchedRecordings(courseQuery = ""): Promise<Raw[]> {
    return runLive(async () => {
      const rows = await this.loggedIn(async (session) => {
        const courses = courseQuery ? [await selectCourse(session, courseQuery)] : await fetchCourses(session);
        const out: Raw[] = [];
        for (const course of courses) {
          if (course.workflow_state === "unpublished") continue; // Its attendance tab renders Canvas "Not Yet Available" and would time out.
          out.push(...unwatchedRows(course, await session.fetchAttendance!(course.id)));
        }
        return out;
      });
      return rows.sort((a, b) =>
        compareTuples([a.due_at || "~", a.course, a.week || 0, a.lesson || 0], [b.due_at || "~", b.course, b.week || 0, b.lesson || 0]),
      );
    });
  }

  materials(courseQuery = ""): Promise<Raw[]> {
    return runLive(async () => {
      return (await this.materialRows(courseQuery, null)).map(publicMaterial);
    });
  }

  syncMaterials(dest: string, courseQuery = ""): Promise<Raw> {
    return runLive(() => this.materialRows(courseQuery, dest));
  }

  private async materialRows(courseQuery: string, dest: null): Promise<Raw[]>;
  private async materialRows(courseQuery: string, dest: string): Promise<Raw>;
  private async materialRows(courseQuery: string, dest: string | null): Promise<any> {
    return this.loggedIn(async (session) => {
      const courses = courseQuery ? [await selectCourse(session, courseQuery)] : await fetchCourses(session);
      const rows: Raw[] = [];
      for (const course of courses) rows.push(...(await materialCandidates(session, course, fetchRecordingPages, recordingAccessible)));
      return dest === null ? rows : syncMaterials(session, rows, dest);
    });
  }

  notices(courseQuery = ""): Promise<Raw[]> {
    return runLive(async () => {
      const rows = await this.loggedIn(async (session) => {
        const courses = courseQuery ? [await selectCourse(session, courseQuery)] : await fetchCourses(session);
        const out: Raw[] = [];
        let stream: Raw[] | null = null;
        for (const course of courses) {
          let announcements: Raw[];
          try {
            announcements = await fetchRecordingPages(session, `/api/v1/courses/${course.id}/discussion_topics?only_announcements=true&per_page=100`);
          } catch (error) {
            if (!isUnauthorized(error)) throw error;
            // Unpublished courses deny course announcements (and /announcements returns []),
            // but the student's own activity stream still carries their recent announcements.
            stream ??= await fetchRecordingPages(session, "/api/v1/users/self/activity_stream?per_page=100");
            announcements = stream.filter((item) => item.type === "Announcement" && item.course_id === course.id);
          }
          for (const topic of announcements) {
            out.push(publicPost(course, "공지", topic.title, topic.posted_at || topic.created_at, topic.message, (topic.attachments || []).length));
          }
          for (const post of await staffBoardPosts(session, course, await staffNames(session, course))) {
            out.push(publicPost(course, `게시판 · ${post.board}`, post.title, post.created_at, post.content, Math.trunc(Number(post.attachment_count || 0))));
          }
        }
        return out;
      });
      return stableSortDesc(rows, (row) => row.posted_at);
    });
  }
}

function stableSortDesc<T>(rows: T[], key: (row: T) => string): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (key(a.row) < key(b.row) ? 1 : key(a.row) > key(b.row) ? -1 : a.index - b.index))
    .map(({ row }) => row);
}

function compareTuples(a: unknown[], b: unknown[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as any;
    const y = b[i] as any;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export const COURSES_PATH =
  "/api/v1/courses?per_page=100&enrollment_state=active&state[]=available&state[]=unpublished&include[]=term&include[]=teachers";

export async function fetchCourses(session: Pick<BrowserSession, "fetchJson">): Promise<Raw[]> {
  const data = await session.fetchJson(COURSES_PATH);
  if (!Array.isArray(data)) throw new LiveCommandError("courses API returned an unexpected shape");
  const courses = data.filter((item): item is Raw => isRecord(item) && !!item.id && !!item.name && currentCourse(item));
  if (!courses.length) throw new LiveCommandError("no active courses found");
  return courses;
}

function currentCourse(course: Raw): boolean {
  if (course.workflow_state !== "unpublished") return true;
  const endAt = (course.term || {}).end_at;
  if (!endAt) return false;
  const parsed = parseIsoDatetime(String(endAt).replace("Z", "+00:00"));
  return !!parsed && parsed.epochMs > Date.now();
}

export async function selectCourse(session: Pick<BrowserSession, "fetchJson">, query: string): Promise<Raw> {
  if (!query) throw new LiveCommandError("--course is required in live mode");
  const courses = await fetchCourses(session);
  const matches = courses.filter((course) => matchesQuery(query, String(get(course, "name", ""))));
  if (!matches.length) {
    const names = courses.slice(0, 10).map((course) => String(get(course, "name", ""))).join(", ");
    throw new LiveCommandError(`course not found; available course names include: ${names}`);
  }
  if (matches.length > 1) {
    const exact = matches.filter((course) => String(get(course, "name", "")).trim().toLowerCase() === query.trim().toLowerCase());
    if (exact.length === 1) return exact[0]!;
    const names = matches.slice(0, 10).map((course) => String(get(course, "name", ""))).join(", ");
    throw new LiveCommandError(`course query is ambiguous; matches: ${names}`);
  }
  return matches[0]!;
}

export async function recordingCandidates(session: Pick<BrowserSession, "fetchJson">, course: Raw): Promise<Raw[]> {
  const modules = await fetchRecordingPages(session, `/api/v1/courses/${course.id}/modules?per_page=100&include[]=items`);
  const candidates: Raw[] = [];
  for (const module of modules) {
    if (!isRecord(module) || !recordingAccessible(module)) continue;
    const moduleName = String(module.name || "");
    let items: Raw[] = module.items || [];
    if (get(module, "items_count", items.length) > items.length || (!("items" in module) && get(module, "items_count") !== 0)) {
      items = await fetchRecordingPages(session, `/api/v1/courses/${course.id}/modules/${module.id}/items?per_page=100`);
    }
    for (const item of items) {
      if (!isRecord(item) || !recordingAccessible(item)) continue;
      const title = String(item.title || "");
      const itemType = String(item.type || "");
      const url = String(item.html_url || item.url || "");
      if (itemType !== "ExternalTool" || !url || looksLikeHandout(title)) continue;
      candidates.push({ module: moduleName, title, type: itemType, url });
    }
  }
  if (!candidates.length) throw new LiveCommandError(`no recording candidates found for course ${get(course, "name", "")}`);
  return candidates;
}

export async function fetchRecordingPages(session: Pick<BrowserSession, "fetchJson">, path: string): Promise<Raw[]> {
  const rows: Raw[] = [];
  for (let page = 1; ; page++) {
    const data = await session.fetchJson(page === 1 ? path : `${path}&page=${page}`);
    if (!Array.isArray(data)) throw new LiveCommandError("recordings API returned an unexpected shape");
    rows.push(...data.filter(isRecord));
    if (data.length < 100) return rows;
  }
}

/** Respect Canvas availability metadata; unknown dates fail closed. */
export function recordingAccessible(item: Raw): boolean {
  const details = item.content_details || {};
  const now = Date.now();
  for (const value of [item, details]) {
    if (value.published === false || value.locked_for_user || value.state === "locked") return false;
    for (const key of ["unlock_at", "lock_at"]) {
      const raw = value[key];
      if (!raw) continue;
      const parsed = parseIsoDatetime(String(raw).replace("Z", "+00:00"));
      if (!parsed) return false;
      if ((key === "unlock_at" && parsed.epochMs > now) || (key === "lock_at" && parsed.epochMs <= now)) return false;
    }
  }
  return true;
}

export function selectRecording(candidates: Raw[], query: string): Raw {
  if (!query) throw new LiveCommandError("--title is required for live recording playback");
  const title = (item: Raw) => String(get(item, "title", ""));
  const matches = candidates.filter((item) => matchesQuery(query, title(item)) || matchesQuery(query, String(get(item, "module", ""))));
  if (!matches.length) {
    throw new LiveCommandError(`recording not found; available titles include: ${candidates.slice(0, 10).map(title).join(", ")}`);
  }
  if (matches.length > 1) {
    const normalized = query.trim().toLowerCase();
    const exact = matches.filter((item) => title(item).trim().toLowerCase() === normalized);
    if (exact.length) return exact[0]!;
    const byLength = (items: Raw[]) => [...items].sort((a, b) => title(a).length - title(b).length)[0]!;
    const prefix = matches.filter((item) => title(item).trim().toLowerCase().startsWith(normalized));
    if (prefix.length) return byLength(prefix);
    return byLength(matches);
  }
  return matches[0]!;
}

function publicCourse(course: Raw): Raw {
  return { name: get(course, "name", ""), workflow_state: get(course, "workflow_state", ""), default_view: get(course, "default_view", "") };
}

function publicAssignment(item: Raw): Raw {
  const dueAt = item.due_at || "";
  const submission = isRecord(item.submission) ? item.submission : {};
  const locked = !!item.locked_for_user;
  const submittedAt = submission.submitted_at || "";
  const workflow = submission.workflow_state || "";
  return {
    title: item.name || item.title || "",
    due_at: dueAt,
    unlock_at: item.unlock_at || "",
    lock_at: item.lock_at || "",
    points_possible: get(item, "points_possible"),
    published: !!get(item, "published", true),
    locked_for_user: locked,
    submission_workflow_state: workflow,
    submitted_at: submittedAt,
    missing: !!get(submission, "missing", false),
    late: !!get(submission, "late", false),
    submission_types: ((item.submission_types || []) as unknown[]).map((value) => pyStr(value)),
    remaining_candidate: remainingCandidate(dueAt, locked, submittedAt, workflow),
  };
}

function publicCalendarEvent(item: Raw): Raw {
  return {
    title: item.title || item.name || "",
    start_at: item.start_at || item.all_day_date || "",
    end_at: item.end_at || "",
    type: item.type || item.workflow_state || "event",
    context_name: item.context_name || item.effective_context_code || "",
    all_day: !!get(item, "all_day", false),
    location_name: item.location_name || "",
  };
}

function publicPlannerItem(item: Raw): Raw {
  const plannable = isRecord(item.plannable) ? item.plannable : {};
  const submissions = isRecord(item.submissions) ? item.submissions : {};
  return {
    title: plannable.title || plannable.name || item.title || "",
    date: item.plannable_date || plannable.due_at || "",
    type: item.plannable_type || plannable.type || "",
    course: item.context_name || "",
    submitted: !!(submissions.submitted || submissions.submitted_at),
    new_activity: !!get(item, "new_activity", false),
  };
}

function publicTodoItem(item: Raw): Raw {
  const assignment = isRecord(item.assignment) ? item.assignment : {};
  return {
    title: assignment.name || assignment.title || item.type || "",
    due_at: assignment.due_at || "",
    type: item.type || "",
    course: item.context_name || "",
    ignore: !!get(item, "ignore", false),
  };
}

const WATCHED_ATTENDANCE_STATUSES = new Set(["attendance", "late", "excused"]);

export function unwatchedRows(course: Raw, attendance: Raw): Raw[] {
  const items: Raw[] = (attendance.attendance_items || {}).attendance_items || [];
  const summaries: Raw = (attendance.summary || {}).attendance_summaries || {};
  const rows: Raw[] = [];
  for (const item of items) {
    if (item.item_content_type !== "commons" || !item.use_attendance) continue;
    const status = (summaries[pyStr(get(item, "item_id"))] || {}).attendance_status || "none";
    if (WATCHED_ATTENDANCE_STATUSES.has(status)) continue;
    rows.push({
      course: String(get(course, "name", "")),
      week: get(item, "week_position"),
      lesson: get(item, "lesson_position"),
      title: String(item.title || ""),
      attendance_status: status,
      available: item.lecture_period_status !== "not_open",
      due_at: get(item, "due_at"),
    });
  }
  return rows;
}

function publicRecording(item: Raw): Raw {
  return { module: get(item, "module", ""), title: get(item, "title", ""), type: get(item, "type", ""), playable: true };
}

function publicCaptions(recording: Raw, captions: Raw[]): Raw {
  const tracks: Raw[] = [];
  for (const item of captions) {
    const text = String(item.text || "").trim();
    if (!text) continue;
    tracks.push({
      label: item.label || "",
      language: item.language || "",
      format: item.format || captionFormatFromText(text),
      source: item.source || "official_caption",
      char_count: [...text].length,
      text,
    });
  }
  return redactData({
    module: get(recording, "module", ""),
    title: get(recording, "title", ""),
    track_count: tracks.length,
    tracks,
    raw_urls_printed: false,
  }) as Raw;
}

function captionFormatFromText(text: string): string {
  const sample = lstripChars(text, "\ufeff\n\r\t ");
  if (sample.startsWith("WEBVTT")) return "vtt";
  if (/^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+/m.test(sample)) return "srt";
  if (sample.startsWith("<?xml") || sample.slice(0, 200).includes("<tt ") || sample.slice(0, 200).includes("<transcript")) return "xml";
  return "text";
}

function dedupeCaptions(captions: Raw[]): Raw[] {
  const seen = new Set<string>();
  const unique: Raw[] = [];
  for (const item of captions) {
    const text = String(item.text || "").trim();
    if (!text) continue;
    const key = JSON.stringify([String(item.label || ""), String(item.language || ""), [...text].slice(0, 500).join("")]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...item, text });
  }
  return unique;
}

export function remainingCandidate(dueAt: string, locked: boolean, submittedAt: string, workflow: string): boolean {
  if (locked || submittedAt || workflow === "submitted" || workflow === "graded" || !dueAt) return false;
  const due = parseIsoDatetime(String(dueAt).replace("Z", "+00:00"));
  return !!due && due.epochMs > Date.now();
}

function looksLikeHandout(title: string): boolean {
  const compact = title.replaceAll(" ", "");
  return compact.includes("교안") || compact.includes("강의자료") || compact === "자료";
}

function matchesQuery(query: string, value: string): boolean {
  return value.trim().toLowerCase().includes(query.trim().toLowerCase());
}

function lstripChars(value: string, chars: string): string {
  let start = 0;
  while (start < value.length && chars.includes(value[start]!)) start++;
  return value.slice(start);
}

/** urllib.parse.quote(value, safe=""). */
function pyQuote(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase());
}

export function feedUrlShape(url: string): string {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(url);
  if (!match) return url.split(/[?#;]/)[0]!;
  let path = match[3]!;
  if (path.includes("/feeds/calendars/") && path.endsWith(".ics")) path = "/feeds/calendars/[REDACTED-FEED-TOKEN].ics";
  return `${match[1]}://${match[2]}${path}`;
}

const CLIPBOARD_COMMANDS = [
  ["pbcopy"],
  ["wl-copy"],
  ["xclip", "-selection", "clipboard"],
  ["xsel", "--clipboard", "--input"],
  ["clip.exe"],
  ["powershell.exe", "-NoProfile", "-Command", "Set-Clipboard"],
  ["termux-clipboard-set"],
];

function copyToClipboard(text: string): [boolean, string] {
  for (const command of CLIPBOARD_COMMANDS) {
    if (!which(command[0]!)) continue;
    const result = spawnSync(command[0]!, command.slice(1), { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 5000 });
    if (result.status === 0) return [true, command[0]!];
  }
  return [false, "no supported clipboard command found"];
}

function openBrowser(url: string): boolean {
  const candidates = process.platform === "darwin" ? [["open"]] : process.platform === "win32" ? [["cmd", "/c", "start", ""]] : [["xdg-open"], ["wslview"]];
  for (const command of candidates) {
    if (!which(command[0]!)) continue;
    try {
      spawn(command[0]!, [...command.slice(1), url], { detached: true, stdio: "ignore" }).unref();
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

/** Desktop handoff seams; tests replace them so no clipboard or browser is touched. */
export const desktop = { copyToClipboard, openBrowser };

/** Convert internal/browser failures into safe output, like the original `_run`. */
export async function runLive<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof LiveCommandError) throw error;
    const message = error instanceof Error ? error.message || error.name : String(error);
    throw new LiveCommandError(redactText(message));
  }
}

function looksLikeCaptionResponse(url: string, mime: string): boolean {
  const lowerUrl = url.toLowerCase();
  const lowerMime = mime.toLowerCase();
  if (["text/vtt", "application/x-subrip", "application/ttml", "application/dfxp", "text/srt"].some((kind) => lowerMime.includes(kind))) return true;
  const bare = lowerUrl.split("?")[0]!;
  if ([".vtt", ".srt", ".ttml", ".dfxp", ".smi", ".sami"].some((ext) => bare.endsWith(ext))) return true;
  return (
    ["caption", "subtitle", "subtitles", "transcript", "media_script", "script_list", "vtt"].some((token) => lowerUrl.includes(token)) &&
    ["text", "json", "xml", "octet-stream"].some((kind) => lowerMime.includes(kind))
  );
}

function captionFormatFromUrlOrMime(url: string, mime: string): string {
  const lowered = `${url} ${mime}`.toLowerCase();
  if (lowered.includes("vtt")) return "vtt";
  if (lowered.includes("srt") || lowered.includes("subrip")) return "srt";
  if (lowered.includes("ttml") || lowered.includes("dfxp") || lowered.includes("xml")) return "xml";
  if (lowered.includes("json")) return "json";
  return "text";
}

export function normalizeCaptionItem(item: Raw): Raw | null {
  const rawText = String(item.text || "");
  const text = captionBodyToPlainText(rawText);
  if (!text || containsSecretLikeCaptionText(text)) return null;
  return {
    label: item.label || "",
    language: item.language || "",
    format: item.format || captionFormatFromText(rawText),
    source: item.source || "official_caption",
    text,
  };
}

function captionBodyToPlainText(text: string): string {
  const sample = lstripChars(text, "\ufeff\n\r\t ");
  const lowered = sample.slice(0, 2000).toLowerCase();
  if (!sample.trim() || lowered.includes("<html") || sample.includes("잘못된 요청")) return "";
  if (looksLikeJavascriptBody(sample)) return "";
  if (sample.startsWith("WEBVTT") || sample.slice(0, 2000).includes("-->")) return plainCaptionLines(sample);
  if (sample[0] === "[" || sample[0] === "{") return plainCaptionJson(sample);
  if (sample.includes("<") && sample.includes(">")) {
    const xmlish = decodeHTML(sample)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "\n")
      .replace(/<[^>]+>/g, "\n");
    return plainCaptionLines(xmlish);
  }
  return sample.trim().length >= 2 ? plainCaptionLines(sample) : "";
}

function plainCaptionJson(text: string): string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return "";
  }
  const values: string[] = [];
  const keys = new Set(["text", "caption", "subtitle", "transcript", "script", "body"]);
  const visit = (value: unknown, key = ""): void => {
    if (Array.isArray(value)) value.forEach((child) => visit(child, key));
    else if (isRecord(value)) for (const [childKey, child] of Object.entries(value)) visit(child, childKey.toLowerCase());
    else if (typeof value === "string" && keys.has(key)) values.push(value);
  };
  visit(data);
  return plainCaptionLines(values.join("\n"));
}

function plainCaptionLines(text: string): string {
  const lines: string[] = [];
  let inBlock = "";
  for (const raw of text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")) {
    const line = decodeHTML(lstripChars(raw.trim(), "\ufeff"));
    const upper = line.toUpperCase();
    if (inBlock) {
      if (!line) inBlock = "";
      continue;
    }
    const blockStart = upper.startsWith("STYLE") || upper.startsWith("REGION") || upper.startsWith("NOTE");
    if (!line || upper === "WEBVTT" || blockStart) {
      if (blockStart) inBlock = upper.split(/\s+/)[0]!;
      if (lines.length && lines[lines.length - 1]) lines.push("");
      continue;
    }
    if (line.includes("-->") || /^\p{Nd}+$/u.test(line)) continue;
    // Cue identifiers sit directly above a timestamp; keep only lines that look like transcript text.
    if (/^[A-Za-z0-9_.:-]{1,80}$/.test(line) && !/[가-힣\s.,!?]/.test(line)) continue;
    const clean = line.replace(/<[^>]+>/g, "").trim();
    if (clean) lines.push(clean);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return lines.join("\n");
}

function looksLikeJavascriptBody(text: string): boolean {
  const sample = text.slice(0, 2000);
  if (/^\s*(var|let|const|function|import|export)\b/m.test(sample)) return true;
  return (
    /^\s*(window|document|globalThis|self)\./m.test(sample) ||
    /=>\s*[{(]/.test(sample) ||
    (/[{};]\s*(?:$|\n)/.test(sample) && /=|\(|\)/.test(sample))
  );
}

function containsSecretLikeCaptionText(text: string): boolean {
  return redactText(text) !== text;
}

// The bundler inlines these page scripts as text, so the packaged app needs no loose files.
import EXTERNAL_TOOL_OPEN_SCRIPT from "./scripts/external_tool_open.js" with { type: "text" };
import OPEN_CAPTION_PANEL_SCRIPT from "./scripts/open_caption_panel.js" with { type: "text" };
import CAPTION_EXTRACTION_SCRIPT from "./scripts/caption_extraction.js" with { type: "text" };

const LOGIN_STATE_SCRIPT = String.raw`
(() => ({
  href: location.href,
  title: document.title,
  hasPassword: !!document.querySelector('input[type="password"],#password,input[name="user_password"]'),
  hasText: !!(document.querySelector('#one_id') || document.querySelector('input[name="one_id"]') || document.querySelector('input[type="text"]')),
  bodyText: (document.body && document.body.innerText || '').slice(0, 2000)
}))()
`;

const CANVAS_SESSION_READY_SCRIPT = String.raw`
(async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const url = new URL('/api/v1/users/self/profile', location.origin).href;
    const r = await fetch(url, {credentials: 'include', signal: controller.signal});
    return r.ok;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
})()
`;

const CALENDAR_FEED_BUTTON_SCRIPT = String.raw`
(() => {
  const textOf = (el) => (el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || el.title || '').trim().replace(/\s+/g, ' ');
  const candidates = Array.from(document.querySelectorAll('button,a,input,[role="button"]'));
  const target = candidates.find((el) => textOf(el) === '캘린더 피드' || /calendar feed/i.test(textOf(el)));
  if (!target) return false;
  target.click();
  return true;
})()
`;

const CALENDAR_FEED_URL_SCRIPT = String.raw`
(() => {
  const input = document.querySelector('#calendar-feed-url-input') || Array.from(document.querySelectorAll('input,textarea')).find((el) => String(el.value || '').includes('/feeds/calendars/') && String(el.value || '').endsWith('.ics'));
  if (input && input.value) return input.value;
  const link = Array.from(document.querySelectorAll('a')).find((el) => String(el.href || '').includes('/feeds/calendars/') && String(el.href || '').endsWith('.ics'));
  return link ? link.href : '';
})()
`;

const IFRAME_SRC_SCRIPT = String.raw`
(() => {
  const frames = Array.from(document.querySelectorAll('iframe[src]'));
  const target = frames.find((frame) => {
    const src = String(frame.src || '');
    return src && !src.startsWith('about:') && !src.includes('post_message_forwarding');
  });
  return target ? target.src : '';
})()
`;

const POSTPONE_PASSWORD_CHANGE_SCRIPT = String.raw`
(() => {
  if (typeof window.changePwdLater !== 'function') return 'missing';
  setTimeout(() => window.changePwdLater(), 0);
  return 'postponed';
})()
`;

const CLICK_LOGIN_CANDIDATE_SCRIPT = String.raw`
(() => {
  const candidates = Array.from(document.querySelectorAll('a,button,input[type="button"],input[type="submit"]'));
  const target = candidates.find((el) => /로그인|login|portal|포털|kupid/i.test(el.innerText || el.value || el.getAttribute('aria-label') || ''));
  if (target) { setTimeout(() => target.click(), 0); return 'clicked'; }
  return 'none';
})()
`;

const fetchJsonScript = (expr: string) => `
(async () => {
  const url = new URL(${expr}, location.origin).href;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(url, {credentials: 'include', signal: controller.signal});
    const text = await r.text();
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(timer);
  }
})()
`;

const fetchLearningxJsonScript = (expr: string) => `
(async () => {
  const token = (document.cookie.match(/(?:^|; )xn_api_token=([^;]+)/) || [])[1];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const r = await fetch(new URL(${expr}, location.origin).href, {
      credentials: 'include',
      headers: token ? {Authorization: 'Bearer ' + token} : {},
      signal: controller.signal,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
})()
`;

const submitCredentialsScript = (user: string, pwd: string) => `
(() => {
  const id = document.querySelector('#ipt_id') || document.querySelector('#one_id') || document.querySelector('input[name="one_id"]') || document.querySelector('input[type="text"]');
  const pwd = document.querySelector('#ipt_password') || document.querySelector('#password') || document.querySelector('input[name="user_password"]') || document.querySelector('input[type="password"]');
  if (!id || !pwd) return 'missing-inputs';
  id.focus(); id.value = ${user}; id.dispatchEvent(new Event('input', {bubbles:true})); id.dispatchEvent(new Event('change', {bubbles:true}));
  pwd.focus(); pwd.value = ${pwd}; pwd.dispatchEvent(new Event('input', {bubbles:true})); pwd.dispatchEvent(new Event('change', {bubbles:true}));
  const button = document.querySelector('button[type="submit"],input[type="submit"],.btn_primary,.login_btn,.btn_login');
  setTimeout(() => {
    if (typeof window.doLogin === 'function') window.doLogin();
    else if (button) button.click();
    else if (pwd.form) pwd.form.submit();
  }, 0);
  return 'submitted';
})()
`;

/** Minimal CDP browser session used by live CLI mode. */
export class CdpBrowserSession implements BrowserSession {
  profileDir: string | null = null;
  port: number | null = null;
  protected client: CdpTransport | null = null;
  private proc: ChildProcess | null = null;
  private procExited: Promise<void> | null = null;
  private attachedTarget: string | null = null;

  get attachedTargetId(): string | null {
    return this.attachedTarget;
  }
  private captionRequests: Array<Record<string, string>> = [];

  constructor(
    readonly config: KuLmsConfig,
    readonly options: LiveOptions,
  ) {}

  async enter(): Promise<this> {
    if (this.options.attachPort !== null) return this.attach(this.options.attachPort);
    try {
      this.profileDir = mkdtempSync(join(tmpdir(), "ku-lms-cdp-"));
      const port = await freePort();
      const chrome = this.options.chromePath || process.env.KU_LMS_CHROME || defaultChromePath();
      if (!chrome) throw new LiveCommandError("Chrome/headless_shell executable was not found; set KU_LMS_CHROME");
      const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${this.profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ];
      if (this.options.headless) args.push("--headless=new");
      args.push("about:blank");
      const proc = spawn(chrome, args, { stdio: "ignore", detached: true });
      this.procExited = new Promise((resolve) => proc.once("exit", () => resolve()));
      await new Promise<void>((resolve, reject) => {
        proc.once("spawn", resolve);
        proc.once("error", reject);
      });
      this.proc = proc;
      this.port = port;
      await this.connect(await waitForPageWs(port, this.options.timeoutSeconds));
      return this;
    } catch (error) {
      await this.exit();
      throw error;
    }
  }

  /** Use a fresh tab in a browser owned by `session start`; only that tab is closed on exit. */
  private async attach(port: number): Promise<this> {
    this.port = port;
    let wsUrl: string | null;
    try {
      wsUrl = await createPage(port);
    } catch {
      throw new LiveCommandError("login session browser is not reachable; run session stop, then session start");
    }
    if (!wsUrl) throw new LiveCommandError("login session browser did not open a tab");
    this.attachedTarget = wsUrl.split("/").pop() ?? null;
    try {
      await this.connect(wsUrl);
    } catch (error) {
      await this.exit();
      throw error;
    }
    return this;
  }

  private async connect(wsUrl: string): Promise<void> {
    await this.useTransport(await CdpClient.connect(wsUrl));
  }

  /** Enable the CDP domains the engine reads; any transport (websocket or Electron debugger) works. */
  protected async useTransport(transport: CdpTransport): Promise<void> {
    this.client = transport;
    await this.client.send("Page.enable");
    await this.client.send("Runtime.enable");
    await this.client.send("Network.enable");
    try {
      await this.client.send("Media.enable");
    } catch (error) {
      if (!(error instanceof LiveCommandError)) throw error;
    }
  }

  async exit(): Promise<void> {
    if (this.client) await this.client.close();
    if (this.attachedTarget) {
      // The shared browser may already be gone; its owner then removes everything.
      await fetch(`http://127.0.0.1:${this.port}/json/close/${this.attachedTarget}`, { signal: AbortSignal.timeout(2000) }).catch(() => undefined);
    }
    const proc = this.proc;
    if (proc?.pid) {
      proc.kill("SIGTERM");
      const exited = await Promise.race([this.procExited!.then(() => true), sleep(5).then(() => false)]);
      if (!exited) {
        proc.kill("SIGKILL");
        await Promise.race([this.procExited!, sleep(5)]);
      }
      // Chrome helpers (network service, crashpad) outlive the browser and keep writing the profile.
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // The process group is already gone.
      }
    }
    if (this.profileDir) rmSync(this.profileDir, { recursive: true, force: true });
  }

  async login(): Promise<void> {
    if (this.options.attachPort !== null) {
      await this.goto(CANVAS_ORIGIN);
      if (await this.canvasSessionReady()) return;
    }
    await this.goto(this.options.entryUrl);
    const deadline = performance.now() + this.options.timeoutSeconds * 1000;
    let lastState = "";
    while (performance.now() < deadline) {
      let state: any;
      try {
        state = await this.evaluate(LOGIN_STATE_SCRIPT, { timeout: 10 });
      } catch (error) {
        if (!(error instanceof LiveCommandError)) throw error;
        await timing.sleep(2.0);
        continue;
      }
      const href = isRecord(state) ? String(get(state, "href", "")) : "";
      const parsed = safeUrl(href);
      if (parsed && CANVAS_HOSTS.has(parsed.hostname) && !parsed.pathname.toLowerCase().includes("login")) {
        if (await this.canvasSessionReady()) return;
        await timing.sleep(1.0);
        continue;
      }
      if (isRecord(state) && state.hasPassword) {
        if (this.takePasswordChangePrompt()) await this.postponePasswordChange();
        else await this.submitCredentials();
        await timing.sleep(5.0);
      } else {
        await this.clickLoginCandidate();
        await timing.sleep(1.0);
      }
      lastState = href || pyStr(state).slice(0, 120);
    }
    throw new LiveCommandError(`login did not complete before timeout; last page: ${redactText(lastState)}`);
  }

  async goto(url: string): Promise<void> {
    await this.requireClient().send("Page.navigate", { url });
    await timing.sleep(1.5);
  }

  async evaluate(expression: string, options: { timeout?: number } = {}): Promise<any> {
    const response = await this.requireClient().send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      { timeout: options.timeout || this.options.timeoutSeconds },
    );
    const result = isRecord(response) ? response.result || {} : {};
    const secrets = [this.config.userId, this.config.password];
    if ("exceptionDetails" in response) throw new LiveCommandError(redactText(response.exceptionDetails, secrets));
    if (result.subtype === "error") throw new LiveCommandError(redactText(get(result, "description", "browser evaluation failed"), secrets));
    return result.value;
  }

  fetchJson(pathOrUrl: string): Promise<any> {
    return this.evaluate(fetchJsonScript(JSON.stringify(pathOrUrl)), { timeout: Math.min(this.options.timeoutSeconds, 25) });
  }

  async getCalendarFeedUrl(): Promise<string> {
    await this.goto(`${CANVAS_ORIGIN}/calendar`);
    await timing.sleep(2.0);
    if (!(await this.evaluate(CALENDAR_FEED_BUTTON_SCRIPT))) throw new LiveCommandError("calendar feed button was not found");
    await timing.sleep(1.0);
    return String((await this.evaluate(CALENDAR_FEED_URL_SCRIPT)) || "");
  }

  /** Read the course attendance tab's own LearningX responses; direct cross-course fetches are rejected. */
  async fetchAttendance(courseId: unknown): Promise<Raw> {
    const client = this.requireClient();
    const prefix = `/learningx/api/v1/courses/${courseId}/`;
    const wanted = new Map([
      [prefix + "attendance_items", "attendance_items"],
      [prefix + "attendance_items/summary", "summary"],
    ]);
    const requests = new Map<string, string>();
    const result: Raw = {};
    let settle!: (error?: Error) => void;
    let settled = false;
    const loaded = new Promise<void>((resolve, reject) => {
      settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
    });
    const previous = client.eventCallback;

    const read = async (requestId: string, key: string): Promise<void> => {
      let body: Raw;
      try {
        body = await client.send("Network.getResponseBody", { requestId });
      } catch (error) {
        if (error instanceof LiveCommandError) return; // The tab reloads once; bodies of the discarded document are gone and it refetches.
        throw error;
      }
      try {
        result[key] = JSON.parse(body.body || "null");
      } catch {
        settle(new LiveCommandError("attendance API returned an unexpected shape"));
        return;
      }
      if (Object.keys(result).length === wanted.size) settle();
    };

    client.eventCallback = (event) => {
      previous?.(event);
      const params = event.params || {};
      if (event.method === "Network.responseReceived") {
        const key = wanted.get(safeUrl(String((params.response || {}).url ?? ""))?.pathname ?? "");
        if (key) requests.set(String(params.requestId), key);
      } else if (event.method === "Network.loadingFinished" && requests.has(params.requestId)) {
        const requestId = String(params.requestId);
        const key = requests.get(requestId)!;
        requests.delete(requestId);
        void read(requestId, key);
      }
    };
    try {
      await this.goto(`${CANVAS_ORIGIN}/courses/${courseId}/external_tools/${ATTENDANCE_TOOL_ID}`);
      await this.openExternalToolContent();
      await withTimeout(loaded, this.options.timeoutSeconds, () => new LiveCommandError("attendance status did not load before timeout"));
    } finally {
      client.eventCallback = previous;
    }
    return result;
  }

  async canvasSessionReady(): Promise<boolean> {
    try {
      return !!(await this.evaluate(CANVAS_SESSION_READY_SCRIPT, { timeout: 8 }));
    } catch (error) {
      if (error instanceof LiveCommandError) return false;
      throw error;
    }
  }

  async extractCaptions(url: string): Promise<Raw[]> {
    this.captionRequests = [];
    const client = this.requireClient();
    client.eventCallback = (event) => this.onEvent(event);
    await this.goto(url);
    await this.openExternalToolContent();
    // The original nudged the player to play here; playback can update viewing records, so the port only waits for the player to load.
    await timing.sleep(10.0);
    await this.openCaptionPanel();
    await timing.sleep(1.0);
    const domCaptions = await this.evaluate(CAPTION_EXTRACTION_SCRIPT, { timeout: Math.min(this.options.timeoutSeconds, 30) });
    await timing.sleep(0.5);
    await client.drainEvents();
    const networkCaptions = await this.captionBodiesFromNetwork();
    const captions: Array<Raw | null> = [];
    if (Array.isArray(domCaptions)) captions.push(...domCaptions.filter(isRecord).map(normalizeCaptionItem));
    const playerApiCaptions = captions.filter((item): item is Raw => !!item && item.source === "player_caption_api");
    if (playerApiCaptions.length) return dedupeCaptions(playerApiCaptions);
    captions.push(...networkCaptions);
    return dedupeCaptions(captions.filter((item): item is Raw => !!item));
  }

  /** Click player caption/script controls so lazy caption APIs are populated. */
  private async openCaptionPanel(): Promise<void> {
    await this.evaluate(OPEN_CAPTION_PANEL_SCRIPT, { timeout: 15 }).catch(swallowLive);
  }

  private async captionBodiesFromNetwork(): Promise<Raw[]> {
    const client = this.requireClient();
    const captions: Raw[] = [];
    for (const item of [...this.captionRequests]) {
      const requestId = item.requestId;
      if (!requestId) continue;
      let body: Raw;
      try {
        body = await client.send("Network.getResponseBody", { requestId }, { timeout: 10 });
      } catch (error) {
        if (error instanceof LiveCommandError) continue;
        throw error;
      }
      const text = isRecord(body) ? body.body : "";
      if (typeof text !== "string" || !text.trim() || body.base64Encoded) continue;
      const normalized = normalizeCaptionItem({
        label: item.label ?? "",
        language: item.language ?? "",
        format: item.format ?? captionFormatFromText(text),
        source: "network_caption",
        text,
      });
      if (normalized) captions.push(normalized);
    }
    return captions;
  }

  /**
   * Open Canvas/LearningX external-tool wrappers in the current tab.
   *
   * Canvas module item URLs often render an LTI launch form whose default target is an
   * iframe or a new window. Headless extraction needs the actual player document as the
   * top-level page so DOM, performance resources, and text tracks can be inspected.
   */
  async openExternalToolContent(): Promise<void> {
    let action: unknown;
    try {
      action = await this.evaluate(EXTERNAL_TOOL_OPEN_SCRIPT, { timeout: 10 });
    } catch (error) {
      if (error instanceof LiveCommandError) return;
      throw error;
    }
    if (action === "submitted_form" || action === "clicked_launch") await timing.sleep(4.0);
    let iframeSrc = "";
    try {
      iframeSrc = String((await this.evaluate(IFRAME_SRC_SCRIPT, { timeout: 10 })) || "");
    } catch (error) {
      if (!(error instanceof LiveCommandError)) throw error;
    }
    if (iframeSrc) {
      await this.goto(iframeSrc);
      await timing.sleep(5.0);
    }
  }

  async submitCredentials(): Promise<void> {
    await this.evaluate(submitCredentialsScript(JSON.stringify(this.config.userId), JSON.stringify(this.config.password)));
  }

  takePasswordChangePrompt(): boolean {
    const client = this.requireClient();
    const message = client.lastDialogMessage;
    client.lastDialogMessage = "";
    return /password|비밀번호/i.test(message) && /chang|reset|변경/i.test(message);
  }

  async postponePasswordChange(): Promise<void> {
    if ((await this.evaluate(POSTPONE_PASSWORD_CHANGE_SCRIPT)) !== "postponed") {
      throw new LiveCommandError("SSO requires a password change and offers no change-later option");
    }
  }

  async clickLoginCandidate(): Promise<void> {
    await this.evaluate(CLICK_LOGIN_CANDIDATE_SCRIPT);
  }

  private onEvent(event: Raw): void {
    if (event.method !== "Network.responseReceived") return;
    const params = isRecord(event.params) ? event.params : {};
    const response = isRecord(params.response) ? params.response : {};
    const mime = String(response.mimeType || "").toLowerCase();
    const url = String(response.url || "");
    if (!looksLikeCaptionResponse(url, mime)) return;
    const requestId = String(params.requestId || "");
    if (requestId && !this.captionRequests.some((item) => item.requestId === requestId)) {
      this.captionRequests.push({ requestId, format: captionFormatFromUrlOrMime(url, mime), label: "", language: "" });
    }
  }

  fetchLearningxJson(path: string): Promise<any> {
    if (!path.startsWith("/learningx/api/")) return Promise.reject(new LiveCommandError("LearningX fetch is limited to its API paths"));
    return this.evaluate(fetchLearningxJsonScript(JSON.stringify(path)), { timeout: Math.min(this.options.timeoutSeconds, 25) });
  }

  async downloadFile(url: string, target: string): Promise<number> {
    const absolute = new URL(url, CANVAS_ORIGIN).href;
    if (!CANVAS_HOSTS.has(new URL(absolute).hostname)) throw new LiveCommandError("material download must start on the KU LMS host");
    const cookies = await this.requireClient().send("Network.getCookies", { urls: [absolute] });
    const cookie = ((cookies.cookies || []) as Raw[]).map((item) => `${item.name}=${item.value}`).join("; ");
    return downloadWithCanvasCookie(absolute, cookie, target, this.options.timeoutSeconds);
  }

  requireClient(): CdpTransport {
    if (!this.client) throw new LiveCommandError("browser session is not active");
    return this.client;
  }
}

function swallowLive(error: unknown): void {
  if (!(error instanceof LiveCommandError)) throw error;
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, seconds: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), seconds * 1000);
  });
  try {
    return await Promise.race([promise, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/** Follow redirects by hand so the LMS session cookie is never sent to storage hosts. */
export async function downloadWithCanvasCookie(url: string, cookie: string, target: string, timeout: number, hosts: ReadonlySet<string> = CANVAS_HOSTS): Promise<number> {
  for (let hop = 0; hop < 6; hop++) {
    const headers: Record<string, string> = hosts.has(new URL(url).hostname) && cookie ? { Cookie: cookie } : {};
    let response: Response;
    try {
      response = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(timeout * 1000) });
    } catch (error) {
      throw new LiveCommandError("material download failed: " + (error instanceof Error ? error.name : "error"));
    }
    if (REDIRECT_CODES.has(response.status) && response.headers.get("location")) {
      url = new URL(response.headers.get("location")!, url).href;
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new LiveCommandError(`material download failed with HTTP ${response.status}`);
    }
    if ((response.headers.get("content-type") || "").includes("text/html")) {
      await response.body?.cancel();
      throw new LiveCommandError("material download returned an HTML page instead of a file");
    }
    mkdirSync(dirname(target), { recursive: true });
    const partial = target + ".part";
    if (!response.body) throw new LiveCommandError("material download returned an empty body");
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>), createWriteStream(partial));
    renameSync(partial, target);
    return statSync(target).size;
  }
  throw new LiveCommandError("material download redirected too many times");
}

export type CdpEvent = Raw & { method?: string; params?: Raw };

/** What the session needs from a CDP connection: commands, one event callback, and dialog handling. */
export interface CdpTransport {
  eventCallback: ((event: CdpEvent) => void) | null;
  lastDialogMessage: string;
  send(method: string, params?: Raw, options?: { timeout?: number }): Promise<Raw>;
  drainEvents(): Promise<void>;
  close(): Promise<void>;
}

/** One websocket reader dispatches replies and events, including while idle. */
export class CdpClient implements CdpTransport {
  eventCallback: ((event: CdpEvent) => void) | null = null;
  lastDialogMessage = "";
  connected = true;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (value: Raw) => void; reject: (error: Error) => void }>();
  private readonly closed: Promise<void>;

  private constructor(private readonly websocket: WebSocket) {
    this.closed = new Promise((resolve) => websocket.addEventListener("close", () => resolve()));
    websocket.addEventListener("message", (event) => this.receive(String(event.data)));
    websocket.addEventListener("close", () => this.disconnect(new LiveCommandError("CDP connection closed")));
    websocket.addEventListener("error", () => this.disconnect(new LiveCommandError("CDP connection failed: WebSocketError")));
  }

  static connect(wsUrl: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const websocket = new WebSocket(wsUrl);
      const onError = () => reject(new LiveCommandError("CDP connection failed: WebSocketError"));
      websocket.addEventListener("error", onError, { once: true });
      websocket.addEventListener(
        "open",
        () => {
          websocket.removeEventListener("error", onError);
          resolve(new CdpClient(websocket));
        },
        { once: true },
      );
    });
  }

  private receive(raw: string): void {
    let message: Raw;
    try {
      message = JSON.parse(raw);
    } catch {
      this.disconnect(new LiveCommandError("CDP connection failed: JSONDecodeError"));
      return;
    }
    const waiter = typeof message.id === "number" ? this.pending.get(message.id) : undefined;
    if (waiter) {
      if ("error" in message) waiter.reject(new LiveCommandError(redactText(message.error)));
      else waiter.resolve(message.result ?? {});
    }
    if (message.method === "Page.javascriptDialogOpening") {
      this.lastDialogMessage = String((message.params || {}).message ?? "");
      const id = this.nextId++;
      this.websocket.send(JSON.stringify({ id, method: "Page.handleJavaScriptDialog", params: { accept: true } }));
    }
    if (message.method && this.eventCallback) this.eventCallback(message);
  }

  private disconnect(error: LiveCommandError): void {
    if (!this.connected) return;
    this.connected = false;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    this.eventCallback?.({ method: "CDP.disconnected", params: {} });
  }

  async send(method: string, params: Raw = {}, options: { timeout?: number } = {}): Promise<Raw> {
    if (!this.connected) throw new LiveCommandError("CDP connection closed");
    const id = this.nextId++;
    const timeout = options.timeout ?? 60;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<Raw>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        timer = setTimeout(() => reject(new LiveCommandError(`CDP command timed out: ${method}`)), timeout * 1000);
        this.websocket.send(JSON.stringify({ id, method, params }));
      });
    } finally {
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }

  /** A reply is a protocol barrier; there is no second websocket reader or polling. */
  async drainEvents(): Promise<void> {
    await this.send("Runtime.evaluate", { expression: "0" });
  }

  async close(): Promise<void> {
    if (this.websocket.readyState === WebSocket.CLOSED) return;
    this.websocket.close();
    await this.closed;
  }
}

function defaultChromePath(): string | null {
  for (const candidate of [
    "/usr/lib64/chromium-browser/headless_shell",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return which("chromium-browser") || which("chromium") || which("google-chrome");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

async function waitForPageWs(port: number, timeout: number): Promise<string> {
  const deadline = performance.now() + timeout * 1000;
  let lastError = "";
  while (performance.now() < deadline) {
    try {
      const pageUrl = await openNewPage(port);
      if (pageUrl) return pageUrl;
    } catch (error) {
      lastError = redactText(error instanceof Error ? error.message : String(error));
    }
    await sleep(0.25);
  }
  throw new LiveCommandError(`browser DevTools endpoint did not become ready: ${lastError}`);
}

async function createPage(port: number): Promise<string | null> {
  const base = `http://127.0.0.1:${port}`;
  for (const method of ["PUT", "GET"]) {
    const response = await fetch(`${base}/json/new?${encodeURIComponent("about:blank")}`, { method, signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      await response.body?.cancel();
      continue;
    }
    const data = (await response.json()) as Raw;
    if (data.webSocketDebuggerUrl) return String(data.webSocketDebuggerUrl);
  }
  return null;
}

async function openNewPage(port: number): Promise<string> {
  const created = await createPage(port);
  if (created) return created;
  const response = await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(2000) });
  const pages = (await response.json()) as Raw[];
  for (const page of pages) {
    if (page.type === "page" && page.webSocketDebuggerUrl) return String(page.webSocketDebuggerUrl);
  }
  throw new LiveCommandError("no DevTools page target was available");
}
