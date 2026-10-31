import { describe, expect, test } from "bun:test";

import { audioFilters, captionText, cer, estimateCredits, toSrt } from "../src/main/stt.ts";

describe("estimateCredits", () => {
  test("bills per second at 6 credits a minute, divided by the speed-up", () => {
    expect(estimateCredits(120)).toBe(12);
    expect(estimateCredits(120, 1.5)).toBe(8);
    expect(estimateCredits(185.81, 1.5)).toBe(12.39);
  });
});

describe("audioFilters", () => {
  test("chains atempo stages of at most 2.0 and keeps 1x untouched", () => {
    expect(audioFilters(1, false)).toBe("anull");
    expect(audioFilters(1.5, false)).toBe("atempo=1.500");
    expect(audioFilters(3, false)).toBe("atempo=2.000,atempo=1.500");
    expect(audioFilters(2, true).startsWith("silenceremove=")).toBe(true);
  });
});

describe("toSrt and captionText", () => {
  test("formats cues and strips them back to text", () => {
    const srt = toSrt([{ start_ms: 1500, end_ms: 3_723_004, text: " 안녕하세요 " }]);
    expect(srt).toBe("1\n00:00:01,500 --> 01:02:03,004\n안녕하세요\n");
    expect(captionText(`WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v A>첫 줄</v>\n\n${srt}`)).toBe("첫 줄 안녕하세요");
  });
});

describe("cer", () => {
  test("counts character edits, ignoring spaces and punctuation", () => {
    expect(cer("자료 구조, 수업", "자료구조 수업")).toBe(0);
    expect(cer("가나다라", "가나라")).toBe(0.25);
  });
});
