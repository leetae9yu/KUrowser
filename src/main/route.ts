import type { ReadCommand } from "../shared/types.ts";

/** command: the app reads the LMS and shows it; path: open a school page; chat: answer in words; write: change something at school (refused). */
export type Kind = "command" | "path" | "chat" | "write";
export type Topic = "deadlines" | "lectures" | "notices" | "files" | "grades" | "syllabus" | "course_home" | "courses" | "none";
export type Range = Extract<ReadCommand, { command: "deadlines" }>["range"];

export interface Route {
  kind: Kind;
  confidence: number;
  topic: Topic;
  course?: string;
  range: Range;
  onlyNew: boolean;
}

const KINDS: Record<Kind, string> = {
  command: "앱이 학생 대신 LMS 정보를 읽어 보여 주면 되는 요청: 마감·과제 일정, 안 본 강의, 공지 목록, 강의자료 목록이나 받기, 과목 정보",
  path: "학교 사이트의 특정 화면을 열어 달라는 요청: '~ 열어줘', '~ 페이지 가줘', '~ 화면 보여줘', 성적 보기, 강의계획서 보기, 강의 틀어줘",
  chat: "대화로 답하면 되는 요청: 질문, 설명, 잡담, 공부 조언, 공지나 일정 요약, 앱 사용법",
  write: "학교에 무언가를 바꾸는 요청: 과제 제출, 파일 업로드, 게시글·댓글 쓰기, 출석이나 시청 기록 바꾸기, 수강 신청·취소",
};

const TOPICS: Record<Topic, string> = {
  deadlines: "마감, 과제, 시험, 일정",
  lectures: "녹화 강의, 출석, 온라인 강의",
  notices: "공지, 알림",
  files: "강의자료, 파일, 슬라이드",
  grades: "성적, 점수",
  syllabus: "강의계획서",
  course_home: "과목 첫 화면, 과목 정보",
  courses: "과목 목록, 이번 학기 수업",
  none: "위 어느 것도 아님",
};

const RANGES: Record<Range, string> = {
  today: "오늘",
  tomorrow: "내일",
  week: "이번 주나 앞으로 7일, 기간을 말하지 않음",
  nextweek: "다음 주",
  month: "이번 달, 한 달",
};

const NO_COURSE = "__none__";

const isKind = (v: unknown): v is Kind => typeof v === "string" && v in KINDS;
const isTopic = (v: unknown): v is Topic => typeof v === "string" && v in TOPICS;
const isRange = (v: unknown): v is Range => typeof v === "string" && v in RANGES;

export function jevRequest(text: string, courses: string[]): Record<string, unknown> {
  const courseCriteria: Record<string, string> = Object.fromEntries(courses.map((c) => [c, `과목 '${c}'`]));
  courseCriteria[NO_COURSE] = "특정 과목을 말하지 않음";
  return {
    model: "jev-latest",
    state: { 학생_문장: text, 이번_학기_과목: courses },
    questions: {
      kind: { type: "choice", instructions: "학생 문장은 어떤 요청인가?", criteria: KINDS },
      topic: { type: "choice", instructions: "학생 문장이 다루는 LMS 대상은 무엇인가?", criteria: TOPICS },
      course: { type: "choice", instructions: "학생 문장이 가리키는 과목은 무엇인가? 줄임말도 그 과목으로 본다.", criteria: courseCriteria },
      range: { type: "choice", instructions: "학생 문장이 말하는 기간은?", criteria: RANGES },
      only_new: { type: "noul", instructions: "학생이 새로 올라온 것이나 최근 것만 원하는가?" },
    },
  };
}

type Answer = { choice?: unknown; confidence?: unknown; noul?: unknown };

export function parseJev(body: unknown, courses: string[]): Route | null {
  const answers = (body as { answers?: Record<string, Answer> } | null)?.answers;
  if (!answers) return null;
  const kind = answers.kind?.choice;
  if (!isKind(kind)) return null;
  const topic = answers.topic?.choice;
  const course = answers.course?.choice;
  const range = answers.range?.choice;
  return {
    kind,
    confidence: typeof answers.kind?.confidence === "number" ? answers.kind.confidence : 0,
    topic: isTopic(topic) ? topic : "none",
    course: typeof course === "string" && courses.includes(course) ? course : undefined,
    range: isRange(range) ? range : "week",
    onlyNew: typeof answers.only_new?.noul === "number" && answers.only_new.noul >= 0.5,
  };
}

