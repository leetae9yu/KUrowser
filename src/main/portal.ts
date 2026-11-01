import type { PortalNotice, ScheduleEntry, SchoolMenu } from "../shared/types.ts";
import { htmlText, innerHtml, SiteError, type SiteGet } from "./site-text.ts";

const PORTAL = "https://portal.korea.ac.kr";
const REGISTRAR = "https://registrar.korea.ac.kr";
const NOTICE_BOARD = 6;
const SEOUL_CAMPUS = "4";
const NOTICE_COUNT = 15;
const BODY_CHARS = 2000;

type Raw = Record<string, unknown>;

const text = (value: unknown): string => htmlText(String(value ?? ""));

/** creDt is `YYYYMMDDhhmmss` in Korean time. */
function postedAt(value: unknown): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?/.exec(String(value ?? ""));
  if (!m) return "";
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:00+09:00`).toISOString();
}

/** Rows of the public portal board list (`/ctt/svc/bulletin`); a body without `postListForm` is a changed format. */
export function parseBulletin(body: string): PortalNotice[] {
  let data: Raw;
  try {
    data = JSON.parse(body) as Raw;
  } catch {
    throw new SiteError("포털 공지 목록을 읽지 못했어요");
  }
  if (!("postListForm" in data)) throw new SiteError("포털 공지 목록 모양이 바뀌었어요");
  const rows = Array.isArray(data.postListForm) ? (data.postListForm as Raw[]) : [];
  return rows.map((row) => {
    const link = [row.encPopupUrl, row.encUrl].find((v): v is string => typeof v === "string" && v !== "") ?? "";
    return {
      id: `p-${String(row.postSeq ?? "")}`,
      title: text(row.textTitle) || text(row.title),
      office: text(row.creUserDeptName),
      postedAt: postedAt(row.creDt),
      preview: text(row.summary),
      body: "",
      url: link.startsWith("/") ? `${PORTAL}${link}` : link,
      pinned: row.noticeYn === "Y",
      files: Number(row.fileCnt) || 0,
    };
  });
}

/** The body of a portal post page; null when the page is a login page or has no body area. */
export function postBody(html: string): string | null {
  if (html.includes("ipt_password")) return null;
  const area = innerHtml(html, "bc-s-post-ctnt-area") ?? innerHtml(html, "text_area");
  return area === null ? null : htmlText(area).slice(0, BODY_CHARS);
}

/** Registrar calendar of a term: semester 1 in March to July, semester 2 from August through the next February. */
export function termOf(now: Date): { year: number; half: 1 | 2 } {
  const month = now.getMonth() + 1;
  if (month <= 2) return { year: now.getFullYear() - 1, half: 2 };
  return { year: now.getFullYear(), half: month <= 7 ? 1 : 2 };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The registrar table: a month header (`9월`) leads each group, then rows of `day(weekday)` or `day(weekday)~day(weekday)`
 * and the event. Semester 2 runs into January and February of the next year; an end day before the start day is in
 * the next month.
 */
export function parseSchedule(html: string, year: number, half: 1 | 2): ScheduleEntry[] {
  const table = html.slice(Math.max(0, html.indexOf("<table")));
  const entries: ScheduleEntry[] = [];
  let month = 0;
  for (const row of table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ head: m[1]!.toLowerCase() === "th", value: htmlText(m[2]!).replace(/\s+/g, " ") }));
    const header = /^(\d{1,2})월$/.exec(cells[0]?.value ?? "");
    if (header) {
      month = Number(header[1]);
      cells.shift();
    }
    const [when, what] = cells.map((c) => c.value);
    const days = /^(\d{1,2})\([^)]*\)(?:\s*~\s*(?:(\d{1,2})\.\s*)?(\d{1,2})\([^)]*\))?/.exec(when ?? "");
    if (!month || !days || !what) continue;
    const y = half === 2 && month <= 2 ? year + 1 : year;
    const startDay = Number(days[1]);
    let endMonth = days[2] ? Number(days[2]) : month;
    const endDay = days[3] ? Number(days[3]) : startDay;
    if (!days[2] && endDay < startDay) endMonth = month === 12 ? 1 : month + 1;
    const endYear = endMonth < month ? y + 1 : y;
    entries.push({ start: `${y}-${pad(month)}-${pad(startDay)}`, end: `${endYear}-${pad(endMonth)}-${pad(endDay)}`, label: when!, event: what });
  }
  return entries;
}

/** AMS opens a menu after its own second sign-in step (a mail code) on the school page. */
export const amsMenu = (menu: string): string =>
  `https://ams.korea.ac.kr/exsignon/main/main.jsp?RelayState=${btoa(`https://ams.korea.ac.kr?menuId=${menu}&isPc=true`).replace(/=+$/, "")}`;

/** School pages students open most; each opens on the left beside the chat. */
export const SCHOOL_MENUS: readonly SchoolMenu[] = [
  { id: "grades", label: "성적 조회", words: ["성적"], url: amsMenu("M112493") },
  { id: "timetable", label: "내 시간표", words: ["시간표"], url: amsMenu("M111423") },
  { id: "enrolled", label: "수강 내역", words: ["수강내역", "수강조회"], url: amsMenu("M111422") },
  { id: "sugang", label: "수강신청", words: ["수강신청"], url: "https://sugang.korea.ac.kr/" },
  { id: "calendar", label: "학사 일정", words: ["학사일정", "학사력"], url: `${REGISTRAR}/eduinfo/affairs/schedule.do` },
  { id: "portal", label: "포털", words: ["포털", "kupid"], url: `${PORTAL}/` },
  { id: "loans", label: "도서관 내 대출", words: ["대출", "빌린책", "반납"], url: "https://library.korea.ac.kr/my-library/loan/loan-list/" },
  { id: "seats", label: "열람실 좌석", words: ["열람실", "좌석"], url: "https://librsv.korea.ac.kr/" },
];

/** The latest Seoul-campus portal notices, newest first. No login is needed for the list. */
export async function portalNotices(get: SiteGet): Promise<PortalNotice[]> {
  const res = await get(`${PORTAL}/ctt/svc/bulletin?b=${NOTICE_BOARD}&ls=${NOTICE_COUNT}&e0=${SEOUL_CAMPUS}`, {
    accept: "application/json, text/plain, */*",
    referer: `${PORTAL}/index.jsp`,
    "x-requested-with": "XMLHttpRequest",
  });
  if (res.status !== 200) throw new SiteError("포털 공지를 가져오지 못했어요");
  return parseBulletin(res.text).sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}

/** One post's body through its own list link; an empty string when the page has none. */
export async function portalBody(get: SiteGet, notice: PortalNotice): Promise<string> {
  if (!notice.url.startsWith(`${PORTAL}/`)) return "";
  const res = await get(notice.url);
  return res.status === 200 ? (postBody(res.text) ?? "") : "";
}

export async function academicSchedule(get: SiteGet, now = new Date()): Promise<ScheduleEntry[]> {
  const { year, half } = termOf(now);
  const res = await get(`${REGISTRAR}/eduinfo/affairs/schedule.do?cYear=${year}&hakGi=${half}`);
  if (res.status !== 200) throw new SiteError("학사 일정을 가져오지 못했어요");
  const entries = parseSchedule(res.text, year, half);
  if (!entries.length) throw new SiteError("학사 일정 표 모양이 바뀌었어요");
  return entries;
}
