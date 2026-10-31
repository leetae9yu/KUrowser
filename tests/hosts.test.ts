import { describe, expect, test } from "bun:test";

import { engineRequestAllowed, isAiLoginUrl, isAllowedPage, isSchoolUrl } from "../src/main/hosts.ts";

describe("school pages", () => {
  test("only https korea.ac.kr hosts load as pages", () => {
    expect(isSchoolUrl("https://mylms.korea.ac.kr/courses/1")).toBe(true);
    expect(isSchoolUrl("https://korea.ac.kr/")).toBe(true);
    expect(isSchoolUrl("http://mylms.korea.ac.kr/")).toBe(false);
    expect(isSchoolUrl("https://korea.ac.kr.evil.example/")).toBe(false);
    expect(isSchoolUrl("https://evilkorea.ac.kr/")).toBe(false);
    expect(isAllowedPage("about:blank")).toBe(true);
    expect(isAllowedPage("https://www.google.com/")).toBe(false);
  });

  test("the AI login allows plain http only on the SSO bridge", () => {
    expect(isAiLoginUrl("http://llmsso.korea.ac.kr/korea-seoul/sso/login")).toBe(true);
    expect(isAiLoginUrl("http://llm.korea.ac.kr/auth")).toBe(false);
    expect(isAiLoginUrl("https://api.baze.co/v1/gateway/models")).toBe(false);
  });
});

describe("hidden engine window", () => {
  test("reads pass, school writes are refused", () => {
    expect(engineRequestAllowed("GET", "https://mylms.korea.ac.kr/api/v1/courses")).toBe(true);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/api/v1/courses/1/assignments/2/submissions")).toBe(false);
    expect(engineRequestAllowed("PUT", "https://mylms.korea.ac.kr/api/v1/courses/1/discussion_topics/2/read")).toBe(false);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/learningx/api/v1/courses/1/attendance_items/2/progress")).toBe(false);
    expect(engineRequestAllowed("POST", "https://www.google-analytics.com/g/collect")).toBe(false);
  });

  test("LTI launches and SSO hand-offs still open pages", () => {
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/courses/1/external_tools/2")).toBe(true);
    expect(engineRequestAllowed("POST", "https://sso.korea.ac.kr/anything")).toBe(true);
  });
});
