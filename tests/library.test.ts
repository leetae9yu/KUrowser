import { describe, expect, test } from "bun:test";

import { parseLoans, parseSeats } from "../src/main/library.ts";
import { nextHop, siteUrl } from "../src/main/site-text.ts";
import { parseRules, seatsOutcome } from "../src/renderer/commands.ts";

const noData = { courses: [], courseById: {}, assignments: [], lectures: [], recordings: [], notices: [], files: [] };

describe("reading-room seats", () => {
  test("maps rooms and their hours, and refuses a failed envelope", () => {
    const body = JSON.stringify({ code: 1, data: [{ name: "가짜 열람실", cnt: 100, available: 12, inUse: 88, startTm: "0900", endTm: "2200" }, { name: "24시 실", cnt: 10, available: 0, startTm: "0000", endTm: "0000" }] });
    expect(parseSeats(body, "가짜도서관")).toEqual([
      { library: "가짜도서관", name: "가짜 열람실", total: 100, available: 12, hours: "09:00-22:00" },
      { library: "가짜도서관", name: "24시 실", total: 10, available: 0, hours: "24시간" },
    ]);
    expect(() => parseSeats(JSON.stringify({ code: 0 }), "가짜도서관")).toThrow();
  });

  test("most free seats first, one library or all", () => {
    const rooms = [
      { library: "A", name: "1", total: 10, available: 1, hours: "" },
      { library: "B", name: "2", total: 10, available: 7, hours: "" },
    ];
    expect(seatsOutcome(rooms)).toMatchObject({ items: [{ name: "2" }, { name: "1" }] });
    expect(seatsOutcome(rooms, "A")).toMatchObject({ title: "A 열람실 빈자리 1석이에요", items: [{ name: "1" }] });
  });
});

describe("library loans", () => {
  const page = (rows: string) => `<table class="table"><thead><tr><th>No.</th><th>서명/저자</th><th>소장처</th><th>청구기호</th><th>등록번호</th><th>대출일</th><th>반납예정일</th><th>연장횟수</th><th>대출연장</th></tr></thead><tbody>${rows}</tbody></table>`;

  test("reads rows by their headings, soonest due first, and skips the empty-list row", () => {
    const html = page(
      `<tr><td>1</td><td><a href="#">가짜 책 / 가짜 저자</a></td><td>가짜 서고</td><td>000</td><td>X1</td><td>2026.10.20</td><td>2026.11.10</td><td>1</td><td><button>연장</button></td></tr>` +
        `<tr><td>2</td><td>다른 가짜 책</td><td>가짜 서고</td><td>001</td><td>X2</td><td>2026-10-25</td><td>2026-11-03</td><td>0</td><td></td></tr>`,
    );
    expect(parseLoans(html)).toEqual([
      { id: "X2", title: "다른 가짜 책", place: "가짜 서고", loanedAt: "2026-10-25", due: "2026-11-03", renewals: 0 },
      { id: "X1", title: "가짜 책 / 가짜 저자", place: "가짜 서고", loanedAt: "2026-10-20", due: "2026-11-10", renewals: 1 },
    ]);
    expect(parseLoans(page(`<tr><td colspan="9">대출 중인 자료가 없습니다</td></tr>`))).toEqual([]);
  });

  test("a page without the loan table (signed out) is not an empty list", () => {
    expect(parseLoans(`<form action="https://sso.korea.ac.kr/oauth/Authorization.eps"></form><input name="upw">`)).toBeNull();
    expect(parseLoans(`<html><script>location.href = "/login/"</script></html>`)).toBeNull();
  });
});

describe("site hosts", () => {
  test("the first address and every redirect hop stay on the five site hosts", () => {
    expect(siteUrl("https://library.korea.ac.kr/my-library/loan/loan-list/").hostname).toBe("library.korea.ac.kr");
    expect(nextHop("https://library.korea.ac.kr/my-library/", "/login/?returl=x")).toBe("https://library.korea.ac.kr/login/?returl=x");
    expect(() => nextHop("https://library.korea.ac.kr/", "https://sso.korea.ac.kr/oauth/Authorization.eps")).toThrow();
    expect(() => nextHop("https://portal.korea.ac.kr/", "https://evil.example/")).toThrow();
    expect(() => siteUrl("http://portal.korea.ac.kr/")).toThrow();
    expect(() => siteUrl("https://portal.korea.ac.kr@evil.example/")).toThrow();
    expect(() => siteUrl("https://portal.korea.ac.kr:8443/")).toThrow();
  });
});

describe("library sentences", () => {
  test("seats and loans, without taking LMS sentences", () => {
    expect(parseRules("중도 빈자리 있어?", noData)).toEqual({ kind: "seats", library: "중앙도서관" });
    expect(parseRules("열람실 좌석", noData)).toEqual({ kind: "seats", library: undefined });
    expect(parseRules("빌린 책 반납일 알려줘", noData)).toEqual({ kind: "loans" });
    expect(parseRules("과제 제출 반납 기한", noData)).toMatchObject({ kind: "read" });
  });
});
