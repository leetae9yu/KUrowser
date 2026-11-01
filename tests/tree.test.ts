import { describe, expect, test } from "bun:test";

import { pick, PORTAL_GROUPS, portalScreens, portalUrl, readStep, readTree, stepOptions, stepRequest } from "../src/main/tree.ts";

const courses = ["가짜과목A", "가짜과목B"];

describe("page tree", () => {
  test("academic-system menus open through its sign-in relay; other portal pages open as they are", () => {
    const relay = portalUrl("https://ams.korea.ac.kr?isPc=true&menuId=M111353");
    expect(relay.startsWith("https://ams.korea.ac.kr/exsignon/main/main.jsp?RelayState=")).toBe(true);
    expect(atob(new URL(relay).searchParams.get("RelayState")!)).toContain("menuId=M111353");
    expect(portalUrl("https://gms.korea.ac.kr/front?menuId=KSV")).toBe("https://gms.korea.ac.kr/front?menuId=KSV");
  });

  test("the portal table holds a leave-of-absence screen under 학사 > 학적", () => {
    expect(PORTAL_GROUPS).toContain("학사 > 학적");
    expect(portalScreens("학사 > 학적").map((s) => s.label)).toContain("휴복학신청");
  });

  test("steps come in order: area, then course or portal group, then screen", () => {
    expect(stepOptions({ text: "x" }, courses, null).step).toBe("area");
    expect(stepOptions({ text: "x", area: "lms" }, courses, null)).toEqual({ step: "course", labels: courses });
    expect(stepOptions({ text: "x", area: "portal" }, courses, null).step).toBe("group");
    const screens = [{ label: "성적", url: "https://mylms.korea.ac.kr/courses/1/grades" }];
    expect(stepOptions({ text: "x", area: "lms", course: "가짜과목A" }, courses, screens)).toEqual({ step: "screen", labels: ["성적"] });
  });

  test("a pick must be one of the step's options", () => {
    expect(pick({ text: "x" }, "area", "포털 학사·행정 화면", ["LMS 과목 화면", "포털 학사·행정 화면"])).toEqual({ text: "x", area: "portal" });
    expect(pick({ text: "x", area: "lms" }, "course", "다른과목", courses)).toBeNull();
  });

  test("the first call keeps a step only when Jev is sure of it", () => {
    const answers = { area: { choice: "lms", confidence: 0.9 }, portal_group: { choice: "학사 > 학적", confidence: 0.9 } };
    expect(readTree(answers, { name: "가짜과목A", confidence: 0.8 })).toEqual({ area: "lms", course: "가짜과목A" });
    expect(readTree(answers, { name: "가짜과목A", confidence: 0.4 })).toEqual({ area: "lms" });
    expect(readTree({ area: { choice: "portal", confidence: 0.5 } }, { confidence: 0 })).toEqual({});
    expect(readTree({ area: { choice: "portal", confidence: 0.9 }, portal_group: { choice: "학사 > 학적", confidence: 0.7 } }, { confidence: 0 })).toEqual({ area: "portal", group: "학사 > 학적" });
  });

  test("a step call numbers its options, and an answer outside them reads as none", () => {
    const labels = ["수업 계획서", "성적"];
    const q = (stepRequest("가짜 문장", "screen", labels).questions as Record<string, { criteria: Record<string, string> }>).pick!;
    expect(q.criteria).toEqual({ o0: "수업 계획서", o1: "성적", __none__: "이 중에 없음" });
    expect(readStep({ answers: { pick: { choice: "o1", confidence: 0.8 } } }, labels)).toEqual({ label: "성적", confidence: 0.8 });
    expect(readStep({ answers: { pick: { choice: "__none__", confidence: 0.9 } } }, labels).label).toBeNull();
    expect(readStep(null, labels)).toEqual({ label: null, confidence: 0 });
  });
});
