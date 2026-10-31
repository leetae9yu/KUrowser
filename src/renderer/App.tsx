import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { DownloadTray } from "./components/DownloadTray";
import { Toast } from "./components/Toast";
import { fullDate, today0 } from "./format";
import { href, useRoute } from "./router";
import { Home } from "./screens/Home";
import { Settings } from "./screens/Settings";

export default function App() {
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route.name]);

  return (
    <div className={`app app-${route.name}`}>
      <header className="appbar">
        {route.name === "today" ? (
          <p className="appbar-date">{fullDate(today0)}</p>
        ) : (
          <a className="btn btn-ghost back" href={href({ name: "today" })}>
            <ArrowLeft size={18} aria-hidden="true" />
            <span>할 일</span>
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
      <main className="main" ref={mainRef}>
        {route.name === "today" && <Home />}
        {route.name === "settings" && <Settings />}
      </main>
      {/* Home shows download progress in place; the tray serves the other screens. */}
      {route.name !== "today" && <DownloadTray />}
      <Toast />
    </div>
  );
}
