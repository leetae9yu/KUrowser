import { app, BrowserWindow, safeStorage, screen, session, type Session } from "electron";

import { CANVAS_ORIGIN, DEFAULT_ENTRY_URL } from "../engine/live.ts";
import { engineRequestAllowed, isAiLoginUrl, isAllowedPage, isSchoolHost, isSchoolUrl } from "./hosts.ts";

export const PARTITION = "persist:kurowser";
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const KEEP_LOGIN_DAYS = 14;

const engineContents = new Set<number>();
let guarded = false;

export function schoolSession(): Session {
  const ses = session.fromPartition(PARTITION);
  if (!guarded) {
    guarded = true;
    // Canvas flags the Electron user agent as an unsupported browser and shows a warning on every page.
    ses.setUserAgent(ses.getUserAgent().replace(/ (KUrowser|Electron)\/\S+/g, ""));
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.webRequest.onBeforeRequest((details, callback) => {
      const top = details.resourceType === "mainFrame";
      if (top && !isAllowedPage(details.url) && !isAiLoginUrl(details.url)) return callback({ cancel: true });
      const fromEngine = details.webContentsId !== undefined && engineContents.has(details.webContentsId);
      if (fromEngine && !engineRequestAllowed(details.method, details.url, details.resourceType)) {
        if (app.isPackaged || !process.env.KUROWSER_LOG_BLOCKED) return callback({ cancel: true });
        console.log(`BLOCKED ${details.method} ${new URL(details.url).host}${new URL(details.url).pathname.replace(/\d+/g, "N")}`);
        return callback({ cancel: true });
      }
      callback({});
    });
  }
  return ses;
}

function guardWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!isSchoolUrl(url)) return { action: "deny" };
    return { action: "allow", overrideBrowserWindowOptions: { webPreferences: schoolPreferences() } };
  });
  win.webContents.on("did-create-window", (child) => guardWindow(child));
}

function schoolPreferences(): Electron.WebPreferences {
  return { session: schoolSession(), sandbox: true, contextIsolation: true, nodeIntegration: false };
}

export function makeEngineWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { ...schoolPreferences(), backgroundThrottling: false, autoplayPolicy: "document-user-activation-required" },
  });
  const id = win.webContents.id;
  engineContents.add(id);
  win.on("closed", () => engineContents.delete(id));
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.setAudioMuted(true);
  return win;
}

export function openSchoolWindow(url: string, parent?: BrowserWindow): BrowserWindow | null {
  if (!isSchoolUrl(url)) return null;
  // The SSO page's notice popup is about 1400px wide; a narrower window hides its close button.
  const area = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1440, area.width),
    height: Math.min(900, area.height),
    parent,
    title: "고려대학교",
    webPreferences: schoolPreferences(),
  });
  guardWindow(win);
  void win.loadURL(url).catch(() => undefined);
  return win;
}

export async function canvasReady(ses: Session = schoolSession()): Promise<boolean> {
  try {
    const res = await ses.fetch(`${CANVAS_ORIGIN}/api/v1/users/self/profile`, { credentials: "include", redirect: "manual" });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Canvas and SSO issue session-only cookies, which Chromium drops on quit. Re-saving the school
 * cookies with an expiry keeps the student signed in across restarts. The packaged app turns on the
 * cookie-encryption fuse, so the cookie store is encrypted with the OS keychain key; without a real
 * keychain (Linux basic_text, or an unpackaged dev run) the cookies stay session-only unless a dev
 * run opts in with KUROWSER_ALLOW_BASIC_TEXT=1.
 */
async function canPersistCookies(): Promise<boolean> {
  const devOptIn = !app.isPackaged && process.env.KUROWSER_ALLOW_BASIC_TEXT === "1";
  if (!app.isPackaged) return devOptIn;
  // The async check waits for a keychain prompt without blocking the main process.
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
  return process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text";
}

export async function keepLogin(ses: Session = schoolSession()): Promise<void> {
  if (!(await canPersistCookies())) return;
  const expirationDate = Date.now() / 1000 + KEEP_LOGIN_DAYS * 86_400;
  for (const cookie of await ses.cookies.get({})) {
    const domain = (cookie.domain ?? "").replace(/^\./, "");
    if (!cookie.session || !isSchoolHost(domain)) continue;
    await ses.cookies
      .set({
        url: `https://${domain}${cookie.path ?? "/"}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.hostOnly ? undefined : cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expirationDate,
      })
      .catch(() => undefined);
  }
  await ses.cookies.flushStore();
}

export function signIn(parent?: BrowserWindow): Promise<boolean> {
  const win = openSchoolWindow(DEFAULT_ENTRY_URL, parent);
  if (!win) return Promise.resolve(false);
  win.setTitle("고려대학교 로그인");
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.close();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), LOGIN_TIMEOUT_MS);
    const check = (_event: unknown, url: string): void => {
      const u = new URL(url);
      if (!/^(mylms|canvas)\.korea\.ac\.kr$/.test(u.hostname) || u.pathname.toLowerCase().includes("login")) return;
      void canvasReady().then(async (ok) => {
        if (!ok) return;
        await keepLogin();
        finish(true);
      });
    };
    win.webContents.on("did-navigate", check);
    win.webContents.on("did-navigate-in-page", check);
    win.on("closed", () => finish(false));
  });
}

export async function signOut(): Promise<void> {
  const ses = schoolSession();
  await ses.clearStorageData();
  await ses.cookies.flushStore();
}
