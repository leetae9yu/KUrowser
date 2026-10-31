import { Check, ChevronDown, ChevronUp, Download, ExternalLink, Play } from "lucide-react";
import { useState } from "react";
import { courseOf, type Assignment, type CourseId, type FileItem, type Lecture, type Notice } from "../data";
import { ago, dueLabel, sizeLabel, urgency } from "../format";
import { jobFor, useStore } from "../store";

export function CourseTag({ id }: { id: CourseId }) {
  const c = courseOf(useStore().data, id);
  return (
    <span className="course-tag">
      <span className={`dot hue-${c.hue}`} aria-hidden="true" />
      {c.name}
    </span>
  );
}

export function AssignmentRow({ a, showCourse = true }: { a: Assignment; showCourse?: boolean }) {
  const { opened, openAssignment } = useStore();
  const level = a.submitted ? "done" : urgency(a.due);
  const isOpened = opened.has(a.id);
  return (
    <li className="row">
      <div className="row-main">
        <span className="row-title">{a.title}</span>
        <span className="row-meta">
          {showCourse && <CourseTag id={a.courseId} />}
          {a.submitted ? (
            <span className="due due-done">
              <Check size={14} aria-hidden="true" />
              제출함
            </span>
          ) : (
            <span className={`due due-${level}`}>
              {level === "urgent" && <span className="due-flag">24시간 안</span>}
              {dueLabel(a.due)} 마감
            </span>
          )}
        </span>
      </div>
      <button
        type="button"
        className={`btn btn-row${isOpened ? " is-done" : ""}`}
        aria-label={`${a.title} ${isOpened ? "다시 열기" : "과제 열기"}`}
        title={isOpened ? "다시 열기" : "과제 열기"}
        onClick={() => openAssignment(a)}
      >
        {isOpened ? <Check size={16} aria-hidden="true" /> : <ExternalLink size={16} aria-hidden="true" />}
        <span className="btn-label">{isOpened ? "열었음" : "과제 열기"}</span>
      </button>
    </li>
  );
}

export function LectureRow({ l, showCourse = true }: { l: Lecture; showCourse?: boolean }) {
  const { watched, watch } = useStore();
  const seen = watched.has(l.id);
  return (
    <li className="row">
      <div className="row-main">
        <span className="row-title">
          {l.week ? `${l.week}주차 ` : ""}
          {l.title}
        </span>
        <span className="row-meta">
          {showCourse && <CourseTag id={l.courseId} />}
          {!seen && l.until && <span className={`due due-${urgency(l.until)}`}>출석 인정 {dueLabel(l.until)}까지</span>}
        </span>
      </div>
      <button
        type="button"
        className={`btn btn-row${seen ? " is-done" : ""}`}
        aria-label={`${l.title} ${seen ? "다시 보기" : "강의 보기"}`}
        title={seen ? "다시 보기" : "강의 보기"}
        onClick={() => watch(l)}
      >
        {seen ? <Check size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        <span className="btn-label">{seen ? "봤음" : "강의 보기"}</span>
      </button>
    </li>
  );
}

export function NoticeRow({ n, showCourse = true }: { n: Notice; showCourse?: boolean }) {
  const { read, markRead } = useStore();
  const [open, setOpen] = useState(false);
  const unread = !read.has(n.id);
  const toggle = () => {
    setOpen((v) => !v);
    markRead([n.id]);
  };
  return (
    <li className={`row row-notice${open ? " is-open" : ""}`}>
      <div className="row-main">
        <span className="row-title">
          {unread && <span className="unread-mark">새 공지</span>}
          {n.title}
        </span>
        <span className="row-meta">
          {showCourse && <CourseTag id={n.courseId} />}
          <span>{ago(n.postedAt)}</span>
        </span>
        {open && <p className="notice-body">{n.body}</p>}
      </div>
      <button
        type="button"
        className="btn btn-row"
        aria-expanded={open}
        aria-label={`${n.title} ${open ? "접기" : "읽기"}`}
        title={open ? "접기" : "읽기"}
        onClick={toggle}
      >
        {open ? <ChevronUp size={16} aria-hidden="true" className="phone-only" /> : <ChevronDown size={16} aria-hidden="true" className="phone-only" />}
        <span className="btn-label">{open ? "접기" : "읽기"}</span>
      </button>
    </li>
  );
}

export function FileRow({ f, showCourse = true }: { f: FileItem; showCourse?: boolean }) {
  const { jobs, download } = useStore();
  const { downloaded } = useStore();
  const job = jobFor(jobs, f.id);
  const state = downloaded.has(f.id) ? "done" : job?.state;
  return (
    <li className="row">
      <div className="row-main">
        <span className="row-title row-file">{f.name}</span>
        <span className="row-meta">
          {showCourse && <CourseTag id={f.courseId} />}
          {f.size > 0 && <span>{sizeLabel(f.size)}</span>}
          {f.folder && <span>{f.folder}</span>}
        </span>
      </div>
      <button
        type="button"
        className={`btn btn-row${state === "done" ? " is-done" : ""}`}
        disabled={!f.available || state === "queued" || state === "active"}
        aria-label={`${f.name} ${state === "done" ? "다시 받기" : "받기"}`}
        title={state === "done" ? "다시 받기" : "받기"}
        onClick={() => download([f])}
      >
        {state === "done" ? <Check size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
        <span className={state === "active" ? "btn-label btn-label-keep" : "btn-label"}>
          {!f.available ? "못 받음" : state === "done" ? "받았음" : state === "active" ? "받는 중" : state === "queued" ? "대기 중" : state === "failed" ? "다시 받기" : "받기"}
        </span>
      </button>
    </li>
  );
}
