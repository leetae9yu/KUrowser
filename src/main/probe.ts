import { fetchCourses, fetchRecordingPages } from "../engine/live.ts";
import { redactData } from "../engine/redaction.ts";
import type { ElectronBrowserSession } from "./electron-cdp.ts";
import { keepLogin } from "./school.ts";

type Raw = Record<string, any>;
const keys = (rows: unknown): string[] => (Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]).sort() : []);
const out = (label: string, value: unknown): void => console.log(`PROBE ${label} ${JSON.stringify(redactData(value))}`);

export async function runProbe(make: () => ElectronBrowserSession): Promise<void> {
  const session = make();
  const started = performance.now();
  try {
    await session.enter();
    await session.login();
    out("login_ms", Math.round(performance.now() - started));
    await keepLogin();
    const courses: Raw[] = await fetchCourses(session);
    out("courses", { count: courses.length, keys: keys(courses), states: courses.map((c) => c.workflow_state) });
    const mode = process.env.KUROWSER_PROBE ?? "";
    for (const course of courses.slice(0, mode.includes("all") ? courses.length : 1)) {
      const t0 = performance.now();
      const assignments = await session.fetchJson(`/api/v1/courses/${course.id}/assignments?per_page=100&include[]=submission`).catch((e: Error) => e.message);
      out("assignments", { n: Array.isArray(assignments) ? assignments.length : assignments, keys: keys(assignments), sample: Array.isArray(assignments) && assignments[0] ? { html_url: typeof assignments[0].html_url, due_at: assignments[0].due_at, sub: keys([assignments[0].submission]) } : null });
      const topics = await fetchRecordingPages(session, `/api/v1/courses/${course.id}/discussion_topics?only_announcements=true&per_page=100`).catch((e: Error) => e.message);
      out("announcements", { n: Array.isArray(topics) ? topics.length : topics, keys: keys(topics), read_state: Array.isArray(topics) ? topics.map((t: Raw) => t.read_state) : null });
      if (mode.includes("attendance")) {
        const attendance = await session.fetchAttendance(course.id).catch((e: Error) => ({ error: e.message }) as Raw);
        const items: Raw[] = attendance.attendance_items?.attendance_items ?? [];
        out("attendance", { n: items.length, keys: keys(items), sample: items.slice(0, 3).map((i) => ({ type: i.item_content_type, use: i.use_attendance, item_id: typeof i.item_id, extra: Object.fromEntries(Object.entries(i).filter(([k]) => /url|id|module/.test(k)).map(([k, v]) => [k, typeof v === "string" ? v.replace(/\d+/g, "N") : typeof v])) })), summaryKeys: Object.keys(attendance.summary ?? {}) });
      }
      if (mode.includes("attendance")) {
        const attendance = await session.fetchAttendance(course.id).catch(() => ({} as Raw));
        const ids = new Set((attendance.attendance_items?.attendance_items ?? []).map((i: Raw) => i.item_id));
        const modules: Raw[] = await fetchRecordingPages(session, `/api/v1/courses/${course.id}/modules?per_page=100&include[]=items`).catch(() => []);
        const moduleItemIds = modules.flatMap((m) => (m.items ?? []).map((i: Raw) => i.id));
        out("match", { attendanceIds: ids.size, moduleItems: moduleItemIds.length, matched: moduleItemIds.filter((id) => ids.has(id)).length, itemKeys: keys(modules[0]?.items ?? []) });
      }
      out("course_ms", Math.round(performance.now() - t0));
    }
  } catch (error) {
    out("error", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  } finally {
    await session.exit();
  }
}
