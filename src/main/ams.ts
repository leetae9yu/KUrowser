import type { WebContents } from "electron";

import type { AmsState, AmsSummary } from "../shared/types.ts";
import { AMS, AMS_SESSION_CHECK, AmsSignedOut, lookupSets, pickTerm, rows, signedIn, summary, type AmsLookup, AMS_LOOKUPS, lookupForm } from "./ams-data.ts";
import { SiteError, type SiteGet, type SiteResponse } from "./site-text.ts";

const ENTRY_MENU = "M111422";
const PAGE_WAIT_MS = 30_000;
/** The school keeps a mail code for five minutes; the window waits that long for the student. */
const CODE_WAIT_MS = 5 * 60_000;
const SESSION_WAIT_MS = 30_000;

const relayToken = (menu: string): string => btoa(`${AMS}?menuId=${menu}&isPc=true`).replace(/=+$/, "");
export const AMS_ENTRY = `${AMS}/exsignon/main/main.jsp?RelayState=${relayToken(ENTRY_MENU)}`;

export type AmsPost = (path: string, form: URLSearchParams) => Promise<SiteResponse>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Where the hidden window stands while signing in to the academic system. */
type Stage = "mail" | "password" | "ams" | "other";

const STAGE_SCRIPT = `(() => {
  if (location.host === "ams.korea.ac.kr" && !location.pathname.startsWith("/exsignon/")) return "ams";
  if (location.host !== "sso.korea.ac.kr") return "other";
  if (document.querySelector('input[type=password]:not([type=hidden]), #ipt_password')) return "password";
  if (document.getElementById("sso_option_change") && typeof window.otpReq === "function") return "mail";
  return "other";
})()`;

/** The page's own mail-code requests, run in its context: switch to mail, then send the code. */
const SEND_SCRIPT = `(async () => {
  const post = async (url) => (await fetch(url, { method: "POST", credentials: "include", headers: { "x-requested-with": "XMLHttpRequest", accept: "application/json" } })).json();
  const mask = await post("/korea/EmailMasking.eps");
  if (mask.errCd != 0) return { ok: false, message: String(mask.errMsg || "") };
  const sent = await post("/korea/auth/IOPOtpReq.eps");
  if (sent.returnCode !== "0000") return { ok: false, message: String(sent.returnMessage || sent.errMsg || "") };
  return { ok: true, mask: String(sent.maskEmail || mask.maskEmail || "") };
})()`;

const verifyScript = (code: string): string => `(async () => {
  const res = await fetch("/korea/auth/IOPOtpVerify.eps", { method: "POST", credentials: "include",
    headers: { "x-requested-with": "XMLHttpRequest", accept: "application/json", "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ cert_no: ${JSON.stringify(code)}, div: "scnd" }) });
  const data = await res.json();
  if (data.returnCode !== "0000") return { ok: false, message: String(data.returnMessage || data.errMsg || "") };
  setTimeout(() => document.getElementById("sso_option_change").submit(), 0);
  return { ok: true };
})()`;

async function waitStage(wc: WebContents, wanted: Stage[], ms: number): Promise<Stage> {
  const deadline = Date.now() + ms;
  let stage: Stage = "other";
  while (Date.now() < deadline && !wc.isDestroyed()) {
    stage = (await wc.executeJavaScript(STAGE_SCRIPT).catch(() => "other")) as Stage;
    if (wanted.includes(stage)) return stage;
    await sleep(500);
  }
  return stage;
}

export interface AmsDeps {
  get: SiteGet;
  post: AmsPost;
  /** Lends the shared hidden school window; the sign-in holds it while the student reads the mail. */
  hidden: <T>(job: (wc: WebContents) => Promise<T>) => Promise<T>;
  onChange: (state: AmsState) => void;
}

/**
 * The academic system (AMS): grades, timetable and credits. Each sign-in needs a code the school mails to the
 * student; the app sends it from the school's own sign-in page in the hidden window and asks for the code in the chat.
 * Nothing it reads is written to disk.
 */
