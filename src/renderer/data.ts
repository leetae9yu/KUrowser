import type { Course, Snapshot } from "../shared/types";

export type { Course };
export type CourseId = string;

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
    notices: s.notices.map((n) => ({ ...n, postedAt: new Date(n.postedAt) })),
    files: s.files.map((f) => ({ ...f, postedAt: date(f.updatedAt) })),
  };
}

export const unknownCourse: Course = { id: "", name: "기타", prof: "", hue: 5, aliases: [] };

export function courseOf(data: Data, id: CourseId): Course {
  return data.courseById[id] ?? unknownCourse;
}

export function suggestionsFor(data: Data): string[] {
  const first = data.courses[0]?.name;
  return [
    "이번 주 마감 뭐 있어",
    first ? `${first} 자료 다 받아줘` : "새 자료 다 받아줘",
    "안 본 강의 몇 개야",
    "공지 요약해줘",
    data.courses[1] ? `${data.courses[1].name} 열어줘` : "과목 전체 보기",
    "과목 전체 보기",
  ].filter((s, i, all) => all.indexOf(s) === i);
}
