import type { ElectronBrowserSession } from "./electron-cdp.ts";
import { LoginRequired } from "./electron-cdp.ts";

/** How long the hidden window stays open after its last job, so back-to-back reads reuse it. */
export const ENGINE_IDLE_MS = 45_000;

interface Session {
  enter(): Promise<unknown>;
  exit(): Promise<void>;
  readonly webContents: unknown;
}

/**
 * The one hidden window every school site shares. Jobs that navigate it (LMS loads, a site sign-in) run one at a
 * time; jobs that only read cookies (downloads) run beside them. The window closes once nothing has used it for a
 * while and opens again on the next job, so an idle app holds no hidden renderer.
 */
export class EngineHost<S extends Session = ElectronBrowserSession> {
  private session: S | null = null;
  private opening: Promise<S> | null = null;
  private lane: Promise<unknown> = Promise.resolve();
  private users = 0;
  private idle: ReturnType<typeof setTimeout> | null = null;
  /** The open window has passed a school sign-in check; a new window starts unchecked. */
  signedIn = false;

  constructor(
    private readonly make: () => S,
    private readonly idleMs = ENGINE_IDLE_MS,
  ) {}

  /** A job that navigates the window; it waits for the jobs queued before it. */
  exclusive<T>(body: (session: S) => Promise<T>): Promise<T> {
    const run = (): Promise<T> => this.use(body);
    const next = this.lane.then(run, run);
    this.lane = next.catch(() => undefined);
    return next;
  }

  /** A job that leaves the page alone (cookies, plain fetches) and may overlap a navigating job. */
  shared<T>(body: (session: S) => Promise<T>): Promise<T> {
    return this.use(body);
  }

  get isOpen(): boolean {
    return !!this.session;
  }

  private async use<T>(body: (session: S) => Promise<T>): Promise<T> {
    this.users += 1;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    try {
      return await body(await this.open());
    } catch (error) {
      if (error instanceof LoginRequired) this.signedIn = false;
      throw error;
    } finally {
      this.users -= 1;
      if (!this.users) this.idle = setTimeout(() => void this.close(), this.idleMs);
    }
  }

  private open(): Promise<S> {
    if (this.session?.webContents) return Promise.resolve(this.session);
    this.session = null;
    this.opening ??= (async () => {
      const session = this.make();
      await session.enter();
      this.session = session;
      this.signedIn = false;
      return session;
    })().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  /** Closes the window when no job holds it. */
  async close(): Promise<void> {
    if (this.users) return;
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    if (!this.session) return;
    const session = this.session;
    this.session = null;
    this.signedIn = false;
    await session.exit();
  }
}
