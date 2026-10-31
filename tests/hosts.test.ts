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
  const doc = "mainFrame";
  test("reads pass, school writes are refused", () => {
    expect(engineRequestAllowed("GET", "https://mylms.korea.ac.kr/api/v1/courses", "xhr")).toBe(true);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/api/v1/courses/1/assignments/2/submissions", "xhr")).toBe(false);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/api/v1/courses/1/assignments/2/submissions", doc)).toBe(false);
    expect(engineRequestAllowed("PUT", "https://mylms.korea.ac.kr/api/v1/courses/1/discussion_topics/2/read", "xhr")).toBe(false);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/learningx/api/v1/courses/1/attendance_items/2/progress", "xhr")).toBe(false);
    expect(engineRequestAllowed("POST", "https://www.google-analytics.com/g/collect", "xhr")).toBe(false);
  });

  test("only the LTI course-menu launch and SSO hand-offs post as page navigations", () => {
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/learningx/lti/lecture_attendance/course_menu", doc)).toBe(true);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/learningx/lti/lecture_attendance/course_menu", "subFrame")).toBe(true);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/learningx/lti/lecture_attendance/course_menu", "xhr")).toBe(false);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/learningx/lti/lecture_attendance/course_menu/progress", doc)).toBe(false);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/api/lti/login/submit", doc)).toBe(false);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/courses/1/external_tools/2", doc)).toBe(false);
    expect(engineRequestAllowed("POST", "https://sso.korea.ac.kr/anything", doc)).toBe(true);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/login/canvas", doc)).toBe(true);
    expect(engineRequestAllowed("POST", "https://mylms.korea.ac.kr/loginx", doc)).toBe(false);
  });

  test("the academic-system sign-in may send its mail-code steps and relay, nothing else there", () => {
    expect(engineRequestAllowed("POST", "https://sso.korea.ac.kr/korea/auth/IOPOtpReq.eps", "xhr")).toBe(true);
    expect(engineRequestAllowed("POST", "https://sso.korea.ac.kr/korea/auth/IOPOtpVerify.eps", "fetch")).toBe(true);
    expect(engineRequestAllowed("POST", "https://sso.korea.ac.kr/korea/EmailSend.eps", "xhr")).toBe(false);
    expect(engineRequestAllowed("POST", "https://ams.korea.ac.kr/exsignon/sso/sso_identify.jsp", doc)).toBe(true);
    expect(engineRequestAllowed("POST", "https://ams.korea.ac.kr/exsignon/sso/logout.jsp", doc)).toBe(false);
    expect(engineRequestAllowed("POST", "https://ams.korea.ac.kr/sch/sles/SlesstCtr/findStdAppcsDtlsList.do", "xhr")).toBe(false);
    expect(engineRequestAllowed("POST", "https://lms.korea.ac.kr/exsignon_new/sso/sso_identify.php", doc)).toBe(true);
    expect(engineRequestAllowed("POST", "https://lms.korea.ac.kr/exsignon_new/sso/sso_identify.php", "xhr")).toBe(false);
    expect(engineRequestAllowed("POST", "https://lms.korea.ac.kr/anything", doc)).toBe(false);
  });
});
