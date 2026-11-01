import { describe, expect, test } from "bun:test";

import { AMS_LOOKUPS, AmsSignedOut, enrolledCredits, grades, lookupForm, lookupSets, periodSpan, pickTerm, signedIn, summary, timetable } from "../src/main/ams-data.ts";
import { AmsService } from "../src/main/ams.ts";
import { parseRules } from "../src/renderer/commands.ts";
import type { AmsState } from "../src/shared/types.ts";

const noData = { courses: [], courseById: {}, assignments: [], lectures: [], recordings: [], notices: [], files: [] };

describe("academic-system lookups", () => {
  test("the form carries the fixed menu fields and the conditions", () => {
    const form = lookupForm("grid", { syySmtDivcd: "20262R" });
    expect(form.get("_menuId")).toBe(AMS_LOOKUPS.grid.menu);
    expect(form.get("@d1#")).toBe("dmCond");
    expect(form.get("@d1#syySmtDivcd")).toBe("20262R");
  });

  test("an HTML answer means the session ended; the session check needs isLogin 1", () => {
    expect(() => lookupSets("<html>login</html>")).toThrow(AmsSignedOut);
    expect(() => lookupSets(JSON.stringify({ _METADATA_: { success: false } }))).toThrow();
    expect(signedIn(JSON.stringify({ dmLoginConfirm: { isLogin: "1" } }))).toBe(true);
    expect(signedIn(JSON.stringify({ dmLoginConfirm: { isLogin: "0" } }))).toBe(false);
    expect(signedIn("<html></html>")).toBe(false);
  });

  test("this term when listed, otherwise the first", () => {
    const terms = [{ code: "20262R", fullNm: "2026학년도 2학기" }, { code: "20261R", fullNm: "2026학년도 1학기" }];
    expect(pickTerm(terms, new Date(2026, 9, 31))).toEqual({ code: "20262R", name: "2026학년도 2학기" });
    expect(pickTerm(terms, new Date(2027, 0, 10)).code).toBe("20262R");
    expect(pickTerm([{ code: "20251R" }], new Date(2026, 3, 1)).code).toBe("20251R");
    expect(() => pickTerm([])).toThrow();
  });
});

