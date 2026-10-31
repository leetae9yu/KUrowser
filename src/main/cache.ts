import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const WRITE_DELAY_MS = 1000;

/**
 * The last school data the app showed, kept on disk so the next start can show it at once while the school is read
 * again in the background. The file is readable by the student only; logging out deletes it.
 */
export class DiskCache<T extends object> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: T | null = null;

  constructor(
    private readonly path: string,
    private readonly version: number,
  ) {}

  read(): T | null {
    if (!existsSync(this.path)) return null;
    try {
      const data = JSON.parse(readFileSync(this.path, "utf-8")) as { version?: unknown; value?: T };
      return data.version === this.version && data.value && typeof data.value === "object" ? data.value : null;
    } catch {
      return null;
    }
  }

  /** Writes at most once a second; a burst of updates while loading lands as one write. */
  write(value: T): void {
    this.pending = value;
    this.timer ??= setTimeout(() => this.flush(), WRITE_DELAY_MS);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const value = this.pending;
    this.pending = null;
    if (!value) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: this.version, value }), { mode: 0o600 });
      renameSync(tmp, this.path);
    } catch {
      // A full or read-only disk only costs the quick start next time.
    }
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    rmSync(this.path, { force: true });
  }
}
