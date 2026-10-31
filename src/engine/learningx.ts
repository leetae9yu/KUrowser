/**
 * LearningX fallbacks for courses whose Canvas REST API denies students.
 *
 * An unpublished Canvas course answers HTTP 401 to every student REST call (modules, assignments,
 * announcements, files, users), while LearningX keeps serving the endpoints its own course tools
 * call: the 주차학습 tool reads `modules?include_detail=true` and the 게시판 tool reads boards.
 */
import { LiveCommandError } from "./errors.ts";

export const MODULES_API = (courseId: unknown) => `/learningx/api/v1/courses/${courseId}/modules?include_detail=true`;
export const WORK_TYPES = new Set(["assignment", "quiz", "discussion"]);

type Raw = Record<string, any>;

export interface LearningxSession {
  fetchLearningxJson(path: string): Promise<unknown>;
}

const isRecord = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);

export function isUnauthorized(error: unknown): boolean {
  return error instanceof LiveCommandError && error.message.includes("HTTP 401");
}

export async function modules(session: LearningxSession, courseId: unknown): Promise<Raw[]> {
  const data = await session.fetchLearningxJson(MODULES_API(courseId));
  if (!Array.isArray(data)) throw new LiveCommandError("LearningX modules API returned an unexpected shape");
  return data.filter(isRecord);
}

export function moduleItems(data: Raw[], contentType: string | Set<string>): Array<[string, Raw]> {
  const types = typeof contentType === "string" ? new Set([contentType]) : contentType;
  const rows: Array<[string, Raw]> = [];
  for (const module of data) {
    if (module.published === false) continue;
    for (const item of module.module_items || []) {
      if (isRecord(item) && types.has(item.content_type) && item.published !== false) rows.push([String(module.title || ""), item]);
    }
  }
  return rows;
}

export function workItems(data: Raw[]): Raw[] {
  const rows: Raw[] = [];
  for (const [, item] of moduleItems(data, WORK_TYPES)) {
    const details = item.content_data;
    if (!isRecord(details) || !details.due_at) continue;
    rows.push({
      name: String(item.title || "").trim(),
      due_at: details.due_at,
      unlock_at: details.unlock_at ?? null,
      lock_at: details.lock_at ?? null,
      points_possible: details.points_possible ?? null,
      submission: item.completed ? { workflow_state: "complete" } : {},
    });
  }
  return rows;
}
