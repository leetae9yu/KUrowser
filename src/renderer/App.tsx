import { ArrowLeft, Settings as SettingsIcon, X } from "lucide-react";
import { DownloadTray } from "./components/DownloadTray";
import { Toast } from "./components/Toast";
import { fullDate, today0 } from "./format";
import { href, useRoute } from "./router";
import { Chat } from "./screens/Chat";
import { Settings } from "./screens/Settings";
import { api, useStore } from "./store";

export default function App() {
  const route = useRoute();
  const { pane, settings } = useStore();
  const layout = pane.open ? (pane.wide ? "wide" : "narrow") : "solo";
  const inChat = route.name === "today";
  const ai = !!settings?.aiConnected;

  return (
    <div className={`app layout-${layout} app-${route.name}`}>
      {layout === "wide" && (
        <div className="pane-col">
          <div className="pane-bar">
            <button type="button" className="icon-btn" aria-label="학교 화면 뒤로" title="뒤로" disabled={!pane.canGoBack} onClick={() => void api().paneBack()}>
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
            <p className="pane-title">{pane.title}</p>
            <button type="button" className="icon-btn" aria-label="학교 화면 닫기" title="닫기" onClick={() => void api().paneClose()}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
      <div className="chat-col">
        <header className="appbar">
          {inChat ? (
            <div className="appbar-lead">
              <p className="appbar-date">{fullDate(today0)}</p>
              <p className={`appbar-status${ai ? " is-on" : ""}`}>
                <span className="status-dot" aria-hidden="true" />
                {ai ? "고대 AI 연결됨" : "고대 AI 연결 안 됨"}
              </p>
            </div>
          ) : (
            <a className="btn btn-ghost back" href={href({ name: "today" })}>
              <ArrowLeft size={18} aria-hidden="true" />
              <span>돌아가기</span>
            </a>
          )}
          <nav className="appbar-nav" aria-label="다른 화면">
            <a
              className="icon-btn"
              href={href({ name: "settings" })}
              aria-label="설정"
              title="설정"
              aria-current={route.name === "settings" ? "page" : undefined}
            >
              <SettingsIcon size={20} aria-hidden="true" />
            </a>
          </nav>
        </header>
        {layout === "narrow" && (
          <div className="pane-banner">
            <p role="status">학교 화면이 열려 있어요</p>
            <button type="button" className="btn btn-tonal btn-sm" onClick={() => void api().paneWiden()}>
              넓혀서 보기
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api().paneClose()}>
              닫기
            </button>
          </div>
        )}
        <main className="main">
          <Chat active={inChat} />
          {route.name === "settings" && <Settings />}
        </main>
      </div>
      {/* The stage card shows download progress in place; the tray serves the other screens. */}
      {route.name !== "today" && <DownloadTray />}
      <Toast />
    </div>
  );
}
