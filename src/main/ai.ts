import { app, BrowserWindow, net, safeStorage, type Session, type WebContents } from "electron";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { isAiLoginUrl } from "./hosts.ts";
import { schoolSession } from "./school.ts";

export const SITE = "https://llm.korea.ac.kr";
export const GATEWAY = "https://api.baze.co/v1/gateway";
const SITE_HEADERS: Readonly<Record<string, string>> = { subdomain: "llm", "x-access-channel": "web", accept: "application/json" };
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
// Right after the LMS sign-in the portal session is still valid, so the AI site signs in by itself within seconds.
const SILENT_LOGIN_MS = 25 * 1000;
// gpt-5.6-luna is the only cheap model measured on the bench pilot (0.21 credit a call plus the 5-credit filter fee).
const PREFERRED_MODELS = [/^gpt-5\.6-luna$/, /flash-lite/i, /haiku/i, /mini/i, /flash/i];

type Status = (text: string) => void;
export type Opener = { open(url: string): WebContents | null; close(): void };
type Verify = { ok: true; models: string[] } | { ok: false; rejected: boolean; status: number };

class IssueUncertainError extends Error {}

const keyFile = (): string => join(app.getPath("userData"), "gateway-key.bin");

export function mask(key: string): string {
  return key.length > 6 ? `…${key.slice(-2)}` : "***";
}

function storageBackend(): string {
  return process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "os";
}

async function assertKeyStoreReady(): Promise<void> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error("OS 키 저장소를 쓸 수 없어요");
  if (storageBackend() === "basic_text" && (app.isPackaged || process.env.KUROWSER_ALLOW_BASIC_TEXT !== "1")) {
    throw new Error("이 컴퓨터에는 키를 안전하게 둘 키링이 없어요");
  }
}

async function saveKey(key: string): Promise<void> {
  const tmp = `${keyFile()}.tmp`;
  writeFileSync(tmp, await safeStorage.encryptStringAsync(key), { mode: 0o600 });
  renameSync(tmp, keyFile());
}

async function loadKey(): Promise<string | null> {
  if (!existsSync(keyFile())) return null;
  try {
    return (await safeStorage.decryptStringAsync(readFileSync(keyFile()))).result || null;
  } catch {
    rmSync(keyFile(), { force: true });
    return null;
  }
}

