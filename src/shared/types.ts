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

/** A recorded lecture (watched or not) whose subtitles and summary the app can make. */
export interface Recording {
  id: string;
  courseId: string;
  title: string;
  week: number | null;
  seconds: number;
  watched: boolean;
}

export interface SttPlan {
  ok: boolean;
  text: string;
  source?: "captions" | "stt";
  minutes?: number;
  credits?: number;
  remaining?: number | null;
}

export type SttEvent =
  | { id: string; kind: "progress"; text: string }
  | { id: string; kind: "done"; text: string; summary: string; folder: string }
  | { id: string; kind: "failed"; text: string };

export type LoadPart = "courses" | "lectures" | "files";

export interface Snapshot {
  /** login: the student has to sign in once; keychain: the OS asks whether the app may read its stored key; loading: first fetch running; ready: data shown. */
  phase: "login" | "keychain" | "loading" | "ready" | "error";
  error: string | null;
  courses: Course[];
  assignments: Assignment[];
  lectures: Lecture[];
  recordings: Recording[];
  notices: Notice[];
  files: FileItem[];
  /** Parts still loading in the background; the first screen does not wait for them. */
  pending: LoadPart[];
  /** Parts that hold data, from this run or the last one; a part loaded before can answer while it is read again. */
  loaded: LoadPart[];
  reminders: string[];
  fetchedAt: string | null;
}

/** A post on the school portal's notice board (Seoul campus). */
export interface PortalNotice {
  id: string;
  title: string;
  office: string;
  postedAt: string;
  /** The board's own short summary. */
  preview: string;
  /** The post text, read for the newest posts only; empty until read. */
  body: string;
  url: string;
  pinned: boolean;
  files: number;
  read?: boolean;
}

/** One line of the registrar's academic calendar; dates are `YYYY-MM-DD`. */
export interface ScheduleEntry {
  start: string;
  end: string;
  /** The date as the registrar writes it, such as `14(월)~18(금)`. */
  label: string;
  event: string;
}

/** A school page the chat can open on the left. */
export interface SchoolMenu {
  id: string;
  label: string;
  /** Words (no spaces) a sentence may use for it. */
  words: string[];
  url: string;
}

/** One reading room's free seats right now. */
export interface SeatRoom {
  library: string;
  name: string;
  total: number;
  available: number;
  hours: string;
}

/** A book the student has out; dates are `YYYY-MM-DD`. */
export interface Loan {
  id: string;
  title: string;
  place: string;
  loanedAt: string;
  due: string;
  renewals: number;
}

export interface SiteState<T> {
  data: T;
  fetchedAt: string | null;
  error: string | null;
}

/** School sites besides the LMS, read with the same portal login; each part loads and fails on its own. */
export interface SitesSnapshot {
  portal: SiteState<{ notices: PortalNotice[]; schedule: ScheduleEntry[] }>;
  /** Loans need the library's own sign-in, which the app does with the portal login; `signedIn` false means it failed. */
  library: SiteState<{ loans: Loan[]; signedIn: boolean }>;
  menus: SchoolMenu[];
}

export interface PaneState {
  open: boolean;
  wide: boolean;
  title: string;
  canGoBack: boolean;
  /** Focus mode on the page shown: null when no rule knows the page, so it stays as the school drew it. */
  focus: "on" | "off" | null;
}

/** A line focus mode adds to the chat: the next step on the school page, or a finished job. */
export type FocusEvent = { kind: "hint"; text: string } | { kind: "done"; text: string };

export interface Settings {
  notifyDue: boolean;
  downloadDir: string;
  aiConnected: boolean;
  aiLabel: string;
  signedInBefore: boolean;
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

/** What the main process made of a sentence the local rules could not place. */
export type ChatReply =
  | { kind: "command"; command: ReadCommand }
  | { kind: "opened"; text: string }
  | { kind: "answer"; text: string }
  | { kind: "clarify"; text: string }
  | { kind: "refused"; text: string }
  | { kind: "error"; text: string };

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
  onSettings(fn: (s: Settings) => void): () => void;
  paneState(): Promise<PaneState>;
  onPane(fn: (s: PaneState) => void): () => void;
  paneBack(): Promise<void>;
  paneClose(): Promise<void>;
  paneWiden(): Promise<void>;
  paneFocus(): Promise<void>;
  onFocus(fn: (e: FocusEvent) => void): () => void;
  interpret(text: string): Promise<{ via: "ai" | "rules"; command: ReadCommand } | null>;
  chat(text: string): Promise<ChatReply>;
  sttPlan(id: string): Promise<SttPlan>;
  sttRun(id: string): Promise<void>;
  onStt(fn: (e: SttEvent) => void): () => void;
  openFolder(path: string): Promise<void>;
  /** The window shows its first real screen (school data or the sign-in screen); the app records how long that took. */
  firstScreen(): Promise<void>;
  sites(): Promise<SitesSnapshot>;
  onSites(fn: (s: SitesSnapshot) => void): () => void;
  refreshSites(): Promise<void>;
  /** Opens a school page from `SitesSnapshot.menus` on the left; false when that menu does not exist. */
  openMenu(id: string): Promise<boolean>;
  openPortalNotice(id: string): Promise<void>;
  /** Reading-room seats, read again when older than a minute. */
  seats(): Promise<{ rooms: SeatRoom[]; at: string | null; error: string | null }>;
}
