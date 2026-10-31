import type { Course, Recording, Snapshot } from "../shared/types";

export type { Course, Recording };
export type CourseId = string;
export type Theme = "system" | "light" | "dark";

export interface Assignment {
  id: string;
  courseId: CourseId;
  title: string;
  due: Date;
  submitted: boolean;
}

export interface Lecture {
  id: string;
  courseId: CourseId;
  week: number | null;
  title: string;
  until: Date | null;
}

export interface Notice {
  id: string;
  courseId: CourseId;
  title: string;
  summary: string;
  body: string;
  source: string;
  postedAt: Date;
  read: boolean;
}

export interface FileItem {
  id: string;
  courseId: CourseId;
  name: string;
  folder: string;
  size: number;
  postedAt: Date | null;
  downloaded: boolean;
  available: boolean;
  isNew: boolean;
}

export interface Data {
  courses: Course[];
  courseById: Record<CourseId, Course>;
  assignments: Assignment[];
  lectures: Lecture[];
  recordings: Recording[];
  notices: Notice[];
  files: FileItem[];
}

const date = (value: string | null): Date | null => (value ? new Date(value) : null);

export function toData(s: Snapshot): Data {
  return {
    courses: s.courses,
    courseById: Object.fromEntries(s.courses.map((c) => [c.id, c])),
    assignments: s.assignments.map((a) => ({ ...a, due: new Date(a.due) })),
    lectures: s.lectures.map((l) => ({ id: l.id, courseId: l.courseId, week: l.week, title: l.title, until: date(l.until) })),
    recordings: s.recordings,
    notices: s.notices.map((n) => ({ ...n, postedAt: new Date(n.postedAt) })),
    files: s.files.map((f) => ({ ...f, postedAt: date(f.updatedAt) })),
  };
}

export const unknownCourse: Course = { id: "", name: "기타", prof: "", hue: 5, aliases: [] };

export function courseOf(data: Data, id: CourseId): Course {
  return data.courseById[id] ?? unknownCourse;
}

/** A course name as students say it: no [학생]/[한국어] tags, term code, year, English title or section. */
export function shortCourseName(name: string): string {
  const short = name
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/^\s*\d{3}[A-Z]?\s*\([^)]*\)/, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s*-\s*\d+분반\s*$/, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return short || name;
}

export function suggestionsFor(data: Data): string[] {
  const first = data.courses[0] && shortCourseName(data.courses[0].name);
  return [
    "이번 주 마감 뭐 있어",
    first ? `${first} 자료 다 받아줘` : "새 자료 다 받아줘",
    "안 본 강의 몇 개야",
    "녹화강의 요약해줘",
    "공지 요약해줘",
    "학교 공지 보여줘",
    "다음 학사 일정 뭐야",
    "중앙도서관 빈자리 있어?",
    "빌린 책 반납일 알려줘",
    "성적 화면 열어줘",
    data.courses[1] ? `${shortCourseName(data.courses[1].name)} 열어줘` : "과목 전체 보기",
    "과목 전체 보기",
  ].filter((s, i, all) => all.indexOf(s) === i);
}
