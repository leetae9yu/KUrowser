import { describe, expect, test } from "bun:test";

import { FOCUS_RULES, focusCss, judge, newMemory, pageScript, ruleFor, type PageResult } from "../src/main/focus-rules.ts";

const LMS = "https://mylms.korea.ac.kr";
const seen = (target: boolean, done = false): PageResult => ({ matched: true, target, done });

describe("focus rules", () => {
  test("each school page finds its rule, anything else none", () => {
    expect(ruleFor(`${LMS}/courses/1/assignments/2`)?.id).toBe("assignment");
    expect(ruleFor(`${LMS}/courses/1/assignments/2?module_item_id=3`)?.id).toBe("assignment");
    // Any other school frame only gets the player rule, which does nothing without a play button.
    expect(ruleFor(`${LMS}/courses/1/assignments`)?.id).toBe("lecture-player");
    expect(ruleFor(`${LMS}/courses/1/quizzes/2`)?.id).toBe("quiz");
    expect(ruleFor(`${LMS}/courses/1/quizzes/2/take`)?.id).toBe("quiz-take");
    expect(ruleFor(`${LMS}/courses/1/discussion_topics/2`)?.id).toBe("notice");
    expect(ruleFor(`${LMS}/courses/1/modules/items/2`)?.id).toBe("lecture-tool");
    expect(ruleFor("https://portal.korea.ac.kr/login.jsp")?.id).toBe("portal-login");
    expect(ruleFor("http://mylms.korea.ac.kr/courses/1/assignments/2")).toBeNull();
    expect(ruleFor("https://mylms.korea.ac.kr.evil.example/courses/1/assignments/2")).toBeNull();
    expect(ruleFor("not a url")).toBeNull();
  });

  test("between five and eight rules, ids unique", () => {
    expect(FOCUS_RULES.length).toBeGreaterThanOrEqual(5);
    expect(FOCUS_RULES.length).toBeLessThanOrEqual(8);
    expect(new Set(FOCUS_RULES.map((r) => r.id)).size).toBe(FOCUS_RULES.length);
  });

  test("hiding applies only while focus mode is on", () => {
    const css = focusCss(ruleFor(`${LMS}/courses/1/assignments/2`)!);
    for (const line of css.split("\n").filter((l) => l.includes("display: none !important"))) expect(line.startsWith("html.kur-focus ")).toBe(true);
    expect(css).toContain("html.kur-focus #left-side");
    expect(css).toContain("html.kur-focus #content {");
  });

  test("the page script restyles only: no click, submit or request", () => {
    const script = pageScript(FOCUS_RULES[0]!, true);
    expect(script).not.toMatch(/\.click\(|requestSubmit|\.submit\(|dispatchEvent|fetch\(|XMLHttpRequest|sendBeacon/);
  });
});

describe("judge", () => {
  const assignment = ruleFor(`${LMS}/courses/1/assignments/2`)!;
  const quiz = ruleFor(`${LMS}/courses/1/quizzes/2`)!;
  const take = ruleFor(`${LMS}/courses/1/quizzes/2/take`)!;
  const url = `${LMS}/courses/1/assignments/2`;

  test("says the next step once per page, and done after the student submits", () => {
    const memory = newMemory();
    expect(judge(memory, assignment, url, seen(true)).hint).toBe(assignment.hint);
    expect(judge(memory, assignment, url, seen(true))).toEqual({});
    expect(judge(memory, assignment, url, seen(false, true))).toEqual({ done: assignment.doneText });
    expect(judge(memory, assignment, url, seen(false, true))).toEqual({});
  });

  test("a job already done when opened is not checked off again", () => {
    expect(judge(newMemory(), assignment, url, seen(true, true))).toEqual({});
  });

  test("without its button the page says nothing (locked or changed page)", () => {
    const memory = newMemory();
    expect(judge(memory, assignment, url, seen(false))).toEqual({});
    expect(judge(memory, assignment, url, seen(false, true))).toEqual({});
  });

  test("a quiz counts as done on its result page after the taking page", () => {
    const memory = newMemory();
    expect(judge(memory, quiz, `${LMS}/courses/1/quizzes/2`, seen(false, true))).toEqual({});
    expect(judge(memory, take, `${LMS}/courses/1/quizzes/2/take`, seen(true)).hint).toBe(take.hint);
    expect(judge(memory, quiz, `${LMS}/courses/1/quizzes/2`, seen(true, true))).toEqual({ done: quiz.doneText });
  });

  test("an unmatched page says nothing", () => {
    expect(judge(newMemory(), assignment, url, { matched: false, target: false, done: false })).toEqual({});
  });
});
