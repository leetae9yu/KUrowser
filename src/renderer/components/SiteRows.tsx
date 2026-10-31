import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { Loan, PortalNotice, ScheduleEntry, SchoolMenu, SeatRoom } from "../../shared/types";
import { ago } from "../format";
import { api, useStore } from "../store";

export function PortalRow({ n }: { n: PortalNotice }) {
  const { read, markRead } = useStore();
  const [open, setOpen] = useState(false);
  const unread = !n.read && !read.has(n.id);
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
          {n.office && <span>{n.office}</span>}
          {n.postedAt && <span>{ago(new Date(n.postedAt))}</span>}
          {n.files > 0 && <span>첨부 {n.files}개</span>}
        </span>
        {!open && n.preview && <span className="notice-summary">{n.preview.slice(0, 90)}</span>}
        {open && (
          <>
            <p className="notice-body">{n.body || n.preview}</p>
            <button type="button" className="btn btn-ghost notice-open" onClick={() => void api().openPortalNotice(n.id)}>
              <ExternalLink size={16} aria-hidden="true" />
              <span>포털에서 원문 보기</span>
            </button>
          </>
        )}
      </div>
      <button type="button" className="btn btn-row" aria-expanded={open} aria-label={`${n.title} ${open ? "접기" : "읽기"}`} title={open ? "접기" : "읽기"} onClick={toggle}>
        {open ? <ChevronUp size={16} aria-hidden="true" className="phone-only" /> : <ChevronDown size={16} aria-hidden="true" className="phone-only" />}
        <span className="btn-label">{open ? "접기" : "읽기"}</span>
      </button>
    </li>
  );
}

const monthDay = (iso: string): string => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

export function ScheduleRow({ e }: { e: ScheduleEntry }) {
  return (
    <li className="row">
      <div className="row-main">
        <span className="row-title">{e.event}</span>
        <span className="row-meta">
          <span>{e.start === e.end ? monthDay(e.start) : `${monthDay(e.start)} ~ ${monthDay(e.end)}`}</span>
        </span>
      </div>
    </li>
  );
}

/** Whole days from today to a `YYYY-MM-DD` date; negative once it has passed. */
export function daysUntil(iso: string, today = new Date()): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((new Date(`${iso}T00:00:00`).getTime() - start) / 86_400_000);
}

export function LoanRow({ l }: { l: Loan }) {
  const left = daysUntil(l.due);
  const level = left < 0 ? "urgent" : left <= 2 ? "soon" : "later";
  return (
    <li className="row">
      <div className="row-main">
        <span className="row-title">{l.title}</span>
        <span className="row-meta">
          {l.place && <span>{l.place}</span>}
          <span className={`due due-${level}`}>{left < 0 ? `반납일 ${-left}일 지남` : left === 0 ? "오늘 반납" : `${monthDay(l.due)} 반납(D-${left})`}</span>
          {l.renewals > 0 && <span>연장 {l.renewals}번</span>}
        </span>
      </div>
    </li>
  );
}

export function SeatRow({ r }: { r: SeatRoom }) {
  return (
    <li className="row">
      <div className="row-main">
        <span className="row-title">
          {r.library} {r.name}
        </span>
        <span className="row-meta">
          <span className={`due due-${r.available ? "later" : "urgent"}`}>
            빈자리 {r.available} / {r.total}
          </span>
          <span>{r.hours}</span>
        </span>
      </div>
    </li>
  );
}

export function MenuButtons({ items }: { items: SchoolMenu[] }) {
  const { showToast } = useStore();
  return (
    <ul className="chips">
      {items.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            className="chip"
            onClick={() => void api().openMenu(m.id).then((ok) => showToast(ok ? `왼쪽에 ${m.label} 화면을 열었어요` : "그 화면을 열지 못했어요"))}
          >
            {m.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