async function verifyKey(key: string): Promise<Verify> {
  const res = await net.fetch(`${GATEWAY}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status !== 200) return { ok: false, rejected: res.status === 401 || res.status === 403, status: res.status };
  const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return { ok: true, models: (body.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean) };
}

function pickModel(models: string[]): string | null {
  for (const pattern of PREFERRED_MODELS) {
    const found = models.find((m) => pattern.test(m));
    if (found) return found;
  }
  return models[0] ?? null;
}

async function siteFetch(ses: Session, pathname: string, init: { method?: string; body?: string } = {}): Promise<{ status: number; body: unknown }> {
  const res = await ses.fetch(`${SITE}${pathname}`, {
    ...init,
    credentials: "include",
    headers: { ...SITE_HEADERS, ...(init.body ? { "content-type": "application/json" } : {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function issuedKey(body: unknown): string | null {
  const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
  const data = record(body) && record(body.data) ? body.data : body;
  if (!record(data) || typeof data.key !== "string" || !data.key || /[*•]/.test(data.key)) return null;
  return data.key;
}

function hiddenAiLogin(ses: Session): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.setAudioMuted(true);
  const guard = (event: Electron.Event, url: string): void => {
    if (!isAiLoginUrl(url)) event.preventDefault();
  };
  win.webContents.on("will-navigate", guard);
  win.webContents.on("will-redirect", guard);
  return win;
}

function waitForAiLogin(wc: WebContents, ses: Session, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error("로그인 대기 시간이 지났어요")), timeoutMs);
    const check = (_event: unknown, url: string): void => {
      if (!url.startsWith(`${SITE}/dashboard`)) return;
      void siteFetch(ses, "/api/proxy/members/me").then((r) => r.status === 200 && finish());
    };
    wc.on("did-navigate", check);
    wc.on("did-navigate-in-page", check);
    wc.on("destroyed", () => finish(new Error("로그인 화면이 닫혔어요")));
  });
}

/** Signs in to the AI site with the portal session in a hidden window; only a lapsed session shows the login page. */
async function aiLogin(ses: Session, opener: Opener, status: Status): Promise<void> {
  if ((await siteFetch(ses, "/api/proxy/members/me")).status === 200) return;
  status("고대 AI에 연결하는 중이에요");
  const hidden = hiddenAiLogin(ses);
  try {
    await Promise.all([waitForAiLogin(hidden.webContents, ses, SILENT_LOGIN_MS), hidden.loadURL(`${SITE}/auth`).catch(() => undefined)]);
    return;
  } catch {
    // The portal asked for the password again; the student signs in on the school page instead.
  } finally {
    if (!hidden.isDestroyed()) hidden.destroy();
  }
  status("왼쪽 학교 화면에서 로그인해 주세요");
  const wc = opener.open(`${SITE}/auth`);
  if (!wc) throw new Error("로그인 화면을 열지 못했어요");
  try {
    await waitForAiLogin(wc, ses, LOGIN_TIMEOUT_MS);
  } finally {
    opener.close();
  }
}

async function issueKey(ses: Session, opener: Opener, status: Status): Promise<string> {
  await aiLogin(ses, opener, status);
  status("키를 받는 중이에요");
  let res: { status: number; body: unknown };
  try {
    res = await siteFetch(ses, "/api/proxy/apikeys/", {
      method: "POST",
      body: JSON.stringify({ name: `KUrowser ${hostname()}`.slice(0, 50), description: "KUrowser 앱에서 발급" }),
    });
  } catch {
    throw new IssueUncertainError("발급 응답을 받지 못했어요. 키가 만들어졌을 수 있으니 AI 사이트의 키 목록을 확인해 주세요");
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`키 발급이 거절됐어요 (HTTP ${res.status})`);
  const key = issuedKey(res.body);
  if (!key) throw new IssueUncertainError("발급 응답에서 키를 찾지 못했어요. AI 사이트의 키 목록을 확인해 주세요");
  return key;
}

/** Holds the Gateway key in the main process only; the renderer sees a connected flag and a masked tail. */
export class GatewayClient {
  private key: string | null = null;
  private model: string | null = null;
  private busy = false;

  async restore(): Promise<void> {
    // Without a stored key there is nothing to decrypt, so the keychain is not touched at startup.
    if (!existsSync(keyFile())) return;
    try {
      await assertKeyStoreReady();
      this.key = await loadKey();
    } catch {
      this.key = null;
    }
  }

  get connected(): boolean {
    return this.key !== null;
  }

  get label(): string {
    return this.key ? `연결됨 (${mask(this.key)})` : "";
  }

  async connect(opener: Opener, status: Status): Promise<string> {
    if (this.busy) throw new Error("이미 연결하는 중이에요");
    this.busy = true;
    try {
      await assertKeyStoreReady();
      const stored = this.key ?? (await loadKey());
      if (stored) {
        const v = await verifyKey(stored);
        if (v.ok) {
          this.key = stored;
          this.model = pickModel(v.models);
          return this.label;
        }
        if (!v.rejected) throw new Error(`지금은 키를 확인할 수 없어요 (HTTP ${v.status})`);
      }
      const ses = schoolSession();
      const key = await issueKey(ses, opener, status);
      await saveKey(key);
      await ses.clearStorageData({ origin: SITE });
      const v = await verifyKey(key);
      if (!v.ok && v.rejected) {
        rmSync(keyFile(), { force: true });
        throw new Error(`Gateway가 새 키를 거부했어요 (HTTP ${v.status})`);
      }
      this.key = key;
      this.model = v.ok ? pickModel(v.models) : null;
      return this.label;
    } finally {
      this.busy = false;
    }
  }

  disconnect(): void {
    this.key = null;
    this.model = null;
    rmSync(keyFile(), { force: true });
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    if (!this.key) throw new Error("AI가 연결되어 있지 않아요");
    const res = await net.fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status !== 200) throw new Error(`AI 호출이 실패했어요 (HTTP ${res.status})`);
    return res.json();
  }

  /** The cheap chat model the app talks with; the bench picked it, and a key without it falls back to the preference list. */
  private async chatModel(): Promise<string> {
    if (this.model) return this.model;
    if (!this.key) throw new Error("AI가 연결되어 있지 않아요");
    const v = await verifyKey(this.key);
    if (!v.ok) throw new Error(`AI 키를 확인할 수 없어요 (HTTP ${v.status})`);
    this.model = pickModel(v.models);
    if (!this.model) throw new Error("쓸 수 있는 AI 모델이 없어요");
    return this.model;
  }

  /** One chat completion. Spends credit, so callers run it only for something the student pressed. */
  async complete(system: string, user: string, maxTokens = 400, model?: string): Promise<string> {
    const body = (await this.post("/chat/completions", {
      model: model ?? (await this.chatModel()),
      max_tokens: maxTokens,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    })) as { choices?: Array<{ message?: { content?: unknown } }> };
    return String(body.choices?.[0]?.message?.content ?? "").trim();
  }

  /** A Jev decisions call (input tokens only are billed). */
  decide(request: Record<string, unknown>): Promise<unknown> {
    return this.post("/decisions/", request);
  }

  /** Remaining credits of the key's account (free to call); null when the Gateway does not answer. */
  async credits(): Promise<number | null> {
    if (!this.key) return null;
    const res = await net.fetch(`${GATEWAY}/credits/`, { headers: { Authorization: `Bearer ${this.key}` } });
    if (res.status !== 200) return null;
    const body = (await res.json()) as { total?: { remaining?: unknown } };
    return typeof body.total?.remaining === "number" ? body.total.remaining : null;
  }

  /** Gateway spend of this key grouped by model (free to call). */
  async usage(from: string): Promise<unknown> {
    if (!this.key) return null;
    const res = await net.fetch(`${GATEWAY}/usage/?from=${from}&by=model`, { headers: { Authorization: `Bearer ${this.key}` } });
    return res.status === 200 ? res.json() : { status: res.status };
  }

  async models(type?: string): Promise<string[]> {
    if (!this.key) return [];
    const res = await net.fetch(`${GATEWAY}/models/${type ? `?type=${encodeURIComponent(type)}` : ""}`, { headers: { Authorization: `Bearer ${this.key}` } });
    if (res.status !== 200) return [];
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return (body.data ?? []).map((m) => String(m.id ?? "")).filter(Boolean);
  }
}