describe("timetable and credits", () => {
  test("periods map to clock times, ranges take both ends, unknown text stays", () => {
    expect(periodSpan("1")).toEqual(["09:00", "10:15"]);
    expect(periodSpan("2-3")).toEqual(["10:30", "13:15"]);
    expect(periodSpan("7")).toEqual(["18:00", "18:50"]);
    expect(periodSpan("A")).toEqual(["A", "A"]);
  });

  test("the grid becomes one meeting per class and day, with back-to-back periods joined", () => {
    const grid = [
      { timeTime: "1교시", monSubjtNm: "가짜과목", monNm: "AAA000-00<br>가짜과목<br>가짜교수<br>가짜관 101", wedSubjtNm: "" },
      { timeTime: "2교시", monSubjtNm: "가짜과목", monNm: "AAA000-00<br>가짜과목<br>가짜교수<br>가짜관 101" },
      { timeTime: "3교시", tueSubjtNm: "다른과목", tueNm: "BBB000-00" },
    ];
    expect(timetable(grid)).toEqual([
      { day: "월", slot: "1-2", title: "가짜과목", room: "가짜관 101", begins: "09:00", ends: "11:45" },
      { day: "화", slot: "3", title: "다른과목", room: "", begins: "12:00", ends: "13:15" },
    ]);
  });

  test("enrolled credits sum the number before the bracket; grades keep the cumulative line", () => {
    expect(enrolledCredits([{ cdtTime: "3.0(3)" }, { cdtTime: "2.0(2)" }, { cdtTime: "" }, { cdtTime: "x" }])).toBe(5);
    const s = summary({
      term: { code: "20262R", name: "2026학년도 2학기" },
      grid: [],
      enrolled: [{ cdtTime: "3.0(3)" }],
      gradeSets: { dsGradeAll: [{ ratlcSyySmtNm: "2026학년도 1학기", subjtNm: "가짜과목", cmpsjDivNm: "전공", cdt: "3", gradeGrdDivcd: "A0" }], dsGradeAcmtlAll: [{ gpa: "9.99", cmpsjCdt: "999" }] },
    });
    expect(s).toMatchObject({ term: "2026학년도 2학기", enrolledCredits: 3, gpa: "9.99", earned: "999", grades: [{ title: "가짜과목", grade: "A0", credits: "3" }] });
  });

  test("the cumulative line is the whole-record line after the term lines, not the first term's", () => {
    // As the academic system answers: one line per term, oldest first, then one line for the whole record.
    const g = grades({
      dsGradeAll: [],
      dsGradeAcmtlAll: [
        { syy: 2025, smtDivcd: "1R", gpa: "1.11", cmpsjCdt: "18" },
        { syy: 2025, smtDivcd: "2R", gpa: "2.22", cmpsjCdt: "20" },
        { syy: 2026, smtDivcd: "1R", gpa: "3.33", cmpsjCdt: "16" },
        { gpa: "4.44", cmpsjCdt: "54" },
      ],
    });
    expect({ gpa: g.gpa, earned: g.earned }).toEqual({ gpa: "4.44", earned: "54" });
  });

  test("course rows without a term name are named from the year and term code; A and B count like A0 and B0", () => {
    const g = grades({
      dsGradeAll: [
        { syy: 2025, smtDivcd: "1S", subjtNm: "가짜과목", cmpsjDivNm: "교양", cdt: 3, gradeGrdDivcd: "A" },
        { syy: 2025, smtDivcd: "1R", subjtNm: "가짜과목", cmpsjDivNm: "교양", cdt: 3, gradeGrdDivcd: "B" },
        { syy: 2025, smtDivcd: "2W", subjtNm: "가짜과목", cmpsjDivNm: "교양", cdt: 3, gradeGrdDivcd: "A+" },
      ],
    });
    expect(g.terms).toEqual([
      { label: "2025학년도 1학기", earned: 3, gpa: "3.00" },
      { label: "2025학년도 여름학기", earned: 3, gpa: "4.00" },
      { label: "2025학년도 겨울학기", earned: 3, gpa: "4.50" },
    ]);
  });

  test("credits per term and per category come from the course rows; failed and ungraded courses earn none", () => {
    const row = (term: string, category: string, cdt: string, grade: string) => ({ ratlcSyySmtNm: term, subjtNm: "가짜과목", cmpsjDivNm: category, cdt, gradeGrdDivcd: grade });
    const g = grades({
      dsGradeAll: [
        row("2025학년도 2학기", "전공필수", "3", "B+"),
        row("2025학년도 1학기", "전공필수", "3", "A+"),
        row("2025학년도 1학기", "교양", "2", "P"),
        row("2025학년도 여름학기", "교양", "3", "F"),
        row("2026학년도 1학기", "전공선택", "3", ""),
      ],
    });
    expect(g.terms).toEqual([
      { label: "2025학년도 1학기", earned: 5, gpa: "4.50" },
      { label: "2025학년도 여름학기", earned: 0, gpa: "0.00" },
      { label: "2025학년도 2학기", earned: 3, gpa: "3.50" },
      { label: "2026학년도 1학기", earned: 0, gpa: "" },
    ]);
    expect(g.categories.map((c) => [c.label, c.earned])).toEqual([
      ["전공필수", 6],
      ["교양", 2],
      ["전공선택", 0],
    ]);
    // Without a cumulative set the course rows give the totals: 8 credits, (4.5*3 + 3.5*3 + 0*3) / 9.
    expect({ earned: g.earned, gpa: g.gpa }).toEqual({ earned: "8", gpa: "2.67" });
  });
});

describe("logout during a read", () => {
  test("a read that finishes after logout leaves no data and saves no cookies", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const seen: AmsState[] = [];
    let kept = 0;
    const answer = (sets: unknown) => ({ status: 200, url: "", text: JSON.stringify(sets) });
    const ams = new AmsService({
      get: async () => answer({ dmLoginConfirm: { isLogin: "1" } }),
      post: async (path) => {
        await held;
        return path === AMS_LOOKUPS.terms.path ? answer({ dsSyySmtDivcd: [{ code: "20262R", fullNm: "가짜 학기" }] }) : answer({});
      },
      hidden: async () => {
        throw new Error("no window in this test");
      },
      onChange: (s) => seen.push(s),
      keepLogin: async () => {
        kept += 1;
      },
    });
    const run = ams.start();
    await Promise.resolve();
    ams.clear();
    release();
    await run;
    expect(ams.snapshot()).toEqual({ phase: "idle", data: null, at: null });
    expect(seen.some((s) => s.phase === "ready")).toBe(false);
    expect(kept).toBe(0);
  });
});

describe("academic-system sentences", () => {
  test("grades, timetable and credits read the academic system; a page request opens it; LMS words stay LMS", () => {
    expect(parseRules("이번 학기 성적 알려줘", noData)).toEqual({ kind: "ams", topic: "grades" });
    expect(parseRules("내 시간표 보여줘", noData)).toEqual({ kind: "ams", topic: "timetable" });
    expect(parseRules("이수학점 몇이야", noData)).toEqual({ kind: "ams", topic: "credits" });
    expect(parseRules("과제 성적 나왔어?", noData)).toMatchObject({ kind: "read" });
  });
});
