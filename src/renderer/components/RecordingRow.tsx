import { Captions, FolderOpen, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { SttEvent, SttPlan } from "../../shared/types";
import type { Recording } from "../data";
import { api } from "../store";
import { CourseTag } from "./Rows";

type Step =
  | { step: "idle" }
  | { step: "planning" }
  | { step: "planned"; plan: SttPlan }
  | { step: "running"; lines: string[] }
  | { step: "done"; text: string; summary: string; folder: string }
  | { step: "failed"; text: string };

function apply(current: Step, e: SttEvent): Step {
  switch (e.kind) {
    case "progress":
      return current.step === "running" ? { step: "running", lines: [...current.lines, e.text] } : current;
    case "done":
      return { step: "done", text: e.text, summary: e.summary, folder: e.folder };
    case "failed":
      return { step: "failed", text: e.text };
  }
}

function Panel({ state, onStart, onClose }: { state: Step; onStart: () => void; onClose: () => void }) {
  switch (state.step) {
    case "idle":
      return null;
    case "planning":
      return (
        <div className="rec-panel">
          <p className="rec-line">
            <LoaderCircle size={14} className="spin" aria-hidden="true" /> 자막이 있는지 확인하는 중이에요
          </p>
        </div>
      );
    case "planned":
      return (
        <div className="rec-panel">
          <p>{state.plan.text}</p>
          <div className="rec-actions">
            {state.plan.ok && (
              <button type="button" className="btn btn-primary" onClick={onStart}>
                시작
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              취소
            </button>
          </div>
        </div>
      );
    case "running":
      return (
        <div className="rec-panel">
          <ul className="rec-lines" aria-live="polite">
            {state.lines.length === 0 && (
              <li className="rec-line">
                <LoaderCircle size={14} className="spin" aria-hidden="true" /> 시작하는 중이에요
              </li>
            )}
            {state.lines.map((line, i) => (
              <li key={`${i}-${line}`} className="rec-line">
                {i === state.lines.length - 1 ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : null}
                {line}
              </li>
            ))}
          </ul>
        </div>
      );
    case "done":
      return (
        <div className="rec-panel">
          <p>{state.text}</p>
          <pre className="rec-summary">{state.summary}</pre>
          <div className="rec-actions">
            <button type="button" className="btn btn-secondary" onClick={() => void api().openFolder(state.folder)}>
              <FolderOpen size={16} aria-hidden="true" />
              <span>폴더 열기</span>
            </button>
          </div>
        </div>
      );
    case "failed":
      return (
        <div className="rec-panel is-failed">
          <p>{state.text}</p>
        </div>
      );
  }
}

export function RecordingRow({ r, showCourse = true, showWeek = true }: { r: Recording; showCourse?: boolean; showWeek?: boolean }) {
  const [state, setState] = useState<Step>({ step: "idle" });
  const minutes = Math.max(1, Math.round(r.seconds / 60));
  const busy = state.step === "planning" || state.step === "planned" || state.step === "running";

  useEffect(
    () =>
      api().onStt((e) => {
        if (e.id === r.id) setState((current) => apply(current, e));
      }),
    [r.id],
  );

  const plan = async () => {
    setState({ step: "planning" });
    const result = await api()
      .sttPlan(r.id)
      .catch(() => ({ ok: false, text: "강의 정보를 읽지 못했어요. 다시 눌러 주세요" }));
    setState({ step: "planned", plan: result });
  };

  const start = (
    <button
      type="button"
      className="btn btn-row"
      disabled={busy}
      aria-label={`${r.title} 자막·요약 만들기`}
      title="자막·요약 만들기"
      onClick={() => void plan()}
    >
      <Captions size={16} aria-hidden="true" />
      <span className="btn-label">자막·요약 만들기</span>
    </button>
  );

  return (
    <li className="row row-rec">
      <div className="row-main">
        <span className="row-title">
          {showWeek && r.week ? `${r.week}주차 ` : ""}
          {r.title}
        </span>
        <span className="row-meta">
          {showCourse && <CourseTag id={r.courseId} />}
          <span>{minutes}분</span>
          {r.watched && <span className="rec-seen">본 강의</span>}
        </span>
      </div>
      {start}
      <Panel
        state={state}
        onStart={() => {
          setState({ step: "running", lines: [] });
          void api().sttRun(r.id);
        }}
        onClose={() => setState({ step: "idle" })}
      />
    </li>
  );
}
