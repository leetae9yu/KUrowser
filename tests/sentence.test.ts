import { describe, expect, test } from "bun:test";

import { aliasesFor, displayName } from "../src/main/lms.ts";
import { fireTime } from "../src/main/fire-time.ts";
import { parseCommand, parseSummaries } from "../src/main/sentence.ts";

const COURSES = ["국제법", "기계학습"];

describe("AI command parsing", () => {
  test("keeps only read commands and known course names", () => {
    expect(parseCommand('{"command":"deadlines","range":"tomorrow","course":"국제법"}', COURSES)).toEqual({
      command: "deadlines",
      range: "tomorrow",
      course: "국제법",
      assignmentsOnly: false,
    });
    expect(parseCommand('답: {"command":"files","course":"없는과목","onlyNew":true}', COURSES)).toEqual({ command: "files", course: undefined, onlyNew: true });
    expect(parseCommand('{"command":"deadlines","range":"forever"}', COURSES)).toMatchObject({ range: "week" });
  });

  test("write-shaped or malformed answers never become commands", () => {
    expect(parseCommand('{"command":"submit","course":"국제법"}', COURSES)).toBeNull();
    expect(parseCommand('{"command":"play","course":"국제법"}', COURSES)).toBeNull();
    expect(parseCommand("모르겠어요", COURSES)).toBeNull();
    expect(parseCommand('{"command":"course","course":"없는과목"}', COURSES)).toEqual({ command: "unknown" });
  });
});

describe("notice summaries", () => {
  test("need exactly one line per notice", () => {
    expect(parseSummaries('["시험 범위 5장까지", "휴강"]', 2)).toEqual(["시험 범위 5장까지", "휴강"]);
    expect(parseSummaries('["하나"]', 2)).toBeNull();
    expect(parseSummaries("요약할 수 없어요", 1)).toBeNull();
  });
});

describe("deadline reminders", () => {
  const now = Date.parse("2026-10-31T00:00:00Z");
  const hours = (h: number) => new Date(now + h * 3_600_000).toISOString();

  test("fire a day ahead, or an hour ahead when the day has already started", () => {
    expect(fireTime(hours(48), now)).toBe(now + 24 * 3_600_000);
    expect(fireTime(hours(5), now)).toBe(now + 4 * 3_600_000);
    expect(fireTime(hours(0.5), now)).toBeNull();
    expect(fireTime(hours(-1), now)).toBeNull();
    expect(fireTime("not a date", now)).toBeNull();
  });
});

describe("course names", () => {
  test("drop campus code and section, keep short aliases", () => {
    expect(displayName("123R (서울) 국제법(International Law) - 01분반")).toBe("국제법");
    expect(aliasesFor("123R (서울) 국제법(International Law) - 01분반")).toEqual(["국제법", "internationallaw"]);
    expect(aliasesFor("데이터베이스")).toContain("데이");
  });
});
