import { describe, expect, test } from "bun:test";

import { commandOf, intentOf, jevRequest, pageUrl, parseJev, parseLlmRoute, unsure, type Route } from "../src/main/route.ts";

const menus = [
  { id: "grades", label: "성적 조회", words: [], url: "https://example.invalid/g" },
  { id: "sugang", label: "수강신청", words: [], url: "https://example.invalid/s" },
];

const courses = ["자료구조", "경제학원론"];

describe("parseJev", () => {
  test("reads kind, confidence and slots from the decisions answer", () => {
    const route = parseJev(
      {
        answers: {
          kind: { type: "choice", choice: "command", confidence: 0.91 },
          topic: { type: "choice", choice: "deadlines", confidence: 0.8 },
          course: { type: "choice", choice: "자료구조", confidence: 0.9 },
          range: { type: "choice", choice: "tomorrow", confidence: 0.7 },
          only_new: { type: "noul", noul: 0.1 },
        },
      },
      courses,
    );
    expect(route).toEqual({ kind: "command", confidence: 0.91, topic: "deadlines", topicConfidence: 0.8, course: "자료구조", range: "tomorrow", onlyNew: false, tree: {} });
  });

  test("drops a course that is not the student's and rejects an unknown kind", () => {
    expect(parseJev({ answers: { kind: { choice: "path", confidence: 1 }, course: { choice: "__none__" } } }, courses)?.course).toBeUndefined();
    expect(parseJev({ answers: { kind: { choice: "submit" } } }, courses)).toBeNull();
    expect(parseJev(null, courses)).toBeNull();
  });

  test("the request offers every course plus no course", () => {
    const q = jevRequest("자구 과제", courses).questions as Record<string, { criteria: Record<string, string> }>;
    expect(Object.keys(q.course!.criteria)).toEqual(["자료구조", "경제학원론", "__none__"]);
  });
});

describe("parseLlmRoute", () => {
  test("parses JSON wrapped in prose and clamps confidence", () => {
    expect(parseLlmRoute('답: {"kind":"path","topic":"grades","course":"경제학원론","confidence":3}', courses)).toEqual({
      kind: "path",
      confidence: 1,
      topic: "grades",
      course: "경제학원론",
      range: "week",
      onlyNew: false,
    });
    expect(parseLlmRoute("모르겠어요", courses)).toBeNull();
  });
});

describe("commandOf and pageUrl", () => {
  const base = { kind: "command" as const, confidence: 1, range: "week" as const, onlyNew: true };
  test("read topics become read commands; grades has none", () => {
    expect(commandOf({ ...base, topic: "files", course: "자료구조" })).toEqual({ command: "files", course: "자료구조", onlyNew: true });
    expect(commandOf({ ...base, topic: "course_home" })).toEqual({ command: "courses" });
    expect(commandOf({ ...base, topic: "grades" })).toBeNull();
  });

  test("the request offers the school menus and libraries, and drops a menu that is not offered", () => {
    const q = jevRequest("수강신청 열어줘", courses, menus).questions as Record<string, { criteria: Record<string, string> }>;
    expect(Object.keys(q.menu!.criteria)).toEqual(["grades", "sugang", "__none__"]);
    expect(Object.keys(q.library!.criteria)).toContain("중앙도서관");
    const answers = (menu: string, library: string) => ({ answers: { kind: { choice: "path", confidence: 0.9 }, topic: { choice: "school_menu" }, menu: { choice: menu }, library: { choice: library } } });
    expect(parseJev(answers("sugang", "과학도서관"), courses, menus)).toMatchObject({ menu: "sugang", library: "과학도서관" });
    const dropped = parseJev(answers("bank", "__none__"), courses, menus);
    expect(dropped?.menu).toBeUndefined();
    expect(dropped?.library).toBeUndefined();
  });

  test("pages stay on the Canvas origin", () => {
    expect(pageUrl("https://mylms.korea.ac.kr", "syllabus", "12", 7)).toBe("https://mylms.korea.ac.kr/courses/12/assignments/syllabus");
    expect(pageUrl("https://mylms.korea.ac.kr", "lectures", "12", 7)).toBe("https://mylms.korea.ac.kr/courses/12/external_tools/7");
    expect(pageUrl("https://mylms.korea.ac.kr", "grades", undefined, 7)).toBe("https://mylms.korea.ac.kr/grades");
  });
});

describe("intentOf", () => {
  const route = (r: Partial<Route>): Route => ({ kind: "command", confidence: 0.9, topic: "none", range: "week", onlyNew: false, ...r });

  test("school-site reads become the same intents as the chips", () => {
    expect(intentOf(route({ topic: "ams_credits" }))).toEqual({ intent: { kind: "ams", topic: "credits" } });
    expect(intentOf(route({ topic: "library_seats", library: "중앙도서관" }))).toEqual({ intent: { kind: "seats", library: "중앙도서관" } });
    expect(intentOf(route({ topic: "calendar" }))).toEqual({ intent: { kind: "schedule" } });
    expect(intentOf(route({ topic: "recordings", course: "자료구조" }))).toEqual({ intent: { kind: "recordings", course: "자료구조" } });
    expect(intentOf(route({ topic: "files", onlyNew: true }))).toEqual({ intent: { kind: "read", command: { command: "files", course: undefined, onlyNew: true } } });
  });

  test("a chat-kind question about data the chat model never sees reads the data", () => {
    expect(intentOf(route({ kind: "chat", topic: "ams_credits" }))).toEqual({ intent: { kind: "ams", topic: "credits" } });
    expect(intentOf(route({ kind: "chat", topic: "notices" }))).toBeNull();
  });

  test("page requests open the school menu of the topic, or the Canvas page", () => {
    expect(intentOf(route({ kind: "path", topic: "school_menu", menu: "sugang" }))).toEqual({ intent: { kind: "menu", id: "sugang" } });
    expect(intentOf(route({ kind: "path", topic: "school_menu" }))).toEqual({ intent: { kind: "menus" } });
    expect(intentOf(route({ kind: "path", topic: "ams_timetable" }))).toEqual({ intent: { kind: "menu", id: "timetable" } });
    expect(intentOf(route({ kind: "path", topic: "syllabus", course: "자료구조" }))).toEqual({ open: "syllabus" });
  });

  test("a read goes ahead when the kind or the topic is sure; a write needs a sure kind", () => {
    expect(unsure(route({ confidence: 0.52, topicConfidence: 0.9, topic: "portal" }), 0.6)).toBe(false);
    expect(unsure(route({ confidence: 0.52, topicConfidence: 0.4 }), 0.6)).toBe(true);
    expect(unsure(route({ kind: "write", confidence: 0.5, topicConfidence: 0.99 }), 0.6)).toBe(true);
    expect(unsure(route({ kind: "chat", confidence: 0.2 }), 0.6)).toBe(false);
  });

  test("an unclear topic asks back instead of guessing", () => {
    expect(intentOf(route({ topic: "none" }))).toBeNull();
    expect(intentOf(route({ kind: "path", topic: "none" }))).toBeNull();
  });
});
