import { assignments, courses, files, lectures, notices, type Assignment, type Course, type FileItem, type Lecture, type Notice } from "./data";
import { addDays, today0, weekStart } from "./format";
import type { Route } from "./router";
import type { Theme } from "./store";

/* Rule-based sentence matching. No model call: each rule maps a phrase to a result. */

export type Outcome =
  | { kind: "deadlines"; title: string; assignments: Assignment[]; lectures: Lecture[] }
  | { kind: "lectures"; title: string; items: Lecture[] }
  | { kind: "notices"; title: string; items: Notice[] }
  | { kind: "download"; title: string; files: FileItem[] }
  | { kind: "course"; title: string; course: Course }
  | { kind: "courses"; title: string }
  | { kind: "navigate"; title: string; route: Route }
  | { kind: "theme"; title: string; theme: Theme }
  | { kind: "unknown"; title: string };

export interface Snapshot {
  watched: Set<string>;
  read: Set<string>;
  downloaded: Set<string>;
}

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

function findCourse(s: string): Course | undefined {
  return courses.find((c) => c.aliases.some((a) => s.includes(a)));
}

function deadlineRange(s: string): { from: Date; to: Date; label: string } {
  const now = new Date();
  if (has(s, "오늘")) return { from: now, to: addDays(today0, 1), label: "오늘" };
  if (has(s, "내일")) return { from: addDays(today0, 1), to: addDays(today0, 2), label: "내일" };
  if (has(s, "다음주")) return { from: weekStart(1), to: weekStart(2), label: "다음 주" };
  if (has(s, "이번달", "한달")) return { from: now, to: addDays(today0, 31), label: "앞으로 한 달" };
  return { from: now, to: addDays(today0, 8), label: "앞으로 7일" };
}

export function interpret(raw: string, snap: Snapshot): Outcome {
  const s = raw.toLowerCase().replace(/\s+/g, "");
  const course = findCourse(s);
  const scope = course ? `${course.name} ` : "";
  const inCourse = (id: string) => !course || id === course.id;

  if (has(s, "다크", "어둡", "어두운", "밤모드")) return { kind: "theme", title: "어두운 화면으로 바꿨어요", theme: "dark" };
  if (has(s, "라이트", "밝게", "밝은")) return { kind: "theme", title: "밝은 화면으로 바꿨어요", theme: "light" };
  if (has(s, "설정", "계정", "api", "비밀번호")) return { kind: "navigate", title: "설정을 열었어요", route: { name: "settings" } };

  if (has(s, "받아", "다운", "저장해", "내려받")) {
    let list = files.filter((f) => inCourse(f.courseId) && !snap.downloaded.has(f.id));
    if (has(s, "새", "최신", "이번주")) list = list.filter((f) => f.isNew);
    return {
      kind: "download",
      title: list.length ? `${scope}자료 ${list.length}개를 받기 시작했어요` : `${scope}새로 받을 자료가 없어요`,
      files: list,
    };
  }

  if (has(s, "마감", "과제", "숙제", "할일", "해야", "제출", "due", "일정", "캘린더", "달력", "타임라인")) {
    const range = deadlineRange(s);
    const inRange = (d: Date) => d >= range.from && d < range.to;
    const due = assignments
      .filter((a) => !a.submitted && inCourse(a.courseId) && inRange(a.due))
      .sort((a, b) => a.due.getTime() - b.due.getTime());
    const lect = has(s, "과제", "숙제", "제출")
      ? []
      : lectures.filter((l) => inCourse(l.courseId) && !snap.watched.has(l.id) && inRange(l.until));
    const total = due.length + lect.length;
    return {
      kind: "deadlines",
      title: total ? `${range.label} ${scope}마감 ${total}개` : `${range.label} ${scope}마감이 없어요`,
      assignments: due,
      lectures: lect,
    };
  }

  if (has(s, "강의", "녹화", "인강", "영상")) {
    const items = lectures
      .filter((l) => inCourse(l.courseId) && !snap.watched.has(l.id))
      .sort((a, b) => a.until.getTime() - b.until.getTime());
    return {
      kind: "lectures",
      title: items.length ? `${scope}안 본 강의 ${items.length}개, 출석 기한이 가까운 순서예요` : `${scope}안 본 강의가 없어요`,
      items,
    };
  }

  if (has(s, "공지", "알림", "새소식")) {
    const scoped = notices.filter((n) => inCourse(n.courseId));
    const unread = scoped.filter((n) => !snap.read.has(n.id));
    const items = (unread.length ? unread : scoped.slice(0, 3)).sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());
    return {
      kind: "notices",
      title: unread.length ? `${scope}새 공지 ${unread.length}건을 요약했어요` : `${scope}새 공지는 없어요. 최근 공지를 요약했어요`,
      items,
    };
  }

  if (course) return { kind: "course", title: course.name, course };
  if (has(s, "과목", "수업", "강좌")) return { kind: "courses", title: "이번 학기 과목 5개" };
  if (has(s, "오늘", "홈", "처음")) return { kind: "navigate", title: "할 일 화면을 열었어요", route: { name: "today" } };

  return { kind: "unknown", title: "아직 이 문장은 이해하지 못해요. 아래 추천 문장처럼 말해 보세요." };
}
