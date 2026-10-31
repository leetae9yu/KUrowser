import { expect, test } from "bun:test";

import { shortCourseName } from "../src/renderer/data.ts";

test("shortCourseName drops tags, term code, year, English title and section", () => {
  expect(shortCourseName("[학생] [한국어] 2026 데이터 윤리 교육 - 02분반")).toBe("데이터 윤리 교육");
  expect(shortCourseName("262R (서울-학부)자료구조(DATA STRUCTURES)-00분반")).toBe("자료구조");
  expect(shortCourseName("확률과통계")).toBe("확률과통계");
});
