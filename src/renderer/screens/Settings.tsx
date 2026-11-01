import { FolderOpen, LogIn, LogOut, Monitor, Moon, Sparkles, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import type { Settings as AppSettings } from "../../shared/types";
import { api, useStore, type Theme } from "../store";

const clock = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

/** The AI errors since the app started: how many, the last one (status, model, time), and a Jev pause if one runs. */
function aiErrorLine({ count, last, pausedUntil }: AppSettings["aiErrors"]): string {
  if (!last) return "";
  const status = typeof last.status === "number" ? `HTTP ${last.status}` : last.status === "timeout" ? "시간 초과" : "연결 실패";
  const pause = pausedUntil ? ` · ${clock(pausedUntil)}까지 Jev 대신 간단한 분류를 써요` : "";
  return `AI 오류 ${count}번 · 마지막 ${clock(last.at)} ${status} (${last.model || "AI"})${pause}`;
}

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "시스템", icon: Monitor },
  { value: "light", label: "밝게", icon: Sun },
  { value: "dark", label: "어둡게", icon: Moon },
];

export function Settings() {
  const { theme, setTheme, settings, setSettings, snapshot, login, showToast } = useStore();
  const [aiStatus, setAiStatus] = useState("");
  const [connecting, setConnecting] = useState(false);
  const signedIn = snapshot.phase !== "login";

  useEffect(() => api().onAiStatus(setAiStatus), []);

  const connectAi = async () => {
    setConnecting(true);
    const result = await api().connectAi();
    setConnecting(false);
    setAiStatus(result.ok ? "" : result.text);
    setSettings(await api().settings());
    if (result.ok) showToast("고대 AI를 연결했어요");
  };

  const toggleNotify = async () => {
    if (settings) setSettings(await api().setNotifyDue(!settings.notifyDue));
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

      <section className="settings-group">
        <h2 className="section-title">학교 계정</h2>
        <div className="setting-row">
          <div>
            <p className="setting-label">{signedIn ? "로그인되어 있어요" : "로그인이 필요해요"}</p>
            <p className="setting-hint">비밀번호는 학교 로그인 창에만 넣어요. 앱은 비밀번호를 받거나 저장하지 않아요.</p>
          </div>
          {signedIn ? (
            <button type="button" className="btn btn-secondary" onClick={() => void api().logout()}>
              <LogOut size={16} aria-hidden="true" />
              <span>로그아웃</span>
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => void login()}>
              <LogIn size={16} aria-hidden="true" />
              <span>로그인</span>
            </button>
          )}
        </div>
      </section>

      <section className="settings-group">
        <h2 className="section-title">고대 AI</h2>
        <div className="setting-row">
          <div>
            <p className="setting-label">{settings?.aiConnected ? settings.aiLabel : "연결 안 됨"}</p>
            <p className="setting-hint">
              {aiStatus ||
                (settings?.aiConnected
                  ? "한 문장 명령과 공지 한 줄 요약에 써요. 누를 때만 AI를 불러요."
                  : "연결하면 아무 문장이나 알아듣고 공지를 한 줄로 줄여 드려요. 연결 전에는 버튼으로 골라 주세요.")}
            </p>
            {settings?.aiErrors.last && <p className="setting-hint">{aiErrorLine(settings.aiErrors)}</p>}
          </div>
          {!settings?.aiConnected && (
            <button type="button" className="btn btn-primary" disabled={connecting} onClick={() => void connectAi()}>
              <Sparkles size={16} aria-hidden="true" />
              <span>{connecting ? "연결하는 중" : "고대 AI 연결"}</span>
            </button>
          )}
        </div>
      </section>

      <section className="settings-group">
        <h2 className="section-title">자료 받기</h2>
        <div className="setting-row">
          <div>
            <p className="setting-label">저장 폴더</p>
            <p className="setting-hint input-mono">{settings?.downloadDir ?? ""}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => void api().openDownloads()}>
            <FolderOpen size={16} aria-hidden="true" />
            <span>폴더 열기</span>
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="section-title">알림</h2>
        <div className="setting-row">
          <div>
            <label htmlFor="notify-due" className="setting-label">
              마감 하루 전 알림
            </label>
            <p className="setting-hint">알림을 켠 과제는 마감 24시간 전에 한 번 알려요. 앱이 켜져 있을 때만 알려요.</p>
          </div>
          <button id="notify-due" type="button" role="switch" aria-checked={!!settings?.notifyDue} className="switch" onClick={() => void toggleNotify()}>
            <span className="switch-knob" />
            <span className="sr-only">{settings?.notifyDue ? "켜짐" : "꺼짐"}</span>
          </button>
        </div>
      </section>
    </div>
  );
}
