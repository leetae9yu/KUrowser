import { describe, expect, test } from "bun:test";

import { commandOf, jevRequest, pageUrl, parseJev, parseLlmRoute } from "../src/main/route.ts";

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
    expect(route).toEqual({ kind: "command", confidence: 0.91, topic: "deadlines", course: "자료구조", range: "tomorrow", onlyNew: false });
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

  test("pages stay on the Canvas origin", () => {
    expect(pageUrl("https://mylms.korea.ac.kr", "syllabus", "12", 7)).toBe("https://mylms.korea.ac.kr/courses/12/assignments/syllabus");
    expect(pageUrl("https://mylms.korea.ac.kr", "lectures", "12", 7)).toBe("https://mylms.korea.ac.kr/courses/12/external_tools/7");
    expect(pageUrl("https://mylms.korea.ac.kr", "grades", undefined, 7)).toBe("https://mylms.korea.ac.kr/grades");
  });
});
