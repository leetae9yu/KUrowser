import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { courseOf, type CourseId, type FileItem, type Recording } from "../data";
import { jobFor, useStore } from "../store";
import { byWeek } from "../groups";
import { RecordingRow } from "./RecordingRow";
import { FileRow } from "./Rows";

function byCourse<T extends { courseId: CourseId }>(items: T[], order: CourseId[]): Array<[CourseId, T[]]> {
  const groups = new Map<CourseId, T[]>();
  for (const item of items) groups.set(item.courseId, [...(groups.get(item.courseId) ?? []), item]);
  return [...groups].sort(([a], [b]) => (order.indexOf(a) + 1 || Infinity) - (order.indexOf(b) + 1 || Infinity));
}

function GroupCard({ courseId, line, done, total, open, onToggle, children }: { courseId: CourseId; line: string; done: number; total: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  const course = courseOf(useStore().data, courseId);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const body = useId();
  return (
    <li className={`group${open ? " is-open" : ""}`}>
      <button type="button" className="group-head" aria-expanded={open} aria-controls={body} onClick={onToggle}>
        <span className={`dot dot-lg hue-${course.hue}`} aria-hidden="true" />
        <span className="group-main">
          <span className="row-title">{course.name}</span>
          <span className="group-line">{line}</span>
          <span className="bar group-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${course.name} 진행률`}>
            <span className="bar-fill" style={{ transform: `scaleX(${pct / 100})` }} />
          </span>
        </span>
        {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      </button>
      {open && (
        <div className="group-body" id={body}>
          {children}
        </div>
      )}
    </li>
  );
}

function Weeks<T extends { id: string }>({ items, label, row }: { items: T[]; label: (item: T) => string; row: (item: T) => ReactNode }) {
  return (
    <>
      {byWeek(items, label).map((g) => (
        <section key={g.label} className="group-week">
          <h3 className="sub-title">{g.label}</h3>
          <ul className="list">{g.items.map(row)}</ul>
        </section>
      ))}
    </>
  );
}

/**
 * Materials as one card per course ("자료 24개 중 20개 받음 · 새 자료 3" and a bar); a card opens that course's
 * files by week. One button on top takes every new file not yet saved.
 */
export function FileGroups({ courseId, onlyNew }: { courseId?: CourseId; onlyNew?: boolean }) {
  const { data, downloaded, jobs, download } = useStore();
  const scope = data.files.filter((f) => !courseId || f.courseId === courseId);
  const saved = (f: FileItem) => downloaded.has(f.id);
  const isFresh = (f: FileItem) => f.isNew && f.available && !saved(f);
  const groups = byCourse(scope, data.courses.map((c) => c.id)).filter(([, files]) => !onlyNew || files.some(isFresh));
  const [open, setOpen] = useState<CourseId | null>(courseId ?? (groups.length === 1 ? groups[0]![0] : null));
  const fresh = scope.filter((f) => isFresh(f) && !jobFor(jobs, f.id));
  if (!groups.length) return null;
  return (
    <>
      <div className="stage-actions group-top">
        <button type="button" className="btn btn-lg btn-primary" disabled={!fresh.length} onClick={() => download(fresh)}>
          <Download size={18} aria-hidden="true" />
          <span>{fresh.length ? `새 자료만 다 받기 (${fresh.length})` : "새 자료를 모두 받았어요"}</span>
        </button>
      </div>
      <ul className="groups">
        {groups.map(([id, files]) => {
          const got = files.filter(saved).length;
          const news = files.filter(isFresh).length;
          const left = files.filter((f) => f.available && !saved(f) && !jobFor(jobs, f.id));
          return (
            <GroupCard
              key={id}
              courseId={id}
              line={`자료 ${files.length}개 중 ${got}개 받음${news ? ` · 새 자료 ${news}` : ""}`}
              done={got}
              total={files.length}
              open={open === id}
              onToggle={() => setOpen(open === id ? null : id)}
            >
              <Weeks items={files} label={(f) => f.folder || "기타"} row={(f) => <FileRow key={f.id} f={f} showCourse={false} showFolder={false} />} />
              {left.length > 0 && (
                <button type="button" className="btn btn-tonal group-all" onClick={() => download(left)}>
                  <Download size={16} aria-hidden="true" />
                  <span>이 과목 남은 자료 {left.length}개 받기</span>
                </button>
              )}
            </GroupCard>
          );
        })}
      </ul>
    </>
  );
}

/** Recorded lectures as one card per course ("12강 중 9강 봄" and a bar); a card opens its lectures by week. */
export function RecordingGroups({ items, courseId }: { items: Recording[]; courseId?: CourseId }) {
  const { data } = useStore();
  const groups = byCourse(items, data.courses.map((c) => c.id));
  const [open, setOpen] = useState<CourseId | null>(courseId ?? (groups.length === 1 ? groups[0]![0] : null));
  return (
    <ul className="groups">
      {groups.map(([id, recs]) => {
        const seen = recs.filter((r) => r.watched).length;
        return (
          <GroupCard key={id} courseId={id} line={`${recs.length}강 중 ${seen}강 봄`} done={seen} total={recs.length} open={open === id} onToggle={() => setOpen(open === id ? null : id)}>
            <Weeks
              items={[...recs].sort((a, b) => (a.week ?? Infinity) - (b.week ?? Infinity))}
              label={(r) => (r.week ? `${r.week}주차` : "주차 없음")}
              row={(r) => <RecordingRow key={r.id} r={r} showCourse={false} showWeek={false} />}
            />
          </GroupCard>
        );
      })}
    </ul>
  );
}
