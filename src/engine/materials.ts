/**
 * Live lecture-material listing and incremental local sync.
 *
 * The student-facing course Files API is forbidden on KU LMS, so files are collected from what a
 * student can open: module File items, file links in module Pages, announcement and discussion
 * attachments or links, and assignment description links. Module placement wins on duplicates. Sync keeps a local state file keyed
 * by a hash of the LMS identifiers so raw IDs never reach CLI output or the folder tree.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { staffBoardPosts, staffNames } from "./boards.ts";
import { LiveCommandError } from "./errors.ts";
import * as learningx from "./learningx.ts";

export const STATE_FILENAME = ".ku-lms-materials.json";
const TERM_CODE = /^(\d{2})(\d)R\b/;
const CAMPUS_PREFIX = /^\d{3}R\s*\([^)]*\)\s*/;
const SECTION_SUFFIX = /\s*-\s*\d+분반\s*$/;
const FILE_LINK = /\/courses\/(\d+)\/files\/(\d+)/g;
const UNSAFE = /[\\/:*?"<>|\x00-\x1f]/g;

type Raw = Record<string, any>;

export interface MaterialSession {
  fetchJson(pathOrUrl: string): Promise<any>;
  downloadFile?(url: string, target: string): Promise<number>;
  fetchLearningxJson(path: string): Promise<any>;
}

type FetchPages = (session: MaterialSession, path: string) => Promise<Raw[]>;
type Accessible = (item: Raw) => boolean;

const isRecord = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const pyInt = (value: unknown): number => Math.trunc(Number(value || 0));

export async function materialCandidates(session: MaterialSession, course: Raw, fetchPages: FetchPages, accessible: Accessible): Promise<Raw[]> {
  const courseId = course.id;
  const rows: Raw[] = [];
  const seen = new Set<string>();
  const folderList = (folders: string[]) => (folders.filter(Boolean).length ? folders.filter(Boolean) : ["기타"]);

  const add = (folders: string[], meta: unknown): void => {
    if (!isRecord(meta) || meta.locked_for_user || !meta.url || !meta.id) return;
    const key = materialKey(courseId, meta.id);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      key,
      course: String(course.name || ""),
      course_code: String(course.course_code || ""),
      folders: folderList(folders),
      file: String(meta.display_name || meta.filename || "file"),
      size: pyInt(meta.size),
      updated_at: String(meta.updated_at || meta.modified_at || ""),
      download_url: String(meta.url),
    });
  };

  const addUnavailable = (folders: string[], fileId: unknown, name: unknown): void => {
    const key = materialKey(courseId, fileId);
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ key, course: String(course.name || ""), course_code: String(course.course_code || ""), folders: folderList(folders), file: String(name || "file"), size: 0, updated_at: "", download_url: "" });
  };

  const addFile = async (folders: string[], fileId: unknown, name: unknown): Promise<void> => {
    const meta = await optionalJson(session, `/api/v1/courses/${courseId}/files/${fileId}`);
    if (isRecord(meta) && meta.url) add(folders, meta);
    else addUnavailable(folders, fileId, name);
  };

  const addLinked = async (folders: string[], html: unknown): Promise<void> => {
    const links = new Set<string>();
    for (const match of String(html || "").matchAll(FILE_LINK)) links.add(`${match[1]}/${match[2]}`);
    for (const link of links) {
      const [linkedCourse, fileId] = link.split("/");
      const meta = await optionalJson(session, `/api/v1/courses/${linkedCourse}/files/${fileId}`);
      if (isRecord(meta) && !String(meta["content-type"] || "").startsWith("image/")) add(folders, meta);
    }
  };

  let modules: Raw[];
  try {
    modules = await fetchPages(session, `/api/v1/courses/${courseId}/modules?per_page=100&include[]=items`);
  } catch (error) {
    if (!learningx.isUnauthorized(error)) throw error;
    modules = [];
    for (const [folder, item] of learningx.moduleItems(await learningx.modules(session, courseId), "attachment")) {
      if (item.content_id) await addFile([folder], item.content_id, item.title);
    }
  }
  for (const module of modules) {
    if (!accessible(module)) continue;
    const folder = String(module.name || "");
    let items: Raw[] = module.items || [];
    if (("items_count" in module ? module.items_count : items.length) > items.length) {
      items = await fetchPages(session, `/api/v1/courses/${courseId}/modules/${module.id}/items?per_page=100`);
    }
    for (const item of items) {
      if (!isRecord(item) || !accessible(item) || !item.url) continue;
      if (item.type === "File") {
        add([folder], await session.fetchJson(String(item.url)));
      } else if (item.type === "Page") {
        const page = await optionalJson(session, String(item.url));
        await addLinked([folder], isRecord(page) ? page.body : "");
      }
    }
  }

  for (const topic of await optionalPages(session, fetchPages, `/api/v1/courses/${courseId}/discussion_topics?only_announcements=true&per_page=100`)) {
    for (const attachment of topic.attachments || []) add(["공지"], attachment);
    await addLinked(["공지"], topic.message);
  }
  for (const topic of await optionalPages(session, fetchPages, `/api/v1/courses/${courseId}/discussion_topics?per_page=100`)) {
    const folders = ["토론", String(topic.title || "")];
    for (const attachment of topic.attachments || []) add(folders, attachment);
    await addLinked(folders, topic.message);
  }
  for (const assignment of await optionalPages(session, fetchPages, `/api/v1/courses/${courseId}/assignments?per_page=100`)) {
    await addLinked(["과제", String(assignment.name || "")], assignment.description);
  }
  for (const post of await staffBoardPosts(session, course, await staffNames(session, course))) {
    const folders = ["게시판", post.board, String(post.title || "")];
    await addLinked(folders, post.content);
    if (!post.attachment_count) continue;
    const detail = await session.fetchLearningxJson(post.detail_path);
    for (const attachment of isRecord(detail) ? detail.attachments || [] : []) {
      if (isRecord(attachment) && attachment.canvas_file_id) await addFile(folders, attachment.canvas_file_id, attachment.filename);
    }
  }
  return rows;
}

