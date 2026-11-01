import { describe, expect, test } from "bun:test";

import { byWeek, weekOf } from "../src/renderer/groups.ts";

describe("weekOf and byWeek", () => {
  test("reads the week a folder names", () => {
    expect(weekOf("3주차 자료")).toBe(3);
    expect(weekOf("12 주 차")).toBe(12);
    expect(weekOf("Week 4")).toBe(4);
    expect(weekOf("기타")).toBeNull();
  });

  test("puts groups in week order and keeps folders without a week at the end in first-seen order", () => {
    const files = ["10주차", "기타", "2주차", "참고", "2주차", "1주차"].map((folder, i) => ({ id: String(i), folder }));
    expect(byWeek(files, (f) => f.folder).map((g) => [g.label, g.items.map((f) => f.id)])).toEqual([
      ["1주차", ["5"]],
      ["2주차", ["2", "4"]],
      ["10주차", ["0"]],
      ["기타", ["1"]],
      ["참고", ["3"]],
    ]);
  });
});
