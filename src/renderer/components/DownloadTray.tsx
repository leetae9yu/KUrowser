import { Check, X } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "../store";

const CLOSE_AFTER_MS = 2500;

export function DownloadTray() {
  const { jobs, trayHidden, cancelDownloads, clearDownloads } = useStore();
  const live = jobs.filter((j) => j.state !== "canceled");
  const done = live.filter((j) => j.state === "done").length;
  const running = live.some((j) => j.state === "queued" || j.state === "active");

  // A finished batch closes itself; the result already shows where the student is looking.
  useEffect(() => {
    if (running || live.length === 0 || trayHidden) return;
    const t = window.setTimeout(clearDownloads, CLOSE_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [running, live.length, trayHidden, clearDownloads]);

  if (live.length === 0 || trayHidden) return null;
  const pct = Math.round((live.reduce((sum, j) => sum + j.progress, 0) / live.length) * 100);
  const failed = live.filter((j) => j.state === "failed").length;
  const current = live.filter((j) => j.state === "active").map((j) => j.file.name);
  return (
    <aside className="tray" aria-label="자료 받기 진행">
      <div className="tray-head">
        {running ? (
          <p className="tray-title">
            자료 받는 중 <span className="tray-count">{done}/{live.length}</span>
          </p>
        ) : (
          <p className="tray-title">
            <Check size={16} aria-hidden="true" className="tray-ok" />
            자료 {done}개를 받았어요{failed ? `, ${failed}개는 못 받았어요` : ""}
          </p>
        )}
        {running ? (
          <button type="button" className="btn btn-quiet btn-sm" onClick={cancelDownloads}>
            취소
          </button>
        ) : (
          <button type="button" className="icon-btn" aria-label="닫기" title="닫기" onClick={clearDownloads}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="전체 진행률">
        <div className="bar-fill" style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <p className="tray-sub">{running ? current.join(", ") || "대기 중" : "다운로드/KUrowser의 과목별 폴더에 저장했어요"}</p>
    </aside>
  );
}
