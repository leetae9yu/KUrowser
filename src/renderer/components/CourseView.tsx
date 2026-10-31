import { ChevronRight } from "lucide-react";
import type { Course } from "../data";
import { jobFor, useStore } from "../store";
import { AssignmentRow, FileRow, LectureRow, NoticeRow } from "./Rows";

export function CourseView({ course }: { course: Course }) {
  const { data, watched, read, jobs } = useStore();
  const now = Date.now();
  const due = data.assignments.filter((a) => a.courseId === course.id && !a.submitted && a.due.getTime() > now);
  const lect = data.lectures.filter((l) => l.courseId === course.id && !watched.has(l.id));
  const mine = data.files.filter((f) => f.courseId === course.id).sort((a, b) => (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0));
  const news = data.notices.filter((n) => n.courseId === course.id && !read.has(n.id));
  const waiting = mine.filter((f) => f.available && !f.downloaded && !jobFor(jobs, f.id)).length;
  return (
    <div className="course-view">
      <p className="course-meta">
        <span className={`dot dot-lg hue-${course.hue}`} aria-hidden="true" />
        {course.prof ? `${course.prof} 교수 · ` : ""}받을 자료 {waiting}개
      </p>
      {due.length > 0 && (
        <>
          <h3 className="sub-title">과제</h3>
          <ul className="list">
            {due.map((a) => (
              <AssignmentRow key={a.id} a={a} showCourse={false} />
            ))}
          </ul>
        </>
      )}
      {lect.length > 0 && (
        <>
          <h3 className="sub-title">안 본 강의</h3>
          <ul className="list">
            {lect.map((l) => (
              <LectureRow key={l.id} l={l} showCourse={false} />
            ))}
          </ul>
        </>
      )}
      {news.length > 0 && (
        <>
          <h3 className="sub-title">새 공지</h3>
          <ul className="list">
            {news.map((n) => (
              <NoticeRow key={n.id} n={n} showCourse={false} />
            ))}
          </ul>
        </>
      )}
      {mine.length > 0 && (
        <>
          <h3 className="sub-title">강의자료</h3>
          <ul className="list">
            {mine.map((f) => (
              <FileRow key={f.id} f={f} showCourse={false} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function CourseList({ onOpen }: { onOpen: (name: string) => void }) {
  const { data, watched, read, jobs } = useStore();
  const now = Date.now();
  return (
    <ul className="list">
      {data.courses.map((c) => {
        const facts = [
          ["마감", data.assignments.filter((a) => a.courseId === c.id && !a.submitted && a.due.getTime() > now).length],
          ["안 본 강의", data.lectures.filter((l) => l.courseId === c.id && !watched.has(l.id)).length],
          ["새 공지", data.notices.filter((n) => n.courseId === c.id && !read.has(n.id)).length],
          ["새 자료", data.files.filter((f) => f.courseId === c.id && f.isNew && !jobFor(jobs, f.id)).length],
        ] as const;
        const shown = facts.filter(([, n]) => n > 0);
        return (
          <li key={c.id} className="row">
            <span className={`dot dot-lg hue-${c.hue}`} aria-hidden="true" />
            <div className="row-main">
              <span className="row-title">{c.name}</span>
              <span className="row-meta">
                {shown.length ? shown.map(([label, n]) => <span key={label}>{label} {n}</span>) : <span>새 소식 없음</span>}
              </span>
            </div>
            <button type="button" className="btn btn-row" aria-label={`${c.name} 열기`} title="열기" onClick={() => onOpen(`${c.name} 열어줘`)}>
              <ChevronRight size={16} aria-hidden="true" />
              <span className="btn-label">열기</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