async function optionalJson(session: MaterialSession, path: string): Promise<unknown> {
  try {
    return await session.fetchJson(path);
  } catch (error) {
    if (error instanceof LiveCommandError) return null;
    throw error;
  }
}

async function optionalPages(session: MaterialSession, fetchPages: FetchPages, path: string): Promise<Raw[]> {
  try {
    return await fetchPages(session, path);
  } catch (error) {
    if (error instanceof LiveCommandError) return [];
    throw error;
  }
}

export function publicMaterial(row: Raw): Raw {
  return { course: row.course, module: row.folders.join(" · "), file: row.file, size: row.size, updated_at: row.updated_at, available: !!row.download_url };
}

export interface SyncLayout {
  /** CLI layout keeps a term folder above the course; the app saves straight into <dest>/<course>. */
  termFolders: boolean;
}

/** Paths picked by downloads still running, so overlapping syncs into one folder never share a file name. */
const reserved = new Set<string>();

export async function syncMaterials(session: MaterialSession, rows: Raw[], dest: string, layout: SyncLayout = { termFolders: true }): Promise<Raw> {
  mkdirSync(dest, { recursive: true });
  const statePath = join(dest, STATE_FILENAME);
  const state = readState(statePath);
  const taken = new Set([...Object.values(state).map((entry) => entry.path!), ...[...reserved].filter((p) => p.startsWith(`${dest}\u0000`)).map((p) => p.slice(dest.length + 1))]);
  const downloaded: Raw[] = [];
  const unavailable: Raw[] = [];
  let unchanged = 0;
  const isFile = (relative: string) => existsSync(join(dest, relative)) && statSync(join(dest, relative)).isFile();
  for (const row of rows) {
    const known = state[row.key];
    if (!row.download_url) {
      if (known && isFile(known.path!)) unchanged += 1;
      else unavailable.push(publicMaterial(row));
      continue;
    }
    if (known && known.updated_at === row.updated_at && isFile(known.path!)) {
      unchanged += 1;
      continue;
    }
    const relative = known ? known.path! : uniquePath(relativePath(row, layout), taken);
    taken.add(relative);
    const slot = `${dest}\u0000${relative}`;
    reserved.add(slot);
    let size: number;
    try {
      size = await session.downloadFile!(row.download_url, join(dest, relative));
    } finally {
      reserved.delete(slot);
    }
    state[row.key] = { path: relative, updated_at: row.updated_at };
    // Other syncs may have written the state file meanwhile; merge into the latest copy (no await in between).
    writeState(statePath, { ...readState(statePath), [row.key]: state[row.key]! });
    downloaded.push({ ...publicMaterial(row), size, path: relative, status: known ? "updated" : "new" });
  }
  return { dest, downloaded, unchanged, unavailable };
}

export function termFolder(courseCode: string, courseName: string): string {
  const match = TERM_CODE.exec(courseCode) || TERM_CODE.exec(courseName);
  return match ? `20${match[1]}-${match[2]}학기` : "기타";
}

export function courseFolder(courseName: string): string {
  const name = courseName.replace(CAMPUS_PREFIX, "").replace(SECTION_SUFFIX, "");
  const korean = /^([^(]+)\(/.exec(name);
  return safeComponent(korean ? korean[1]! : name);
}

export function safeComponent(value: string): string {
  const cleaned = trimDots(value.replace(UNSAFE, "_").trim());
  return [...cleaned.replace(/\s+/g, " ")].slice(0, 120).join("") || "_";
}

function trimDots(value: string): string {
  return value.replace(/^\.+|\.+$/g, "");
}

function relativePath(row: Raw, layout: SyncLayout): string {
  const term = layout.termFolders ? [termFolder(row.course_code, row.course)] : [];
  return [...term, courseFolder(row.course), ...row.folders.map(safeComponent), safeComponent(row.file)].join("/");
}

function uniquePath(relative: string, taken: Set<string>): string {
  if (!taken.has(relative)) return relative;
  const dot = relative.lastIndexOf(".");
  let stem = dot >= 0 ? relative.slice(0, dot) : relative;
  let suffix = dot >= 0 ? relative.slice(dot + 1) : "";
  if (dot < 0 || suffix.includes("/")) {
    stem = relative;
    suffix = "";
  }
  for (let index = 2; ; index++) {
    const candidate = suffix ? `${stem} (${index}).${suffix}` : `${stem} (${index})`;
    if (!taken.has(candidate)) return candidate;
  }
}

function materialKey(courseId: unknown, fileId: unknown): string {
  if (courseId === null || courseId === undefined || courseId === "" || fileId === null || fileId === undefined || fileId === "") {
    throw new LiveCommandError("material metadata is missing identifiers");
  }
  return createHash("sha256").update(`${courseId}:${fileId}`).digest("hex").slice(0, 32);
}

type State = Record<string, { path?: string; updated_at?: string }>;

function readState(path: string): State {
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, "utf-8"));
  if (!isRecord(data) || !isRecord(data.files)) throw new LiveCommandError(`material sync state is malformed: ${path}`);
  return data.files as State;
}

function writeState(path: string, state: State): void {
  const tmp = path.replace(/\.json$/, "") + ".tmp";
  writeFileSync(tmp, JSON.stringify({ version: 1, files: state }, null, 1), "utf-8");
  renameSync(tmp, path);
}