export class AmsService {
  private state: AmsState = { phase: "idle", data: null, at: null };
  private code: ((code: string | null) => void) | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: AmsDeps) {}

  snapshot(): AmsState {
    return this.state;
  }

  private set(change: Partial<AmsState>): void {
    this.state = { ...this.state, ...change };
    this.deps.onChange(this.state);
  }

  /** Reads again with the session it has, or signs in (mail code) first. */
  start(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** The student typed the mailed code; false when no sign-in is waiting for one. */
  enterCode(code: string): boolean {
    if (!this.code || !/^\d{6}$/.test(code.trim())) return false;
    this.code(code.trim());
    return true;
  }

  cancel(): void {
    this.code?.(null);
  }

  clear(): void {
    this.cancel();
    this.state = { phase: "idle", data: null, at: null };
    this.deps.onChange(this.state);
  }

  private async run(): Promise<void> {
    try {
      if (!(await this.sessionAlive())) {
        const ok = await this.signIn();
        if (!ok) return;
      }
      this.set({ phase: "loading", message: undefined });
      this.set({ phase: "ready", data: await this.read(), at: new Date().toISOString() });
    } catch (error) {
      if (error instanceof AmsSignedOut) this.set({ phase: "error", message: "학사시스템 로그인이 끝났어요. 다시 시도해 주세요" });
      else this.set({ phase: "error", message: error instanceof SiteError ? error.message : "학사시스템을 읽지 못했어요" });
    }
  }

  private async sessionAlive(): Promise<boolean> {
    const res = await this.deps.get(AMS_SESSION_CHECK, { accept: "application/json" }).catch(() => null);
    return !!res && res.status === 200 && signedIn(res.text);
  }

  /** The mail-code sign-in, start to finish, inside one turn of the shared hidden window. */
  private signIn(): Promise<boolean> {
    return this.deps.hidden(async (wc) => {
      this.set({ phase: "sending", message: undefined, mask: undefined });
      await wc.loadURL(AMS_ENTRY).catch(() => undefined);
      const stage = await waitStage(wc, ["mail", "password", "ams"], PAGE_WAIT_MS);
      if (stage === "ams") return this.waitSession();
      if (stage !== "mail") {
        this.set({ phase: "error", message: stage === "password" ? "포털 로그인이 풀려서 학사시스템에 들어가지 못했어요. 학교 로그인을 다시 해 주세요" : "학사시스템 로그인 화면을 열지 못했어요" });
        return false;
      }
      const sent = (await wc.executeJavaScript(SEND_SCRIPT).catch(() => ({ ok: false, message: "" }))) as { ok: boolean; mask?: string; message?: string };
      if (!sent.ok) {
        this.set({ phase: "error", message: sent.message || "인증번호를 보내지 못했어요" });
        return false;
      }
      for (let tries = 0; ; tries++) {
        this.set({ phase: "code", mask: sent.mask, message: tries ? "인증번호가 맞지 않아요. 다시 넣어 주세요" : undefined });
        const code = await new Promise<string | null>((resolve) => {
          const timer = setTimeout(() => resolve(null), CODE_WAIT_MS);
          this.code = (value) => {
            clearTimeout(timer);
            this.code = null;
            resolve(value);
          };
        });
        if (code === null) {
          this.set({ phase: "error", message: "인증번호를 받지 못해서 멈췄어요. 다시 시도하면 새 번호를 보내요" });
          return false;
        }
        this.set({ phase: "verifying", message: undefined });
        const checked = (await wc.executeJavaScript(verifyScript(code)).catch(() => ({ ok: false }))) as { ok: boolean; message?: string };
        if (checked.ok) break;
        if (tries >= 2) {
          this.set({ phase: "error", message: checked.message || "인증번호가 맞지 않아요" });
          return false;
        }
      }
      if ((await waitStage(wc, ["ams"], SESSION_WAIT_MS)) !== "ams") {
        this.set({ phase: "error", message: "학사시스템으로 넘어가지 못했어요" });
        return false;
      }
      return this.waitSession();
    });
  }

  /** After the relay lands on AMS, the application session opens with three plain GETs (as the AMS page does). */
  private async waitSession(): Promise<boolean> {
    if (await this.sessionAlive()) return true;
    const token = relayToken(ENTRY_MENU);
    for (const path of [`/com/lgin/SsoCtr/j_login_sso.do?addParam=${token}`, `/?menuId=${ENTRY_MENU}&isPc=true`, `/com/lgin/SsoCtr/initPageWork.do?requestTimeStr=${Date.now()}&menuId=${ENTRY_MENU}&isPc=true`]) {
      await this.deps.get(`${AMS}${path}`).catch(() => null);
    }
    if (await this.sessionAlive()) return true;
    this.set({ phase: "error", message: "학사시스템 로그인을 끝내지 못했어요" });
    return false;
  }

  private async lookup(name: AmsLookup, criteria: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.deps.post(AMS_LOOKUPS[name].path, lookupForm(name, criteria));
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) throw new AmsSignedOut("학사시스템 로그인이 끝났어요");
    if (res.status !== 200) throw new SiteError("학사시스템이 답하지 않아요");
    return lookupSets(res.text);
  }

  private async read(): Promise<AmsSummary> {
    const term = pickTerm(rows(await this.lookup("terms", { syySmtDivcd: "" }), AMS_LOOKUPS.terms.table));
    const [grid, enrolled, gradeSets] = await Promise.all([
      this.lookup("grid", { syySmtDivcd: term.code }),
      this.lookup("enrolled", { syySmtDivcd: term.code }),
      this.lookup("grades", { stuno: "" }),
    ]);
    return summary({ term, grid: rows(grid, AMS_LOOKUPS.grid.table), enrolled: rows(enrolled, AMS_LOOKUPS.enrolled.table), gradeSets });
  }
}
