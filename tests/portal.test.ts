import { describe, expect, test } from "bun:test";

import { parseBulletin, parseSchedule, postBody, SCHOOL_MENUS, termOf } from "../src/main/portal.ts";
import { parseRules, scheduleOutcome } from "../src/renderer/commands.ts";
import type { SitesSnapshot } from "../src/shared/types.ts";

const noData = { courses: [], courseById: {}, assignments: [], lectures: [], recordings: [], notices: [], files: [] };
const sites = (schedule: SitesSnapshot["portal"]["data"]["schedule"] = []): SitesSnapshot => ({
  portal: { data: { notices: [], schedule }, fetchedAt: "2026-10-31T00:00:00Z", error: null },
  menus: [...SCHOOL_MENUS],
});

describe("school sentences", () => {
  test("open a menu page, ask the calendar or the portal board, and leave LMS sentences alone", () => {
    expect(parseRules("성적 화면 열어줘", noData, sites())).toMatchObject({ kind: "menu", menu: { id: "grades" } });
    expect(parseRules("수강신청 언제야", noData, sites())).toEqual({ kind: "schedule", word: "수강신청" });
    expect(parseRules("학교 공지 보여줘", noData, sites())).toEqual({ kind: "portal" });
    expect(parseRules("이번 주 과제 일정", noData, sites())).toMatchObject({ kind: "read", command: { command: "deadlines" } });
  });

  test("LMS sentences that mention a calendar word, a menu word or a theme keep their old meaning", () => {
    const read = (text: string) => parseRules(text, noData, sites());
    expect(read("중간고사 공지 요약해줘")).toMatchObject({ kind: "read", command: { command: "notices" } });
    expect(read("기말고사 관련 공지 보여줘")).toMatchObject({ kind: "read", command: { command: "notices" } });
    expect(read("새로 등록된 자료 보여줘")).toMatchObject({ kind: "read", command: { command: "files" } });
    expect(read("종강 전에 볼 강의")).toMatchObject({ kind: "read", command: { command: "lectures" } });
    expect(read("강의 메뉴 보여줘")).toMatchObject({ kind: "read", command: { command: "lectures" } });
    expect(read("시간표 화면 어둡게")).toMatchObject({ kind: "theme", theme: "dark" });
  });

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
