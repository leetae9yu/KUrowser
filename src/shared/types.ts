/* Shapes that cross the IPC boundary. Dates travel as ISO strings. */

export type Hue = 1 | 2 | 3 | 4 | 5;

export interface Course {
  id: string;
  name: string;
  prof: string;
  hue: Hue;
  aliases: string[];
}

export interface Assignment {
  id: string;
  courseId: string;
  title: string;
  due: string;
  submitted: boolean;
}

export interface Lecture {
  id: string;
  courseId: string;
  week: number | null;
  title: string;
  /** Last moment the view counts for attendance; null when the LMS gives none. */
  until: string | null;
  available: boolean;
}

export interface Notice {
  id: string;
  courseId: string;
  title: string;
  /** One line: the LLM summary once the student asked for it, otherwise empty. */
  summary: string;
  body: string;
  source: string;
  postedAt: string;
  read: boolean;
}

export interface FileItem {
  id: string;
  courseId: string;
  name: string;
  folder: string;
  size: number;
  updatedAt: string;
  downloaded: boolean;
  available: boolean;
  isNew: boolean;
}

export type LoadPart = "courses" | "lectures" | "files";

export interface Snapshot {
  /** login: the student has to sign in once; loading: first fetch running; ready: data shown. */
  phase: "login" | "loading" | "ready" | "error";
  error: string | null;
  courses: Course[];
  assignments: Assignment[];
  lectures: Lecture[];
  notices: Notice[];
  files: FileItem[];
  /** Parts still loading in the background; the first screen does not wait for them. */
  pending: LoadPart[];
  reminders: string[];
  fetchedAt: string | null;
}

export interface Settings {
  notifyDue: boolean;
  downloadDir: string;
  aiConnected: boolean;
  aiLabel: string;
}

export type DownloadEvent =
  | { kind: "progress"; fileId: string; state: "active" | "done" | "failed"; error?: string }
  | { kind: "finished"; ids: string[]; done: number; failed: number; canceled: boolean };

/** Read-only commands a sentence may turn into. Anything else is refused. */
export type ReadCommand =
  | { command: "deadlines"; range: "today" | "tomorrow" | "week" | "nextweek" | "month"; course?: string; assignmentsOnly?: boolean }
  | { command: "lectures"; course?: string }
  | { command: "notices"; course?: string }
  | { command: "files"; course?: string; onlyNew?: boolean }
  | { command: "course"; course: string }
  | { command: "courses" }
  | { command: "unknown" };

export interface KurowserApi {
  snapshot(): Promise<Snapshot>;
  refresh(): Promise<void>;
  onSnapshot(fn: (s: Snapshot) => void): () => void;
  login(): Promise<{ ok: boolean; text: string }>;
  logout(): Promise<void>;
  openAssignment(id: string): Promise<void>;
  openLecture(id: string): Promise<void>;
  openNotice(id: string): Promise<void>;
  markRead(ids: string[]): Promise<void>;
  summarize(ids: string[]): Promise<{ ok: boolean; text: string }>;
  remind(ids: string[]): Promise<{ ok: boolean; text: string }>;
  download(ids: string[]): Promise<void>;
  cancelDownloads(): Promise<void>;
  onDownload(fn: (e: DownloadEvent) => void): () => void;
  openDownloads(): Promise<void>;
  settings(): Promise<Settings>;
  setNotifyDue(on: boolean): Promise<Settings>;
  connectAi(): Promise<{ ok: boolean; text: string }>;
  onAiStatus(fn: (text: string) => void): () => void;
  interpret(text: string): Promise<{ via: "ai" | "rules"; command: ReadCommand } | null>;
}
