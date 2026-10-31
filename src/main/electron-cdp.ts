import type { BrowserWindow, WebContents } from "electron";

import type { KuLmsConfig } from "../engine/config.ts";
import { LiveCommandError } from "../engine/errors.ts";
import { CANVAS_ORIGIN, CdpBrowserSession, type CdpEvent, type CdpTransport, type LiveOptions } from "../engine/live.ts";
import { redactText } from "../engine/redaction.ts";
import { sleep } from "../engine/util.ts";

type Raw = Record<string, any>;

export class LoginRequired extends LiveCommandError {
  override name = "LoginRequired";
}

/** CDP over Electron's built-in webContents.debugger: same Chromium, no remote debugging port. */
export class ElectronDebuggerTransport implements CdpTransport {
  eventCallback: ((event: CdpEvent) => void) | null = null;
  lastDialogMessage = "";

  private readonly onMessage = (_event: unknown, method: string, params: Raw): void => {
    if (method === "Page.javascriptDialogOpening") {
      this.lastDialogMessage = String(params?.message ?? "");
      const accept = params?.type !== "confirm" || this.acceptConfirms;
      this.contents.debugger.sendCommand("Page.handleJavaScriptDialog", { accept }).catch(() => undefined);
    }
    this.eventCallback?.({ method, params: params ?? {} });
  };

  private readonly onDetach = (): void => {
    this.eventCallback?.({ method: "CDP.disconnected", params: {} });
  };

  constructor(
    private readonly contents: WebContents,
    private readonly acceptConfirms = false,
  ) {
    contents.debugger.attach("1.3");
    contents.debugger.on("message", this.onMessage);
    contents.debugger.on("detach", this.onDetach);
  }

  async send(method: string, params: Raw = {}, options: { timeout?: number } = {}): Promise<Raw> {
    if (this.contents.isDestroyed() || !this.contents.debugger.isAttached()) throw new LiveCommandError("CDP connection closed");
    const timeout = options.timeout ?? 60;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LiveCommandError(`CDP command timed out: ${method}`)), timeout * 1000);
    });
    try {
      return ((await Promise.race([this.contents.debugger.sendCommand(method, params), expiry])) ?? {}) as Raw;
    } catch (error) {
      if (error instanceof LiveCommandError) throw error;
      throw new LiveCommandError(redactText(error instanceof Error ? error.message : String(error)));
    } finally {
      clearTimeout(timer);
    }
  }

  async drainEvents(): Promise<void> {
    await this.send("Runtime.evaluate", { expression: "0" });
  }

  async close(): Promise<void> {
    this.contents.debugger.removeListener("message", this.onMessage);
    this.contents.debugger.removeListener("detach", this.onDetach);
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
  }
}

const PASSWORD_FORM_SCRIPT = `!!document.querySelector('input[type="password"],#password,input[name="user_password"]')`;
const SILENT_SSO_SECONDS = 20;

/**
 * The engine's browser session, driven inside a hidden app window that shares the app's login partition.
 * Without a dev credential pair it never types credentials: it reuses the stored session or the SSO
 * cookie, and otherwise raises LoginRequired so the student signs in once in a visible window.
 */
export class ElectronBrowserSession extends CdpBrowserSession {
  private window: BrowserWindow | null = null;

  constructor(
    config: KuLmsConfig,
    options: LiveOptions,
    private readonly makeWindow: () => BrowserWindow,
  ) {
    super(config, options);
  }

  get webContents(): WebContents | null {
    return this.window && !this.window.isDestroyed() ? this.window.webContents : null;
  }

  override async enter(): Promise<this> {
    this.window = this.makeWindow();
    try {
      // A window with no document has no renderer yet, and debugger commands would wait forever.
      await this.window.loadURL("about:blank");
      // Only the dev credential login needs confirm(): the SSO asks there whether to postpone a password change.
      await this.useTransport(new ElectronDebuggerTransport(this.window.webContents, !!this.config.userId));
    } catch (error) {
      await this.exit();
      throw error;
    }
    return this;
  }

  override async exit(): Promise<void> {
    await this.client?.close().catch(() => undefined);
    this.client = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  override async login(): Promise<void> {
    await this.goto(CANVAS_ORIGIN);
    if (await this.canvasSessionReady()) return;
    if (this.config.userId && this.config.password) return super.login();
    await this.goto(this.options.entryUrl);
    const deadline = performance.now() + SILENT_SSO_SECONDS * 1000;
    while (performance.now() < deadline) {
      const href = String((await this.evaluate("location.href", { timeout: 5 }).catch(() => "")) || "");
      if (/^https:\/\/(mylms|canvas)\.korea\.ac\.kr\//.test(href) && !href.toLowerCase().includes("login") && (await this.canvasSessionReady())) return;
      if (await this.evaluate(PASSWORD_FORM_SCRIPT, { timeout: 5 }).catch(() => false)) break;
      await sleep(1);
    }
    throw new LoginRequired("school login is required");
  }
}
