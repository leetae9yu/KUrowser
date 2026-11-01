import { describe, expect, test } from "bun:test";

import { parseBulletin, parseSchedule, postBody, SCHOOL_MENUS, termOf } from "../src/main/portal.ts";
import { scheduleOutcome } from "../src/renderer/commands.ts";
import type { SitesSnapshot } from "../src/shared/types.ts";

const sites = (schedule: SitesSnapshot["portal"]["data"]["schedule"] = []): SitesSnapshot => ({
  portal: { data: { notices: [], schedule }, fetchedAt: "2026-10-31T00:00:00Z", error: null },
  library: { data: { loans: [], signedIn: true }, fetchedAt: null, error: null },
  menus: [...SCHOOL_MENUS],
});

describe("academic calendar", () => {
  test("a calendar word picks its next event", () => {
    const list = sites([
      { start: "2026-10-20", end: "2026-10-26", label: "20(화)~26(월)", event: "제2학기 중간고사" },
      { start: "2026-12-14", end: "2026-12-18", label: "14(월)~18(금)", event: "제2학기 기말고사" },
    ]);
    expect(scheduleOutcome(list, "기말고사", new Date(2026, 9, 31))).toMatchObject({ items: [{ start: "2026-12-14" }] });
    expect(scheduleOutcome(list, undefined, new Date(2026, 9, 31))).toMatchObject({ items: [{ event: "제2학기 기말고사" }] });
  });
});

describe("portal board", () => {
  test("maps list rows and keeps the post link", () => {
    const body = JSON.stringify({
      postListForm: [
        { postSeq: 11, textTitle: "<b>가짜 공지</b> &amp; 안내", creDt: "20261030093000", creUserDeptName: "가짜처", summary: "요약&nbsp;글", encPopupUrl: "/ctt/bb/bulletin?encQS=abc", noticeYn: "Y", fileCnt: 2 },
      ],
    });
    const [n] = parseBulletin(body);
    expect(n).toMatchObject({ id: "p-11", title: "가짜 공지 & 안내", office: "가짜처", preview: "요약 글", url: "https://portal.korea.ac.kr/ctt/bb/bulletin?encQS=abc", pinned: true, files: 2 });
    expect(n!.postedAt).toBe("2026-10-30T00:30:00.000Z");
  });

  test("a body without the list key is a changed format, not an empty board", () => {
    expect(() => parseBulletin("{}")).toThrow();
    expect(parseBulletin(JSON.stringify({ postListForm: null }))).toEqual([]);
  });

  test("reads the body area, nested blocks included, and refuses a login page", () => {
    const page = `<div class="sub_search_area view"><div class="bc-s-post-ctnt-area"><p>첫 줄</p><div>둘째<br>셋째</div></div><div class="footer">끝</div></div>`;
    expect(postBody(page)).toBe("첫 줄\n둘째\n셋째");
    expect(postBody(`<input id="ipt_password">`)).toBeNull();
  });
});

describe("registrar calendar", () => {
  const html = `<table><caption>2학기</caption>
    <tr><th rowspan="2">12월</th><td>14(월)~18(금)</td><td>기말고사</td></tr>
    <tr><td>30(수)~4(월)</td><td>가짜 행사</td></tr>
    <tr><th>1월</th><td>15(금)</td><td>계절수업 종강</td></tr></table>`;

  test("dates carry the month header, cross into the next month and the next year", () => {
    expect(parseSchedule(html, 2026, 2)).toEqual([
      { start: "2026-12-14", end: "2026-12-18", label: "14(월)~18(금)", event: "기말고사" },
      { start: "2026-12-30", end: "2027-01-04", label: "30(수)~4(월)", event: "가짜 행사" },
      { start: "2027-01-15", end: "2027-01-15", label: "15(금)", event: "계절수업 종강" },
    ]);
  });

  test("picks the term table by month", () => {
    expect(termOf(new Date(2026, 9, 31))).toEqual({ year: 2026, half: 2 });
    expect(termOf(new Date(2027, 0, 10))).toEqual({ year: 2026, half: 2 });
    expect(termOf(new Date(2026, 3, 1))).toEqual({ year: 2026, half: 1 });
  });
});
