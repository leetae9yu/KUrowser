import { screen, WebContentsView, type BrowserWindow, type Rectangle, type WebContents } from "electron";

import type { FocusEvent, PaneState } from "../shared/types.ts";
import { FocusMode } from "./focus.ts";
import { isAiLoginUrl, isSchoolUrl } from "./hosts.ts";
import { schoolPreferences } from "./school.ts";

export const CHAT_WIDTH = 420;
export const WIDE_MIN = 980;
const BAR_HEIGHT = 48;
const WIDE_SIZE = { width: 1440, height: 900 };
// The SSO page's notice popup is about 1400px wide and covers the login button in a narrower page.
const NOTICE_POPUP_CSS = ".noptice_popup_container { display: none !important; }";

/**
 * The school page lives inside the main window, left of the chat, instead of in a window of its own.
 * Opening it widens a narrow window once; closing it puts the window back to the size it had.
 */
export class SchoolPane {
  private view: WebContentsView | null = null;
  private restore: Rectangle | null = null;
  private focus: FocusMode | null = null;

  constructor(
    private readonly window: () => BrowserWindow | null,
    private readonly onChange: (state: PaneState) => void,
    private readonly onFocus: (event: FocusEvent) => void = () => undefined,
  ) {}

  state(): PaneState {
    const win = this.window();
    const wc = this.view?.webContents;
    return {
      open: !!wc,
      wide: !!win && win.getContentSize()[0]! >= WIDE_MIN,
      title: wc?.getTitle() || "고려대학교",
      canGoBack: !!wc?.navigationHistory.canGoBack(),
      focus: this.focus?.matched ? (this.focus.on ? "on" : "off") : null,
    };
  }

  open(url: string): WebContents | null {
    if (!isSchoolUrl(url) && !isAiLoginUrl(url)) return null;
    const win = this.window();
    if (!win || win.isDestroyed()) return null;
    const view = this.view ?? this.create(win);
    this.widen(win);
    void view.webContents.loadURL(url).catch(() => undefined);
    this.layout();
    return view.webContents;
  }

  close(): void {
    const win = this.window();
    const view = this.view;
    if (!view) return;
    this.view = null;
    this.focus = null;
    if (win && !win.isDestroyed()) {
      win.contentView.removeChildView(view);
      if (this.restore && !win.isFullScreen() && !win.isMaximized()) win.setBounds(this.restore);
    }
    this.restore = null;
    view.webContents.close();
    this.emit();
  }

  toggleFocus(): void {
    this.focus?.toggle();
  }

  back(): void {
    const history = this.view?.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  }

  widen(win: BrowserWindow | null = this.window()): void {
    if (!win || win.isDestroyed() || win.isFullScreen() || win.getContentSize()[0]! >= WIDE_MIN) return;
    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(WIDE_SIZE.width, area.width);
    if (width < WIDE_MIN) return;
    this.restore ??= bounds;
    const height = Math.max(bounds.height, Math.min(WIDE_SIZE.height, area.height));
    const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
    win.setBounds({ x, y, width, height });
  }

  layout(): void {
    const win = this.window();
    if (this.view && win && !win.isDestroyed()) {
      const [width, height] = win.getContentSize() as [number, number];
      const wide = width >= WIDE_MIN;
      this.view.setVisible(wide);
      if (wide) this.view.setBounds({ x: 0, y: BAR_HEIGHT, width: width - CHAT_WIDTH, height: Math.max(0, height - BAR_HEIGHT) });
    }
    this.emit();
  }

  private create(win: BrowserWindow): WebContentsView {
    const view = new WebContentsView({ webPreferences: schoolPreferences() });
    const wc = view.webContents;
    // Links that would open a new window load in the same pane; anything off the school stays closed.
    wc.setWindowOpenHandler(({ url }) => {
      if (isSchoolUrl(url)) void wc.loadURL(url).catch(() => undefined);
      return { action: "deny" };
    });
    for (const event of ["did-navigate", "did-navigate-in-page", "page-title-updated"] as const) {
      wc.on(event as "did-navigate", () => this.emit());
    }
    this.focus = new FocusMode(wc, { say: this.onFocus, done: () => this.close(), changed: () => this.emit() });
    wc.on("did-frame-finish-load", () => {
      if (wc.isDestroyed()) return;
      const js = `if (!document.getElementById('kur-hide-notice')) { const s = document.createElement('style'); s.id = 'kur-hide-notice'; s.textContent = ${JSON.stringify(NOTICE_POPUP_CSS)}; document.head.appendChild(s); }`;
      for (const frame of wc.mainFrame.framesInSubtree) {
        if (frame.url.startsWith("https://sso.korea.ac.kr")) frame.executeJavaScript(js).catch(() => undefined);
      }
    });
    win.contentView.addChildView(view);
    this.view = view;
    return view;
  }

  private emit(): void {
    this.onChange(this.state());
  }
}
