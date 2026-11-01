import { ExternalLink, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AmsSummary } from "../../shared/types";
import { api, useStore } from "../store";
import { termOrder } from "../../shared/terms";

export type AmsTopic = "grades" | "timetable" | "credits";

const DAYS = ["월", "화", "수", "목", "금", "토"];

function Body({ topic, data }: { topic: AmsTopic; data: AmsSummary }) {
  if (topic === "timetable") {
    if (!data.classes.length) return <p className="hero-sub">{data.term} 시간표에 수업이 없어요</p>;
    return (
      <ul className="list">
        {DAYS.flatMap((day) =>
          data.classes
            .filter((c) => c.day === day)
            .map((c) => (
              <li key={`${day}-${c.begins}-${c.title}`} className="row">
                <div className="row-main">
                  <span className="row-title">{c.title}</span>
                  <span className="row-meta">
                    <span>
                      {day} {c.begins}-{c.ends}
                    </span>
                    {c.room && <span>{c.room}</span>}
                  </span>
                </div>
              </li>
            )),
        )}
      </ul>
    );
  }
  const summary = (
    <ul className="list">
      <li className="row">
        <div className="row-main">
          <span className="row-title">지금까지 취득 {data.earned || "-"}학점, 평점 {data.gpa || "-"}</span>
          <span className="row-meta">
            <span>
              {data.term} 신청 {data.enrolledCredits}학점
            </span>
          </span>
        </div>
      </li>
    </ul>
  );
  if (topic === "credits") {
    const lines = (items: AmsSummary["terms"]) => (
      <ul className="list">
        {items.map((t) => (
          <li key={t.label} className="row credit-line">
            <span className="row-title">{t.label}</span>
            <span className="credit-num">
              {t.earned}학점{t.gpa && <span className="credit-gpa"> · 평점 {t.gpa}</span>}
            </span>
          </li>
        ))}
      </ul>
    );
    return (
      <>
        {summary}
        {data.categories.length > 0 && (
          <>
            <h3 className="sub-title">이수구분별 취득</h3>
            {lines(data.categories)}
          </>
        )}
        {data.terms.length > 0 && (
          <>
            <h3 className="sub-title">학기별 취득</h3>
            {lines(data.terms)}
          </>
        )}
      </>
    );
  }
  const latest = [...new Set(data.grades.map((g) => g.term))].sort((a, b) => termOrder(a) - termOrder(b)).at(-1);
  const rows = data.grades.filter((g) => g.term === latest);
  return (
    <>
      {summary}
      {latest && <p className="chips-label">{latest}</p>}
      <ul className="list">
        {rows.map((g) => (
          <li key={`${g.term}-${g.title}`} className="row">
            <div className="row-main">
              <span className="row-title">{g.title}</span>
              <span className="row-meta">
                <span>{g.grade || "-"}</span>
                <span>{g.credits}학점</span>
                {g.category && <span>{g.category}</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

const TITLES: Record<AmsTopic, string> = { grades: "성적", timetable: "이번 학기 시간표", credits: "이수 학점 현황" };

/** Grades, timetable or credits from the academic system; asks for the mailed code in place when it needs one. */
export function AmsCard({ topic }: { topic: AmsTopic }) {
  const { ams } = useStore();
  const [code, setCode] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void api()
      .amsCode(code)
      .then((ok) => ok && setCode(""));
  };
  let body;
  if (ams.phase === "ready" && ams.data) body = <Body topic={topic} data={ams.data} />;
  else if (ams.phase === "code")
    body = (
      <form className="ams-code" onSubmit={submit}>
        <p className="hero-sub">
          학사시스템이 {ams.mask || "학교 메일"}로 인증번호를 보냈어요. 메일에 온 6자리 번호를 넣어 주세요.
        </p>
        {ams.message && <p className="hero-sub" role="alert">{ams.message}</p>}
        <input
          className="command-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-label="인증번호 6자리"
          placeholder="인증번호 6자리"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        />
        <div className="stage-actions">
          <button type="submit" className="btn btn-lg btn-primary" disabled={code.length !== 6}>
            <KeyRound size={18} aria-hidden="true" />
            <span>확인</span>
          </button>
          <button type="button" className="btn btn-lg btn-ghost" onClick={() => void api().amsCancel()}>
            그만두기
          </button>
        </div>
      </form>
    );
  else if (ams.phase === "error")
    body = (
      <>
        <p className="hero-sub">{ams.message ?? "학사시스템을 읽지 못했어요"}</p>
        <div className="stage-actions">
          {ams.needsLogin && (
            <button type="button" className="btn btn-lg btn-primary" onClick={() => void api().openMenu(topic === "timetable" ? "timetable" : "grades")}>
              <ExternalLink size={18} aria-hidden="true" />
              <span>왼쪽에서 로그인하기</span>
            </button>
          )}
          <button type="button" className={`btn btn-lg ${ams.needsLogin ? "btn-tonal" : "btn-primary"}`} onClick={() => void api().amsStart()}>
            <RefreshCw size={18} aria-hidden="true" />
            <span>{ams.needsLogin ? "다시 읽기" : "다시 시도"}</span>
          </button>
        </div>
      </>
    );
  else
    body = (
      <p className="hero-sub">
        <LoaderCircle size={14} className="spin" aria-hidden="true" />{" "}
        {ams.phase === "verifying" ? "인증번호를 확인하는 중이에요" : ams.phase === "loading" ? "학사시스템에서 읽는 중이에요" : "학사시스템에 인증번호를 보내는 중이에요"}
      </p>
    );
  return (
    <div className="result">
      <h2 className="result-title">{TITLES[topic]}</h2>
      <div className="result-body">{body}</div>
    </div>
  );
}
