import type { ReadCommand } from "../shared/types";
import { shortCourseName, type Assignment, type Course, type Data, type FileItem, type Lecture, type Notice, type Recording } from "./data";
import { addDays, today0, weekStart } from "./format";
import type { Route } from "./router";
import type { Theme } from "./store";

export type Outcome =
  | { kind: "deadlines"; title: string; assignments: Assignment[]; lectures: Lecture[] }
  | { kind: "lectures"; title: string; items: Lecture[] }
  | { kind: "notices"; title: string; items: Notice[] }
  | { kind: "download"; title: string; files: FileItem[]; start: boolean }
  | { kind: "course"; title: string; course: Course }
  | { kind: "courses"; title: string }
  | { kind: "recordings"; title: string; items: Recording[] }
  | { kind: "navigate"; title: string; route: Route }
  | { kind: "theme"; title: string; theme: Theme }
  | { kind: "unknown"; title: string };

export interface Snapshot {
  watched: Set<string>;
  read: Set<string>;
  downloaded: Set<string>;
}

export type Parsed =
  | { kind: "read"; command: ReadCommand; start?: boolean }
  | { kind: "recordings"; course?: string }
  | { kind: "theme"; theme: Theme; title: string }
  | { kind: "navigate"; route: Route; title: string };

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

function findCourse(s: string, data: Data): Course | undefined {
  const bare = (name: string) => shortCourseName(name).toLowerCase().replace(/\s+/g, "");
  return data.courses.find((c) => c.aliases.some((a) => a && s.includes(a)) || (bare(c.name).length > 1 && s.includes(bare(c.name))));
}

function rangeOf(s: string): Extract<ReadCommand, { command: "deadlines" }>["range"] {
  if (has(s, "오늘")) return "today";
  if (has(s, "내일")) return "tomorrow";
  if (has(s, "다음주")) return "nextweek";
  if (has(s, "이번달", "한달")) return "month";
  return "week";
}

export function parseRules(raw: string, data: Data): Parsed {
  const s = raw.toLowerCase().replace(/\s+/g, "");
  const course = findCourse(s, data)?.name;

  if (has(s, "다크", "어둡", "어두운", "밤모드")) return { kind: "theme", theme: "dark", title: "어두운 화면으로 바꿨어요" };
  if (has(s, "라이트", "밝게", "밝은")) return { kind: "theme", theme: "light", title: "밝은 화면으로 바꿨어요" };
  if (has(s, "설정", "계정", "api", "로그아웃", "ai연결")) return { kind: "navigate", route: { name: "settings" }, title: "설정을 열었어요" };
  // "받아쓰기" contains "받아", so this sits before the download rule; lecture notes (강의안, 자료) stay files.
  if (has(s, "자막", "요약", "받아쓰기", "정리") && has(s, "강의", "녹화", "인강") && !has(s, "자료", "강의안", "슬라이드", "파일")) {
    return { kind: "recordings", course };
  }
  if (has(s, "받아", "다운", "저장해", "내려받")) return { kind: "read", command: { command: "files", course, onlyNew: has(s, "새", "최신", "이번주") }, start: true };
  if (has(s, "자료", "파일", "강의안", "슬라이드")) return { kind: "read", command: { command: "files", course, onlyNew: has(s, "새", "최신") } };
  if (has(s, "마감", "과제", "숙제", "할일", "해야", "제출", "due", "일정", "캘린더", "달력", "타임라인")) {
    return { kind: "read", command: { command: "deadlines", range: rangeOf(s), course, assignmentsOnly: has(s, "과제", "숙제", "제출") } };
  }
  if (has(s, "강의", "녹화", "인강", "영상")) return { kind: "read", command: { command: "lectures", course } };
  if (has(s, "공지", "알림", "새소식")) return { kind: "read", command: { command: "notices", course } };
  if (course) return { kind: "read", command: { command: "course", course } };
  if (has(s, "과목", "수업", "강좌")) return { kind: "read", command: { command: "courses" } };
  if (has(s, "오늘", "홈", "처음")) return { kind: "navigate", route: { name: "today" }, title: "할 일 화면을 열었어요" };
  return { kind: "read", command: { command: "unknown" } };
}

