import type { ReactElement } from "react";
import type { Assignment, Lecture } from "../data";
import { dateLabel, dayDiff } from "../format";
import { AssignmentRow, LectureRow } from "./Rows";

/** Deadlines grouped by day, earliest first. Only days with something due appear. */
export function Timeline({ assignments, lectures }: { assignments: Assignment[]; lectures: Lecture[] }) {
  const entries: { at: Date; node: ReactElement }[] = [
    ...assignments.map((a) => ({ at: a.due, node: <AssignmentRow key={a.id} a={a} /> })),
    ...lectures.map((l) => ({ at: l.until, node: <LectureRow key={l.id} l={l} /> })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const days = [...new Set(entries.map((e) => dayDiff(e.at)))];
  return (
    <ol className="timeline">
      {days.map((d) => {
        const dayEntries = entries.filter((e) => dayDiff(e.at) === d);
        return (
          <li key={d} className="tl-day">
            <p className={`tl-date${d === 0 ? " is-today" : ""}`}>{dateLabel(dayEntries[0].at)}</p>
            <ul className="list">{dayEntries.map((e) => e.node)}</ul>
          </li>
        );
      })}
    </ol>
  );
}
