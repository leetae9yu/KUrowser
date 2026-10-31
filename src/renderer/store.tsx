import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { lectures, notices, type Assignment, type FileItem, type Lecture } from "./data";

export type Theme = "system" | "light" | "dark";

export interface Job {
  id: string;
  file: FileItem;
  progress: number;
  state: "queued" | "active" | "done" | "canceled";
}

interface Store {
  watched: Set<string>;
  read: Set<string>;
  opened: Set<string>;
  reminders: Set<string>;
  downloaded: Set<string>;
  jobs: Job[];
  trayHidden: boolean;
  theme: Theme;
  toast: { id: number; text: string; note?: string } | null;
  setTheme: (t: Theme) => void;
  watch: (l: Lecture) => void;
  markRead: (ids: string[]) => void;
  remind: (ids: string[]) => void;
  openAssignment: (a: Assignment) => void;
  download: (files: FileItem[]) => number;
  cancelDownloads: () => void;
  clearDownloads: () => void;
  showToast: (text: string, note?: string) => void;
}

const StoreContext = createContext<Store | null>(null);

const MAX_PARALLEL = 3;
export const DEMO_NOTE = "시안이라 학교 화면으로 이동하지 않아요";
const TICK_MS = 120;

function readTheme(): Theme {
  const saved = localStorage.getItem("theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [watched, setWatched] = useState(() => new Set(lectures.filter((l) => l.watchedAtStart).map((l) => l.id)));
  const [read, setRead] = useState(() => new Set(notices.filter((n) => n.readAtStart).map((n) => n.id)));
  const [opened, setOpened] = useState(() => new Set<string>());
  const [reminders, setReminders] = useState(() => new Set<string>());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [trayHidden, setTrayHidden] = useState(false);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [toast, setToast] = useState<Store["toast"]>(null);
  const toastSeq = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const busy = jobs.some((j) => j.state === "queued" || j.state === "active");
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      setJobs((prev) => {
        let active = prev.filter((j) => j.state === "active").length;
        return prev.map((j) => {
          if (j.state === "active") {
            const step = Math.min(0.2, Math.max(0.04, 0.5 / j.file.sizeMB));
            const progress = Math.min(1, j.progress + step);
            return progress >= 1 ? { ...j, progress: 1, state: "done" } : { ...j, progress };
          }
          if (j.state === "queued" && active < MAX_PARALLEL) {
            active += 1;
            return { ...j, state: "active" };
          }
          return j;
        });
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [busy]);

  const downloaded = useMemo(() => new Set(jobs.filter((j) => j.state === "done").map((j) => j.file.id)), [jobs]);

  const showToast = useCallback((text: string, note?: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, note });
  }, []);

  const watch = useCallback(
    (l: Lecture) => {
      setWatched((prev) => new Set(prev).add(l.id));
      showToast(`${l.week}주차 「${l.title}」 강의를 새 탭에서 열었어요`, DEMO_NOTE);
    },
    [showToast],
  );

  const markRead = useCallback((ids: string[]) => {
    setRead((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const remind = useCallback((ids: string[]) => {
    setReminders((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const openAssignment = useCallback(
    (a: Assignment) => {
      setOpened((prev) => new Set(prev).add(a.id));
      showToast(`「${a.title}」 과제 페이지를 새 탭에서 열었어요`, DEMO_NOTE);
    },
    [showToast],
  );

  const download = useCallback((list: FileItem[]) => {
    let added = 0;
    if (list.length) setTrayHidden(false);
    setJobs((prev) => {
      const taken = new Set(prev.filter((j) => j.state !== "canceled").map((j) => j.file.id));
      const fresh = list.filter((f) => !taken.has(f.id));
      added = fresh.length;
      const kept = prev.filter((j) => j.state !== "canceled");
      return [...kept, ...fresh.map((f) => ({ id: f.id, file: f, progress: 0, state: "queued" as const }))];
    });
    return added;
  }, []);

  const cancelDownloads = useCallback(() => {
    setJobs((prev) => prev.map((j) => (j.state === "queued" || j.state === "active" ? { ...j, state: "canceled" } : j)));
  }, []);

  // Hiding the tray keeps the job history: finished files stay "downloaded".
  const clearDownloads = useCallback(() => setTrayHidden(true), []);

  const value: Store = {
    watched,
    read,
    opened,
    reminders,
    downloaded,
    jobs,
    trayHidden,
    theme,
    toast,
    setTheme: setThemeState,
    watch,
    markRead,
    remind,
    openAssignment,
    download,
    cancelDownloads,
    clearDownloads,
    showToast,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}

export function jobFor(jobs: Job[], fileId: string): Job | undefined {
  return jobs.find((j) => j.file.id === fileId && j.state !== "canceled");
}
