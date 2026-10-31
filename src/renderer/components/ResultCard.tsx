import { ArrowLeft, Bell, Check, Download, ExternalLink, Play, Sparkles } from "lucide-react";
import type { Outcome } from "../commands";
import { courseOf, type Notice } from "../data";
import { api, jobFor, useStore } from "../store";
import { CourseList, CourseView } from "./CourseView";
import { RecordingRow } from "./RecordingRow";
import { FileRow, LectureRow, NoticeRow } from "./Rows";
import { LoanRow, MenuButtons, PortalRow, ScheduleRow, SeatRow } from "./SiteRows";
import { Timeline } from "./Timeline";

export function Summary({ items }: { items: Notice[] }) {
  const { data } = useStore();
  return (
    <ul className="summary-list">
      {items.map((n) => (
        <li key={n.id}>
          <span className="summary-course">{courseOf(data, n.courseId).name}</span>
          <span>{n.summary || n.title}</span>
        </li>
      ))}
    </ul>
  );
}

type Action = { label: string; icon: typeof Bell; run: () => void; done?: boolean };

/** The next step for a result, as one big button (plus at most one more). */
function useNextActions(outcome: Outcome): Action[] {
  const { data, settings, watched, opened, reminders, jobs, downloaded, read, markRead, remind, summarize, watch, openAssignment, download } = useStore();
  const out: Action[] = [];
  if (outcome.kind === "deadlines") {
    const first = outcome.assignments.find((a) => !opened.has(a.id));
    if (first) out.push({ label: `가장 급한 과제 열기`, icon: ExternalLink, run: () => openAssignment(first) });
    const off = outcome.assignments.filter((a) => !reminders.has(a.id));
    if (outcome.assignments.length)
      out.push({
        label: off.length ? `${off.length}개 모두 하루 전에 알림 받기` : "알림을 모두 켰어요",
        icon: Bell,
        done: off.length === 0,
        run: () => void remind(off.map((a) => a.id)),
      });
  }
  if (outcome.kind === "deadlines" && out.length === 0) {
    const next = outcome.lectures.find((l) => !watched.has(l.id));
    if (next) out.push({ label: "가장 급한 강의 틀기", icon: Play, run: () => watch(next) });
  }
  if (outcome.kind === "lectures") {
    const next = outcome.items.find((l) => !watched.has(l.id));
    if (next) out.push({ label: `가장 급한 강의 틀기`, icon: Play, run: () => watch(next) });
  }
  if (outcome.kind === "notices" && outcome.items.length) {
    const unread = outcome.items.filter((n) => !read.has(n.id));
    const plain = outcome.items.filter((n) => !n.summary);
    if (settings?.aiConnected && plain.length) {
      out.push({ label: `${plain.length}개 한 줄로 줄이기`, icon: Sparkles, run: () => void summarize(plain.map((n) => n.id)) });
    }
    out.push({
      label: unread.length ? "다 읽었어요" : "읽음으로 표시했어요",
      icon: Check,
      done: unread.length === 0,
      run: () => markRead(unread.map((n) => n.id)),
    });
  }
  if (outcome.kind === "portal" && outcome.items.length) {
    const unread = outcome.items.filter((n) => !n.read && !read.has(n.id));
    out.push({
      label: unread.length ? "다 읽었어요" : "읽음으로 표시했어요",
      icon: Check,
      done: unread.length === 0,
      run: () => markRead(unread.map((n) => n.id)),
    });
  }
  if (outcome.kind === "loans") {
    // Renewing is a school write; the app only opens the library page where the student does it.
    out.push({ label: "도서관 대출 화면 열기", icon: ExternalLink, run: () => void api().openMenu("loans") });
  }
  if (outcome.kind === "seats") {
    out.push({ label: "열람실 좌석 화면 열기", icon: ExternalLink, run: () => void api().openMenu("seats") });
  }
  if (outcome.kind === "schedule") {
    out.push({ label: "학사 일정 화면 열기", icon: ExternalLink, run: () => void api().openMenu("calendar") });
  }
  if (outcome.kind === "course") {
    const left = data.files.filter((f) => f.courseId === outcome.course.id && f.available && !downloaded.has(f.id) && !jobFor(jobs, f.id));
    out.push({
      label: left.length ? `자료 ${left.length}개 모두 받기` : "자료를 모두 받았어요",
      icon: Download,
      done: left.length === 0,
      run: () => download(left),
    });
  }
  if (outcome.kind === "download" && !outcome.start) {
    const left = outcome.files.filter((f) => !downloaded.has(f.id) && !jobFor(jobs, f.id));
    if (outcome.files.length)
      out.push({ label: left.length ? `${left.length}개 모두 받기` : "모두 받았어요", icon: Download, done: left.length === 0, run: () => download(left) });
  }
  return out;
}

export function ResultCard({ outcome, onRun, onBack }: { outcome: Outcome; onRun: (text: string) => void; onBack?: () => void }) {
  const actions = useNextActions(outcome);
  if (actions.length === 0 && onBack && outcome.kind !== "unknown") {
    actions.push({ label: "할 일로 돌아가기", icon: ArrowLeft, run: onBack });
  }
  return (
    <div className="result">
      <h2 className="result-title">{outcome.title}</h2>
      <div className="result-body">
        {outcome.kind === "deadlines" && <Timeline assignments={outcome.assignments} lectures={outcome.lectures} />}
        {outcome.kind === "lectures" && (
          <ul className="list">
            {outcome.items.map((l) => (
              <LectureRow key={l.id} l={l} />
            ))}
          </ul>
        )}
        {outcome.kind === "download" && (
          <ul className="list">
            {outcome.files.map((f) => (
              <FileRow key={f.id} f={f} />
            ))}
          </ul>
        )}
        {outcome.kind === "notices" && (
          <ul className="list">
            {outcome.items.map((n) => (
              <NoticeRow key={n.id} n={n} />
            ))}
          </ul>
        )}
        {outcome.kind === "course" && <CourseView course={outcome.course} />}
        {outcome.kind === "courses" && <CourseList onOpen={onRun} />}
        {outcome.kind === "portal" && (
          <ul className="list">
            {outcome.items.map((n) => (
              <PortalRow key={n.id} n={n} />
            ))}
          </ul>
        )}
        {outcome.kind === "schedule" && (
          <ul className="list">
            {outcome.items.map((e) => (
              <ScheduleRow key={`${e.start}-${e.event}`} e={e} />
            ))}
          </ul>
        )}
        {outcome.kind === "menus" && <MenuButtons items={outcome.items} />}
        {outcome.kind === "loans" && (
          <ul className="list">
            {outcome.items.map((l) => (
              <LoanRow key={l.id} l={l} />
            ))}
          </ul>
        )}
        {outcome.kind === "seats" && (
          <ul className="list">
            {outcome.items.map((r) => (
              <SeatRow key={`${r.library}-${r.name}`} r={r} />
            ))}
          </ul>
        )}
        {outcome.kind === "recordings" && (
          <ul className="list">
            {outcome.items.map((r) => (
              <RecordingRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </div>
      {actions.length > 0 && (
        <div className="stage-actions">
          {actions.map(({ label, icon: Icon, run, done }, i) => (
            <button
              key={label}
              type="button"
              className={`btn btn-lg ${i === 0 ? "btn-primary" : "btn-tonal"}`}
              disabled={done}
              onClick={run}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

