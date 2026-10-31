import { Monitor, Moon, Sun } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useStore, type Theme } from "../store";

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "시스템", icon: Monitor },
  { value: "light", label: "밝게", icon: Sun },
  { value: "dark", label: "어둡게", icon: Moon },
];

function Toggle({ id, label, hint, defaultOn }: { id: string; label: string; hint: string; defaultOn: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="setting-row">
      <div>
        <label htmlFor={id} className="setting-label">
          {label}
        </label>
        <p className="setting-hint">{hint}</p>
      </div>
      <button id={id} type="button" role="switch" aria-checked={on} className="switch" onClick={() => setOn((v) => !v)}>
        <span className="switch-knob" />
        <span className="sr-only">{on ? "켜짐" : "꺼짐"}</span>
      </button>
    </div>
  );
}

export function Settings() {
  const { theme, setTheme, showToast } = useStore();
  const demoSave = (what: string) => (e: FormEvent) => {
    e.preventDefault();
    showToast(`${what} 확인했어요`, "시안이라 입력값을 저장하거나 보내지 않아요");
  };
  return (
    <div className="page page-narrow">
      <header className="page-head">
        <h1 className="page-title">설정</h1>
      </header>

      <section className="settings-group">
        <h2 className="section-title">화면</h2>
        <div className="setting-row">
          <p className="setting-label" id="theme-label">
            테마
          </p>
          <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
            {themes.map(({ value, label, icon: Icon }) => (
              <button key={value} type="button" role="radio" aria-checked={theme === value} className="segment" onClick={() => setTheme(value)}>
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <form className="settings-group" onSubmit={demoSave("학교 계정을")}>
        <h2 className="section-title">학교 계정</h2>
        <div className="field">
          <label htmlFor="sid">학번</label>
          <input id="sid" className="input" inputMode="numeric" autoComplete="username" placeholder="10자리 숫자" />
        </div>
        <div className="field">
          <label htmlFor="pw">비밀번호</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" />
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-secondary">
            연결 확인
          </button>
        </div>
      </form>

      <form className="settings-group" onSubmit={demoSave("요약 키를")}>
        <h2 className="section-title">문장 명령</h2>
        <div className="field">
          <label htmlFor="apikey">요약용 API 키</label>
          <input id="apikey" className="input input-mono" type="password" autoComplete="off" placeholder="sk-로 시작하는 키" />
          <p className="setting-hint">키가 없으면 미리 정한 문장만 알아들어요.</p>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-secondary">
            키 확인
          </button>
        </div>
      </form>

      <section className="settings-group">
        <h2 className="section-title">자료 받기</h2>
        <div className="field">
          <label htmlFor="folder">저장 폴더</label>
          <input id="folder" className="input input-mono" defaultValue="~/Downloads/LMS" />
        </div>
        <Toggle id="by-course" label="과목별 폴더로 나누기" hint="켜면 과목 이름 폴더 안에 주차별로 저장해요." defaultOn />
      </section>

      <section className="settings-group">
        <h2 className="section-title">알림</h2>
        <Toggle id="notify-due" label="마감 하루 전 알림" hint="켜면 마감 24시간 전에 한 번 알려요." defaultOn />
        <Toggle id="notify-notice" label="새 공지 알림" hint="켜면 공지가 올라오는 즉시 알려요." defaultOn={false} />
      </section>
    </div>
  );
}