export const ROUTE_PROMPT = `너는 고려대 LMS 앱의 요청 분류기야. 학생 문장을 아래 JSON 하나로만 바꿔. 설명, 코드 블록, 다른 글자는 쓰지 마.
{"kind":"command|path|chat|write","topic":"deadlines|lectures|notices|files|grades|syllabus|course_home|courses|none","course":"과목 이름 또는 null","range":"today|tomorrow|week|nextweek|month","onlyNew":true|false,"confidence":0~1}
kind:
${Object.entries(KINDS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}
topic:
${Object.entries(TOPICS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}
range는 기간을 말하지 않으면 week야. course에는 아래 과목 이름 중 하나를 그대로 쓰고, 줄임말도 그 과목으로 봐.`;

export function routeUserPrompt(text: string, courses: string[]): string {
  return `과목: ${courses.join(", ") || "(없음)"}\n문장: ${text}`;
}

export function parseLlmRoute(raw: string, courses: string[]): Route | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!isKind(d.kind)) return null;
  return {
    kind: d.kind,
    confidence: typeof d.confidence === "number" ? Math.max(0, Math.min(1, d.confidence)) : 0.5,
    topic: isTopic(d.topic) ? d.topic : "none",
    course: typeof d.course === "string" && courses.includes(d.course) ? d.course : undefined,
    range: isRange(d.range) ? d.range : "week",
    onlyNew: d.onlyNew === true,
  };
}

/** The read command a `command` route runs; null when the topic has no read command (grades, syllabus open the page instead). */
export function commandOf(route: Route): ReadCommand | null {
  const course = route.course;
  switch (route.topic) {
    case "deadlines":
      return { command: "deadlines", range: route.range, course };
    case "lectures":
      return { command: "lectures", course };
    case "notices":
      return { command: "notices", course };
    case "files":
      return { command: "files", course, onlyNew: route.onlyNew };
    case "course_home":
      return course ? { command: "course", course } : { command: "courses" };
    case "courses":
      return { command: "courses" };
    case "grades":
    case "syllabus":
    case "none":
      return null;
  }
}

/** The Canvas page a `path` route opens, for one course or for the whole LMS. */
export function pageUrl(origin: string, topic: Topic, courseId: string | undefined, attendanceToolId: string | number): string {
  if (!courseId) {
    if (topic === "grades") return `${origin}/grades`;
    if (topic === "deadlines") return `${origin}/calendar`;
    return `${origin}/`;
  }
  const base = `${origin}/courses/${courseId}`;
  switch (topic) {
    case "deadlines":
      return `${base}/assignments`;
    case "lectures":
      return `${base}/external_tools/${attendanceToolId}`;
    case "notices":
      return `${base}/announcements`;
    case "files":
      return `${base}/files`;
    case "grades":
      return `${base}/grades`;
    case "syllabus":
      return `${base}/assignments/syllabus`;
    case "course_home":
    case "courses":
    case "none":
      return base;
  }
}

export const CLARIFY_PROMPT = `너는 고려대 LMS 앱의 도우미야. 학생 문장이 무엇을 원하는지 애매해. 무엇을 원하는지 되묻는 한국어 한 문장만 써. 선택지가 있으면 두세 개를 문장 안에 넣어.`;

export const CHAT_PROMPT = `너는 고려대 LMS 앱 KUrowser의 도우미야. 아래 학생의 LMS 정보만 근거로 한국어로 짧게(세 문장 이내) 답해.
정보에 없는 날짜, 과목, 내용은 지어내지 마. 모르면 모른다고 하고 학교 화면에서 확인하라고 해.
과제 제출, 출석, 글쓰기처럼 학교에 무언가를 바꾸는 일은 앱이 하지 않아. 그런 부탁에는 학교 화면에서 직접 하라고 안내해.`;

export function chatUserPrompt(text: string, context: string): string {
  return `학생 LMS 정보:\n${context || "(없음)"}\n\n학생: ${text}`;
}