function rangeDates(range: Extract<ReadCommand, { command: "deadlines" }>["range"]): { from: Date; to: Date; label: string } {
  const now = new Date();
  switch (range) {
    case "today":
      return { from: now, to: addDays(today0, 1), label: "오늘" };
    case "tomorrow":
      return { from: addDays(today0, 1), to: addDays(today0, 2), label: "내일" };
    case "nextweek":
      return { from: weekStart(1), to: weekStart(2), label: "다음 주" };
    case "month":
      return { from: now, to: addDays(today0, 31), label: "앞으로 한 달" };
    case "week":
      return { from: now, to: addDays(today0, 8), label: "앞으로 7일" };
  }
}

/** Recorded lectures, newest week first, for the subtitles+summary card. */
export function recordingsOutcome(data: Data, courseName?: string): Outcome {
  const course = courseName ? data.courses.find((c) => c.name === courseName) : undefined;
  const scope = course ? `${course.name} ` : "";
  const items = data.recordings.filter((r) => !course || r.courseId === course.id).sort((a, b) => (b.week ?? -1) - (a.week ?? -1));
  return { kind: "recordings", title: items.length ? `${scope}녹화 강의 ${items.length}개, 최근 주차부터예요` : `${scope}녹화 강의가 없어요`, items };
}

export function outcomeFor(command: ReadCommand, data: Data, snap: Snapshot, start = false): Outcome {
  const course = "course" in command && command.course ? data.courses.find((c) => c.name === command.course) : undefined;
  const scope = course ? `${course.name} ` : "";
  const inCourse = (id: string) => !course || id === course.id;

  switch (command.command) {
    case "files": {
      let list = data.files.filter((f) => inCourse(f.courseId) && f.available && !snap.downloaded.has(f.id));
      if (command.onlyNew) list = list.filter((f) => f.isNew);
      const title = list.length
        ? start
          ? `${scope}자료 ${list.length}개를 받기 시작했어요`
          : `${scope}아직 안 받은 자료 ${list.length}개`
        : `${scope}새로 받을 자료가 없어요`;
      return { kind: "download", title, files: list, start };
    }
    case "deadlines": {
      const range = rangeDates(command.range);
      const inRange = (d: Date) => d >= range.from && d < range.to;
      const due = data.assignments.filter((a) => !a.submitted && inCourse(a.courseId) && inRange(a.due)).sort((a, b) => a.due.getTime() - b.due.getTime());
      const lect = command.assignmentsOnly ? [] : data.lectures.filter((l) => inCourse(l.courseId) && !snap.watched.has(l.id) && l.until && inRange(l.until));
      const total = due.length + lect.length;
      return {
        kind: "deadlines",
        title: total ? `${range.label} ${scope}마감 ${total}개` : `${range.label} ${scope}마감이 없어요`,
        assignments: due,
        lectures: lect,
      };
    }
    case "lectures": {
      const items = data.lectures
        .filter((l) => inCourse(l.courseId) && !snap.watched.has(l.id))
        .sort((a, b) => (a.until?.getTime() ?? Infinity) - (b.until?.getTime() ?? Infinity));
      return { kind: "lectures", title: items.length ? `${scope}안 본 강의 ${items.length}개, 출석 기한이 가까운 순서예요` : `${scope}안 본 강의가 없어요`, items };
    }
    case "notices": {
      const scoped = data.notices.filter((n) => inCourse(n.courseId));
      const unread = scoped.filter((n) => !snap.read.has(n.id));
      const items = unread.length ? unread : scoped.slice(0, 3);
      return {
        kind: "notices",
        title: unread.length ? `${scope}새 공지 ${unread.length}건이에요` : scoped.length ? `${scope}새 공지는 없어요. 최근 공지예요` : `${scope}최근 공지가 없어요`,
        items,
      };
    }
    case "course":
      return course ? { kind: "course", title: course.name, course } : { kind: "unknown", title: "그 과목을 찾지 못했어요" };
    case "courses":
      return { kind: "courses", title: `이번 학기 과목 ${data.courses.length}개` };
    case "unknown":
      return { kind: "unknown", title: "아직 이 문장은 이해하지 못해요. 고대 AI를 연결하면 더 많은 문장을 알아들어요." };
  }
}
