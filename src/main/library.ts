import type { WebContents } from "electron";

import type { Loan, SeatRoom } from "../shared/types.ts";
import { htmlText, SiteError, type SiteGet } from "./site-text.ts";

const SEATS = "https://librsv.korea.ac.kr";
const LIBRARY = "https://library.korea.ac.kr";
export const LOAN_LIST = `${LIBRARY}/my-library/loan/loan-list/`;
const LOGIN = `${LIBRARY}/login/`;
const SIGN_IN_MS = 20_000;

/** Reading-room systems of the Seoul campus libraries (codes of the seat service). */
export const LIBRARIES: readonly (readonly [string, string])[] = [
  ["1", "중앙도서관"],
  ["2", "중앙광장"],
  ["3", "백주년기념 학술정보관"],
  ["4", "과학도서관"],
  ["5", "하나스퀘어"],
  ["6", "법학도서관"],
];

type Raw = Record<string, unknown>;

const hhmm = (v: unknown): string => {
  const s = /^\d{4}$/.test(String(v ?? "")) ? String(v) : "0000";
  return `${s.slice(0, 2)}:${s.slice(2)}`;
};

/** One library's rooms from `/libraries/lib-status/{code}`; the envelope's `code` is 1 on success. */
export function parseSeats(body: string, library: string): SeatRoom[] {
  let data: Raw;
  try {
    data = JSON.parse(body) as Raw;
  } catch {
    throw new SiteError("열람실 좌석을 읽지 못했어요");
  }
  if (data.code !== 1) throw new SiteError("열람실 좌석을 읽지 못했어요");
  const rooms = Array.isArray(data.data) ? (data.data as Raw[]) : [];
  return rooms.map((r) => ({
    library,
    name: String(r.name ?? ""),
    total: Number(r.cnt) || 0,
    available: Number(r.available) || 0,
    hours: hhmm(r.startTm) === "00:00" && hhmm(r.endTm) === "00:00" ? "24시간" : `${hhmm(r.startTm)}-${hhmm(r.endTm)}`,
  }));
}

const dateOf = (text: string): string => {
  const m = /(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/.exec(text);
  return m ? `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}` : "";
};

/**
 * The loan list table on the library's my-library page: columns are found by their headings (서명, 소장처, 등록번호,
 * 대출일, 반납예정일, 연장횟수). Null when the page has no loan table heading: signed out, the library answers 200 with a page whose
 * script moves to its sign-in page.
 */
export function parseLoans(html: string): Loan[] | null {
  if (!html.includes("반납예정일")) return null;
  const table = /<table\b[\s\S]*?<\/table>/gi.exec(html.slice(Math.max(0, html.indexOf("반납예정일") - 4000)))?.[0];
  if (!table) throw new SiteError("도서관 대출 목록 모양이 바뀌었어요");
  const heads = [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => htmlText(m[1]!).replace(/\s+/g, ""));
  const col = (word: string): number => heads.findIndex((h) => h.includes(word));
  const at = { title: col("서명"), place: col("소장처"), number: col("등록번호"), loaned: col("대출일"), due: col("반납예정일"), renewals: col("연장횟수") };
  if (at.title < 0 || at.due < 0) throw new SiteError("도서관 대출 목록 모양이 바뀌었어요");
  const body = /<tbody\b[\s\S]*?<\/tbody>/i.exec(table)?.[0] ?? table;
  const loans: Loan[] = [];
  for (const row of body.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => htmlText(m[1]!).replace(/\s+/g, " "));
    const due = dateOf(cells[at.due] ?? "");
    if (cells.length < heads.length - 1 || !due) continue;
    loans.push({
      id: cells[at.number] || `${cells[at.title]}-${due}`,
      title: cells[at.title] ?? "",
      place: at.place >= 0 ? (cells[at.place] ?? "") : "",
      loanedAt: at.loaned >= 0 ? dateOf(cells[at.loaned] ?? "") : "",
      due,
      renewals: at.renewals >= 0 ? Number(cells[at.renewals]?.match(/\d+/)?.[0] ?? 0) : 0,
    });
  }
  return loans.sort((a, b) => a.due.localeCompare(b.due));
}

/** Every Seoul library's rooms; a library that does not answer is left out. */
export async function librarySeats(get: SiteGet): Promise<SeatRoom[]> {
  const headers = { accept: "application/json, text/plain, */*", referer: `${SEATS}/` };
  const per = await Promise.all(
    LIBRARIES.map(([code, name]) =>
      get(`${SEATS}/libraries/lib-status/${code}`, headers)
        .then((res) => (res.status === 200 ? parseSeats(res.text, name) : []))
        .catch(() => [] as SeatRoom[]),
    ),
  );
  const rooms = per.flat();
  if (!rooms.length) throw new SiteError("열람실 좌석을 가져오지 못했어요");
  return rooms;
}

/** The student's loans, or null when the library has not signed the student in yet. */
export async function libraryLoans(get: SiteGet): Promise<Loan[] | null> {
  const res = await get(LOAN_LIST);
  if (res.url.startsWith(LOGIN)) return null;
  if (res.status !== 200) throw new SiteError("도서관 대출 목록을 가져오지 못했어요");
  return parseLoans(res.text);
}

/**
 * Signs the library in with the portal login: its sign-in page offers an SSO button (a GET form to the SSO OAuth
 * endpoint) that returns signed in without a password while the portal session lives. Runs in the shared hidden window.
 */
export function librarySignIn(wc: WebContents): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!wc.isDestroyed()) {
        wc.off("did-finish-load", step);
      }
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), SIGN_IN_MS);
    let submitted = false;
    const step = (): void => {
      const url = wc.getURL();
      if (!url.startsWith(LIBRARY)) return;
      if (!url.startsWith(LOGIN)) return finish(submitted);
      if (submitted) return;
      submitted = true;
      wc.executeJavaScript(`(() => { const f = [...document.forms].find((f) => (f.action || "").startsWith("https://sso.korea.ac.kr/oauth/Authorization.eps")); if (!f) return false; f.submit(); return true; })()`)
        .then((ok) => {
          if (!ok) finish(false);
        })
        .catch(() => finish(false));
    };
    wc.on("did-finish-load", step);
    wc.loadURL(LOGIN).catch(() => undefined);
  });
}
