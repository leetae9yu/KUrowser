import type { ReadCommand } from "../shared/types.ts";

const RANGES = new Set(["today", "tomorrow", "week", "nextweek", "month"]);

export const COMMAND_PROMPT = `너는 고려대 LMS 앱의 문장 해석기야. 학생 문장을 아래 JSON 하나로만 바꿔. 설명, 코드 블록, 다른 글자는 쓰지 마.
읽기 명령만 있어. 제출, 업로드, 글쓰기, 출석이나 시청 기록 바꾸기, 강의 재생을 원하면 {"command":"unknown"}이야.
- 마감·과제·일정: {"command":"deadlines","range":"today|tomorrow|week|nextweek|month","course":"과목 이름(선택)","assignmentsOnly":true|false}
- 안 본 강의: {"command":"lectures","course":"(선택)"}
- 공지: {"command":"notices","course":"(선택)"}
- 강의자료 목록이나 받기: {"command":"files","course":"(선택)","onlyNew":true|false}
- 과목 하나: {"command":"course","course":"과목 이름"}
- 과목 목록: {"command":"courses"}
- 모르겠으면: {"command":"unknown"}
course에는 아래 과목 이름 중 하나를 그대로 써.`;

export function commandUserPrompt(text: string, courses: string[]): string {
  return `과목: ${courses.join(", ") || "(없음)"}\n문장: ${text}`;
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function parseCommand(raw: string, courses: string[]): ReadCommand | null {
  const data = extractJson(raw);
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const course = typeof d.course === "string" && courses.includes(d.course) ? d.course : undefined;
  switch (d.command) {
    case "deadlines":
      return { command: "deadlines", range: RANGES.has(String(d.range)) ? (d.range as "week") : "week", course, assignmentsOnly: d.assignmentsOnly === true };
    case "lectures":
      return { command: "lectures", course };
    case "notices":
      return { command: "notices", course };
    case "files":
      return { command: "files", course, onlyNew: d.onlyNew === true };
    case "course":
      return course ? { command: "course", course } : { command: "unknown" };
    case "courses":
      return { command: "courses" };
    case "unknown":
      return { command: "unknown" };
    default:
      return null;
  }
}

export const SUMMARY_PROMPT = `너는 대학 공지를 한 줄로 줄이는 도우미야. 공지마다 학생이 해야 할 일이나 바뀐 점을 40자 안쪽 한국어 한 줄로 써.
날짜, 시간, 장소, 숫자는 원문 그대로 남겨. 원문에 없는 내용은 쓰지 마.
답은 JSON 문자열 배열 하나만 써. 공지 순서와 개수를 그대로 맞춰.`;

export const SUMMARY_LECTURE_PROMPT = `너는 대학 강의 자막을 정리하는 도우미야. 아래 자막을 읽고 한국어로 정리해.
1. 다룬 주제를 나온 순서대로 3~6개 항목으로 써.
2. 중요한 용어, 정의, 시험에 나올 만한 내용을 따로 적어.
자막에 없는 내용은 쓰지 마. 마크다운 목록으로 써.`;

export function summaryUserPrompt(notices: Array<{ title: string; body: string }>): string {
  return notices.map((n, i) => `${i + 1}. 제목: ${n.title}\n본문: ${n.body}`).join("\n\n");
}

export function parseSummaries(raw: string, count: number): string[] | null {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(data) || data.length !== count) return null;
    return data.map((line) => String(line ?? "").replace(/\s+/g, " ").trim().slice(0, 80));
  } catch {
    return null;
  }
}
