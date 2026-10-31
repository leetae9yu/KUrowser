/**
 * Staff posts from Canvas announcements and LearningX course boards.
 *
 * Boards mix staff and student posts. Only posts whose author name matches a teacher or TA
 * enrollment are kept, so peer questions and discussion replies stay out of alerts and syncs.
 */
import { decodeHTML } from "entities";

import { LiveCommandError } from "./errors.ts";
import { isUnauthorized } from "./learningx.ts";

const TAG = /<[^>]+>/g;
const boardApi = (courseId: unknown) => `/learningx/api/v1/learningx_board/courses/${courseId}/boards`;

type Raw = Record<string, any>;

export interface BoardSession {
  fetchJson(pathOrUrl: string): Promise<unknown>;
  fetchLearningxJson(path: string): Promise<unknown>;
}

const isRecord = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);

export async function staffNames(session: BoardSession, course: Raw): Promise<Set<string>> {
  let users: unknown;
  try {
    users = await session.fetchJson(`/api/v1/courses/${course.id}/users?enrollment_type[]=teacher&enrollment_type[]=ta&per_page=100`);
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    // Unpublished courses hide the roster; the course list still names its teachers (TAs are lost).
    return new Set(((course.teachers || []) as unknown[]).filter((t): t is Raw => isRecord(t) && !!t.display_name).map((t) => String(t.display_name)));
  }
  if (!Array.isArray(users)) throw new LiveCommandError("course staff API returned an unexpected shape");
  return new Set(users.filter((user): user is Raw => isRecord(user) && !!user.name).map((user) => String(user.name)));
}

export async function staffBoardPosts(session: BoardSession, course: Raw, staff: Set<string>): Promise<Raw[]> {
  const base = boardApi(course.id);
  let boards: unknown;
  try {
    boards = await session.fetchLearningxJson(base);
  } catch (error) {
    if (error instanceof LiveCommandError) return [];
    throw error;
  }
  if (!Array.isArray(boards)) throw new LiveCommandError("board API returned an unexpected shape");
  const posts: Raw[] = [];
  for (const board of boards) {
    if (!isRecord(board) || !board.id) continue;
    let page = 1;
    while (true) {
      const data = (await session.fetchLearningxJson(`${base}/${board.id}/posts?page=${page}&per_page=100`)) as Raw;
      const items = isRecord(data) ? data.items : undefined;
      if (!Array.isArray(items)) throw new LiveCommandError("board posts API returned an unexpected shape");
      for (const item of items) {
        if (isRecord(item) && staff.has(item.user_name)) {
          posts.push({ ...item, board: String(board.title || ""), detail_path: `${base}/${board.id}/posts/${item.id ?? "None"}` });
        }
      }
      if (page >= Math.trunc(Number((data.pagination || {}).last_page || 1))) break;
      page += 1;
    }
  }
  return posts;
}

export function publicPost(course: Raw, source: string, title: unknown, postedAt: unknown, body: unknown, attachments: number): Raw {
  return {
    course: String(course.name || ""),
    source,
    title: String(title || ""),
    posted_at: String(postedAt || ""),
    excerpt: plainExcerpt(body),
    attachments,
  };
}

export function plainExcerpt(value: unknown, limit = 160): string {
  const text = decodeHTML(String(value || "").replace(TAG, " "))
    .replace(/\s+/g, " ")
    .trim();
  const chars = [...text];
  return chars.length <= limit ? text : chars.slice(0, limit - 1).join("") + "…";
}
