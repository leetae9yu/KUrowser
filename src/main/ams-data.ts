import type { AmsClass, AmsGrade, AmsSummary } from "../shared/types.ts";
import { SiteError } from "./site-text.ts";

export const AMS = "https://ams.korea.ac.kr";
export const AMS_SESSION_CHECK = `${AMS}/com/cnst/PropCtr/findViewSession.do`;

/** Read-only lookups of the academic system (a Nexacro app); each answers a JSON object of named row sets. */
export const AMS_LOOKUPS = {
  terms: { path: "/sch/sles/SlesstCtr/findAppcsSyySmtDivSchdlList.do", menu: "MTI4MTU5MjY3Njg4NzUzNTAwMDA=", label: "수강신청조회", program: "MTUwMjA4MTgwMjcx", table: "dsSyySmtDivcd" },
  enrolled: { path: "/sch/sles/SlesstCtr/findStdAppcsDtlsList.do", menu: "MTI4MTU5MjY3Njg4NzUzNTAwMDA=", label: "수강신청조회", program: "MTUwMjA4MTgwMjcx", table: "dsSles511" },
  grid: { path: "/sch/sles/SlesstCtr/findStdLctreTimtbOutptList.do", menu: "MTI4MTYyNzE3ODkwMjQxMTUwMDA=", label: "시간표조회", program: "MTUwMjQzMDYzMzI2", table: "dsSles332" },
  grades: { path: "/sch/sgra/SgrassCtr/findStdntGradeAllList.do", menu: "MTMxODkwMDI3MjA5NjYyOTgwMDA=", label: "전체성적조회", program: "MTkzMzU1NDM4MDY2", table: "dsGradeAll" },
} as const;

export type AmsLookup = keyof typeof AMS_LOOKUPS;
export const AMS_LOOKUP_PATHS: ReadonlySet<string> = new Set(Object.values(AMS_LOOKUPS).map((l) => l.path));

type Raw = Record<string, unknown>;

/** The form body of a lookup: fixed menu fields plus `@d1#<name>` conditions. */
export function lookupForm(name: AmsLookup, criteria: Record<string, string>): URLSearchParams {
  const l = AMS_LOOKUPS[name];
  const form = new URLSearchParams();
  for (const [k, v] of [["_menuId", l.menu], ["_menuNm", l.label], ["_pgmId", l.program], ["@d#", "@d1#"], ["@d1#", "dmCond"], ["@d1#tp", "dm"]] as const) form.append(k, v);
  for (const [k, v] of Object.entries(criteria)) form.append(`@d1#${k}`, v);
  return form;
}

export class AmsSignedOut extends SiteError {
  override name = "AmsSignedOut";
}

/** Row sets of a lookup answer; an HTML answer means the academic-system session has ended. */
export function lookupSets(body: string): Raw {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new AmsSignedOut("학사시스템 로그인이 끝났어요");
  }
  if (!data || typeof data !== "object") throw new SiteError("학사시스템 답을 읽지 못했어요");
  const meta = (data as Raw)._METADATA_ as Raw | undefined;
  if (meta && meta.success === false) throw new SiteError("학사시스템이 조회를 거절했어요");
  return data as Raw;
}

export const rows = (sets: Raw, name: string): Raw[] => (Array.isArray(sets[name]) ? (sets[name] as Raw[]).filter((r) => r && typeof r === "object") : []);

export function signedIn(body: string): boolean {
  try {
    return (JSON.parse(body) as { dmLoginConfirm?: { isLogin?: unknown } }).dmLoginConfirm?.isLogin === "1";
  } catch {
    return false;
  }
}

/** Term code like `20262R`: this term when the list has it, otherwise the newest listed. */
export function pickTerm(terms: Raw[], now = new Date()): { code: string; name: string } {
  const month = now.getMonth() + 1;
  const wanted = month <= 2 ? `${now.getFullYear() - 1}2R` : `${now.getFullYear()}${month <= 7 ? 1 : 2}R`;
  const found = terms.find((t) => t.code === wanted) ?? terms[0];
  if (!found) throw new SiteError("학사시스템에 학기가 없어요");
  return { code: String(found.code ?? ""), name: String(found.fullNm ?? found.code ?? "") };
}

