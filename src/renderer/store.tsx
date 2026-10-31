import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DownloadEvent, KurowserApi, Settings, Snapshot } from "../shared/types";
import { toData, type Assignment, type Data, type FileItem, type Lecture } from "./data";

declare global {
  interface Window {
    kurowser: KurowserApi;
  }
}

export const api = (): KurowserApi => window.kurowser;

export type Theme = "system" | "light" | "dark";

export interface Job {
  id: string;
  file: FileItem;
  progress: number;
  state: "queued" | "active" | "done" | "failed" | "canceled";
}

interface Store {
  snapshot: Snapshot;
  data: Data;
  settings: Settings | null;
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
  summarize: (ids: string[]) => Promise<void>;
  remind: (ids: string[]) => Promise<void>;
  openAssignment: (a: Assignment) => void;
  download: (files: FileItem[]) => number;
  cancelDownloads: () => void;
  clearDownloads: () => void;
  showToast: (text: string, note?: string) => void;
  login: () => Promise<void>;
  setSettings: (s: Settings) => void;
}

const StoreContext = createContext<Store | null>(null);

const EMPTY: Snapshot = { phase: "loading", error: null, courses: [], assignments: [], lectures: [], notices: [], files: [], pending: [], reminders: [], fetchedAt: null };

function readTheme(): Theme {
  const saved = localStorage.getItem("theme");
  return saved === "light" || saved === "dark" ? saved : "system";
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [watched, setWatched] = useState(() => new Set<string>());
  const [localRead, setLocalRead] = useState(() => new Set<string>());
  const [opened, setOpened] = useState(() => new Set<string>());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [trayHidden, setTrayHidden] = useState(false);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [toast, setToast] = useState<Store["toast"]>(null);
  const toastSeq = useRef(0);

  useEffect(() => {
    void api().snapshot().then(setSnapshot);
    void api().settings().then(setSettings);
    const offSnapshot = api().onSnapshot(setSnapshot);
    const offDownload = api().onDownload((e: DownloadEvent) => {
      if (e.kind === "progress") {
        setJobs((prev) =>
          prev.map((j) => (j.id === e.fileId && j.state !== "canceled" ? { ...j, state: e.state, progress: e.state === "active" ? 0.5 : 1 } : j)),
        );
      } else {
        setJobs((prev) => prev.map((j) => (j.state === "queued" || j.state === "active" ? { ...j, state: e.canceled ? "canceled" : "failed" } : j)));
      }
    });
    return () => {
      offSnapshot();
      offDownload();
    };
  }, []);

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

  const data = useMemo(() => toData(snapshot), [snapshot]);
  const read = useMemo(() => new Set([...data.notices.filter((n) => n.read).map((n) => n.id), ...localRead]), [data, localRead]);
  const reminders = useMemo(() => new Set(snapshot.reminders), [snapshot.reminders]);
  const downloaded = useMemo(
    () => new Set([...data.files.filter((f) => f.downloaded).map((f) => f.id), ...jobs.filter((j) => j.state === "done").map((j) => j.id)]),
    [data, jobs],
  );

  const showToast = useCallback((text: string, note?: string) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, note });
  }, []);

  const watch = useCallback(
    (l: Lecture) => {
      setWatched((prev) => new Set(prev).add(l.id));
      void api().openLecture(l.id);
      showToast(`「${l.title}」 강의 화면을 열었어요`, "출석은 학교 화면에서 끝까지 봐야 인정돼요");
    },
    [showToast],
  );

  const markRead = useCallback((ids: string[]) => {
    setLocalRead((prev) => new Set([...prev, ...ids]));
    void api().markRead(ids);
  }, []);

  const summarize = useCallback(
    async (ids: string[]) => {
      const result = await api().summarize(ids);
      if (!result.ok && result.text) showToast(result.text);
    },
    [showToast],
  );

  const remind = useCallback(
    async (ids: string[]) => {
      const result = await api().remind(ids);
      showToast(result.text);
    },
    [showToast],
  );

  const openAssignment = useCallback(
    (a: Assignment) => {
      setOpened((prev) => new Set(prev).add(a.id));
      void api().openAssignment(a.id);
      showToast(`「${a.title}」 과제 화면을 열었어요`, "내는 건 학교 화면에서 해요");
    },
    [showToast],
  );

  const download = useCallback(
    (list: FileItem[]) => {
      const taken = new Set(jobs.filter((j) => j.state === "queued" || j.state === "active" || j.state === "done").map((j) => j.id));
      const fresh = list.filter((f) => f.available && !taken.has(f.id));
      if (!fresh.length) return 0;
      setTrayHidden(false);
      setJobs((prev) => [...prev.filter((j) => !fresh.some((f) => f.id === j.id)), ...fresh.map((f) => ({ id: f.id, file: f, progress: 0, state: "queued" as const }))]);
      void api().download(fresh.map((f) => f.id));
      return fresh.length;
    },
    [jobs],
  );

  const cancelDownloads = useCallback(() => {
    void api().cancelDownloads();
    setJobs((prev) => prev.map((j) => (j.state === "queued" ? { ...j, state: "canceled" } : j)));
  }, []);

  const clearDownloads = useCallback(() => setTrayHidden(true), []);

  const login = useCallback(async () => {
    const result = await api().login();
    if (!result.ok) showToast(result.text);
  }, [showToast]);

  const value: Store = {
    snapshot,
    data,
    settings,
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
    summarize,
    remind,
    openAssignment,
    download,
    cancelDownloads,
    clearDownloads,
    showToast,
    login,
    setSettings,
  };
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}

export function jobFor(jobs: Job[], fileId: string): Job | undefined {
  return jobs.find((j) => j.id === fileId && j.state !== "canceled");
}

export function settled(jobs: Job[], fileId: string): boolean {
  const job = jobFor(jobs, fileId);
  return !job || job.state === "done" || job.state === "failed";
}
