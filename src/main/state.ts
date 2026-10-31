import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Reminder {
  id: string;
  title: string;
  course: string;
  due: string;
}

export interface AppState {
  readNotices: string[];
  summaries: Record<string, string>;
  reminders: Reminder[];
  firedReminders: string[];
  notifyDue: boolean;
  /** The student finished a school login in this app at least once; a later login screen asks to sign in again. */
  signedInBefore: boolean;
}

const EMPTY: AppState = { readNotices: [], summaries: {}, reminders: [], firedReminders: [], notifyDue: true, signedInBefore: false };

export class StateStore {
  private value: AppState;

  constructor(private readonly path: string) {
    this.value = this.load();
  }

  private load(): AppState {
    if (!existsSync(this.path)) return structuredClone(EMPTY);
    try {
      return { ...structuredClone(EMPTY), ...(JSON.parse(readFileSync(this.path, "utf-8")) as Partial<AppState>) };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  get(): Readonly<AppState> {
    return this.value;
  }

  update(change: (draft: AppState) => void): AppState {
    change(this.value);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.value, null, 1), { mode: 0o600 });
    renameSync(tmp, this.path);
    return this.value;
  }
}