const pad = (n: number): string => String(n).padStart(2, "0");
const clock = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Class periods: 1-6 are 75 minutes every 90 minutes from 09:00; 7-11 are 50 minutes every hour from 18:00. */
export function periodSpan(slot: string): [string, string] {
  const bound = (p: string): [string, string] | null => {
    if (!/^(?:[1-9]|1[01])$/.test(p)) return null;
    const n = Number(p);
    const start = n <= 6 ? 9 * 60 + (n - 1) * 90 : 18 * 60 + (n - 7) * 60;
    return [clock(start), clock(start + (n <= 6 ? 75 : 50))];
  };
  const parts = slot.split(/[-~]/).map((p) => p.trim());
  return [bound(parts[0] ?? "")?.[0] ?? slot, bound(parts.at(-1) ?? "")?.[1] ?? slot];
}

const DAYS = [["mon", "월"], ["tue", "화"], ["wed", "수"], ["thu", "목"], ["fri", "금"], ["sat", "토"]] as const;

/** The timetable grid (one row per period, a column pair per weekday) as one entry per class meeting. */
export function timetable(grid: Raw[]): AmsClass[] {
  const out: AmsClass[] = [];
  for (const row of grid) {
    const slot = String(row.timeTime ?? "").replaceAll("교시", "").trim();
    for (const [prefix, day] of DAYS) {
      const title = row[`${prefix}SubjtNm`];
      if (typeof title !== "string" || !title) continue;
      const lines = String(row[`${prefix}Nm`] ?? "").split(/<br\s*\/?>/).map((l) => l.trim()).filter(Boolean);
      const [begins, ends] = periodSpan(slot);
      out.push({ day, slot, title, room: lines.length >= 2 ? lines.at(-1)! : "", begins, ends });
    }
  }
  // Consecutive periods of one class on one day become a single meeting.
  const merged: AmsClass[] = [];
  for (const c of out.sort((a, b) => DAYS.findIndex((d) => d[1] === a.day) - DAYS.findIndex((d) => d[1] === b.day) || a.begins.localeCompare(b.begins))) {
    const last = merged.at(-1);
    if (last && last.day === c.day && last.title === c.title && last.room === c.room) {
      last.ends = c.ends;
      last.slot = `${last.slot.split("-")[0]}-${c.slot}`;
    } else merged.push({ ...c });
  }
  return merged;
}

/** Credits of this term's enrolment rows: `cdtTime` like `3.0(3)`, the number before the bracket. */
export function enrolledCredits(enrolled: Raw[]): number {
  const total = enrolled.reduce((sum, r) => {
    const n = Number(String(r.cdtTime ?? "").split("(")[0]!.trim());
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  return Math.round(total * 10) / 10;
}

export function grades(sets: Raw): { rows: AmsGrade[]; gpa: string; earned: string } {
  const list = rows(sets, AMS_LOOKUPS.grades.table).map((r) => ({
    term: String(r.ratlcSyySmtNm ?? `${r.syy ?? ""} ${r.smtDivcd ?? ""}`).trim(),
    title: String(r.subjtNm ?? ""),
    category: String(r.cmpsjDivNm ?? ""),
    credits: String(r.cdt ?? ""),
    grade: String(r.gradeGrdDivcd ?? ""),
  }));
  const total = rows(sets, "dsGradeAcmtlAll")[0] ?? {};
  return { rows: list, gpa: String(total.gpa ?? ""), earned: String(total.cmpsjCdt ?? total.aplyCdt ?? "") };
}

export function summary(parts: { term: { code: string; name: string }; grid: Raw[]; enrolled: Raw[]; gradeSets: Raw }): AmsSummary {
  const g = grades(parts.gradeSets);
  return { term: parts.term.name, classes: timetable(parts.grid), enrolledCredits: enrolledCredits(parts.enrolled), grades: g.rows, gpa: g.gpa, earned: g.earned };
}
