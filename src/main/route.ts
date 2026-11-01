import type { ChatIntent, ReadCommand, SchoolMenu } from "../shared/types.ts";

/** command: the app reads school data and shows it; path: open a school page; chat: answer in words; write: change something at school (refused). */
export type Kind = "command" | "path" | "chat" | "write";
export type Topic =
  | "deadlines"
  | "lectures"
  | "recordings"
  | "notices"
  | "files"
  | "grades"
  | "syllabus"
  | "course_home"
  | "courses"
  | "portal"
  | "calendar"
  | "library_loans"
  | "library_seats"
  | "ams_grades"
  | "ams_timetable"
  | "ams_credits"
  | "school_menu"
  | "settings"
  | "none";
export type Range = Extract<ReadCommand, { command: "deadlines" }>["range"];

export interface Route {
  kind: Kind;
  confidence: number;
  topic: Topic;
  /** Jev's confidence in the topic, when it gave one. */
  topicConfidence?: number;
  course?: string;
  range: Range;
  onlyNew: boolean;
  /** A `SCHOOL_MENUS` id for a school_menu topic. */
  menu?: string;
  /** A library name of the seat service. */
  library?: string;
}

const KINDS: Record<Kind, string> = {
  command:
    "앱이 학생 대신 학교 정보를 읽어 보여 주면 되는 요청: 마감·과제 일정, 안 본 강의, 녹화 강의 자막·요약, 과목 공지, 강의자료 목록이나 받기, 과목 정보, 학교 포털 공지, 학사 일정, 도서관 대출·열람실 빈자리, 학사시스템 성적·평점·시간표·이수 학점",
  path: "학교 사이트의 특정 화면을 열어 달라는 요청: '~ 열어줘', '~ 페이지 가줘', '~ 화면 띄워줘', 강의계획서 보기, 강의 틀어줘, 수강신청·포털·도서관 사이트 열기",
  chat: "학교 정보를 새로 읽지 않고 말로 답하면 되는 요청: 질문, 설명, 잡담, 공부 조언, 과목 공지 요약, 앱 사용법",
  write: "학교에 무언가를 바꾸는 요청: 과제 제출, 파일 업로드, 게시글·댓글 쓰기, 출석이나 시청 기록 바꾸기, 수강 신청·취소, 도서 연장·예약, 좌석 예약",
};

const TOPICS: Record<Topic, string> = {
  deadlines: "LMS 마감, 과제, 퀴즈, 할 일",
  lectures: "안 본 온라인 강의, 출석 인정 기한, 강의 틀기",
  recordings: "녹화 강의의 자막, 받아쓰기, 강의 내용 요약",
  notices: "LMS 과목 공지, 과목 알림",
  files: "강의자료, 파일, 슬라이드, 자료 받기",
  grades: "LMS 과목 안의 과제·시험 점수",
  syllabus: "강의계획서",
  course_home: "한 과목의 첫 화면, 과목 정보",
  courses: "이번 학기 과목 목록",
  portal: "학교 포털(KUPID)의 학교 전체 공지",
  calendar: "학사 일정: 개강, 종강, 중간·기말고사 기간, 수강신청·정정 기간, 방학, 휴학·복학 기간",
  library_loans: "도서관에서 빌린 책, 반납일, 연체",
  library_seats: "도서관 열람실 빈자리, 좌석",
  ams_grades: "학사시스템 성적: 학기 성적, 평점(GPA), 전체 성적",
  ams_timetable: "내 시간표, 수업 시간, 강의실 위치",
  ams_credits: "이수 학점 현황: 취득 학점, 신청 학점, 졸업까지 남은 학점, 이수구분별 학점",
  school_menu: "학교 사이트 메뉴 화면 열기: 수강신청, 수강 내역, 포털, 성적 조회, 시간표, 학사 일정, 도서관 대출, 열람실 좌석",
  settings: "이 앱의 설정, 계정, 로그아웃, AI 연결, 화면 밝기(다크 모드)",
  none: "위 어느 것도 아님",
};

/** Libraries of the seat service, as `SeatRoom.library` names them. */
export const LIBRARIES = ["중앙도서관", "중앙광장", "백주년기념 학술정보관", "과학도서관", "하나스퀘어", "법학도서관"] as const;

const RANGES: Record<Range, string> = {
  today: "오늘",
  tomorrow: "내일",
  week: "이번 주나 앞으로 7일, 기간을 말하지 않음",
  nextweek: "다음 주",
  month: "이번 달, 한 달",
};

const NO_COURSE = "__none__";
const NONE = "__none__";

const isKind = (v: unknown): v is Kind => typeof v === "string" && v in KINDS;
const isTopic = (v: unknown): v is Topic => typeof v === "string" && v in TOPICS;
const isRange = (v: unknown): v is Range => typeof v === "string" && v in RANGES;

export function jevRequest(text: string, courses: string[], menus: readonly SchoolMenu[] = []): Record<string, unknown> {
  const courseCriteria: Record<string, string> = Object.fromEntries(courses.map((c) => [c, `과목 '${c}'`]));
  courseCriteria[NO_COURSE] = "특정 과목을 말하지 않음";
  const menuCriteria: Record<string, string> = Object.fromEntries(menus.map((m) => [m.id, `학교 화면 '${m.label}'`]));
  menuCriteria[NONE] = "특정 학교 화면을 말하지 않음";
  const libraryCriteria: Record<string, string> = Object.fromEntries(LIBRARIES.map((l) => [l, l]));
  libraryCriteria[NONE] = "특정 도서관을 말하지 않음";
  return {
    model: "jev-latest",
    state: { 학생_문장: text, 이번_학기_과목: courses },
    questions: {
      kind: { type: "choice", instructions: "학생 문장은 어떤 요청인가?", criteria: KINDS },
      topic: { type: "choice", instructions: "학생 문장이 다루는 대상은 무엇인가?", criteria: TOPICS },
      course: { type: "choice", instructions: "학생 문장이 가리키는 과목은 무엇인가? 줄임말도 그 과목으로 본다.", criteria: courseCriteria },
      range: { type: "choice", instructions: "학생 문장이 말하는 기간은?", criteria: RANGES },
      only_new: { type: "noul", instructions: "학생이 새로 올라온 것이나 최근 것만 원하는가?" },
      menu: { type: "choice", instructions: "학생이 열어 달라는 학교 화면은 무엇인가?", criteria: menuCriteria },
      library: { type: "choice", instructions: "학생 문장이 가리키는 도서관은? 줄임말(중도, 과도 등)도 그 도서관으로 본다.", criteria: libraryCriteria },
    },
  };
}

type Answer = { choice?: unknown; confidence?: unknown; noul?: unknown };

export function parseJev(body: unknown, courses: string[], menus: readonly SchoolMenu[] = []): Route | null {
  const answers = (body as { answers?: Record<string, Answer> } | null)?.answers;
  if (!answers) return null;
  const kind = answers.kind?.choice;
  if (!isKind(kind)) return null;
  const topic = answers.topic?.choice;
  const course = answers.course?.choice;
  const range = answers.range?.choice;
  const menu = answers.menu?.choice;
  const library = answers.library?.choice;
  const route: Route = {
    kind,
    confidence: typeof answers.kind?.confidence === "number" ? answers.kind.confidence : 0,
    topic: isTopic(topic) ? topic : "none",
    course: typeof course === "string" && courses.includes(course) ? course : undefined,
    range: isRange(range) ? range : "week",
    onlyNew: typeof answers.only_new?.noul === "number" && answers.only_new.noul >= 0.5,
  };
  if (typeof answers.topic?.confidence === "number") route.topicConfidence = answers.topic.confidence;
  if (typeof menu === "string" && menus.some((m) => m.id === menu)) route.menu = menu;
  if (typeof library === "string" && (LIBRARIES as readonly string[]).includes(library)) route.library = library;
  return route;
}

/**
 * Whether to ask back instead of acting. A write is refused only on a sure read; a read or a page request goes ahead
 * when either the kind or the topic is sure, since both stay read-only. Conversation is answered as is.
 */
export function unsure(route: Route, threshold: number): boolean {
  if (route.kind === "chat") return false;
  if (route.kind === "write") return route.confidence < threshold;
  return Math.max(route.confidence, route.topicConfidence ?? 0) < threshold;
}

/** Topics whose data the chat model never sees; a question about them is answered by reading the data instead. */
const READ_ONLY_TOPICS: ReadonlySet<Topic> = new Set(["portal", "calendar", "library_loans", "library_seats", "ams_grades", "ams_timetable", "ams_credits", "recordings"]);

/** The school menu that shows a topic's data, for a request to open its page. */
const TOPIC_MENU: Partial<Record<Topic, string>> = {
  portal: "portal",
  calendar: "calendar",
  library_loans: "loans",
  library_seats: "seats",
  ams_grades: "grades",
  ams_credits: "grades",
  ams_timetable: "timetable",
};

/**
 * What the app does with a classified sentence: an intent the chat runs with the same code as a chip, a Canvas page
 * to open (`open`), or null when the topic is unclear and the student should be asked again.
 */
export function intentOf(route: Route): { intent: ChatIntent } | { open: Topic } | null {
  const kind = route.kind === "chat" && READ_ONLY_TOPICS.has(route.topic) ? "command" : route.kind;
  if (kind === "path") {
    if (route.topic === "school_menu") return { intent: route.menu ? { kind: "menu", id: route.menu } : { kind: "menus" } };
    const menu = TOPIC_MENU[route.topic];
    if (menu) return { intent: { kind: "menu", id: menu } };
    if (route.topic === "settings") return { intent: { kind: "settings" } };
    if (route.topic === "recordings") return { intent: { kind: "recordings", course: route.course } };
    if (route.topic === "none" && !route.course) return null;
    return { open: route.topic };
  }
  if (kind !== "command") return null;
  switch (route.topic) {
    case "recordings":
      return { intent: { kind: "recordings", course: route.course } };
    case "portal":
      return { intent: { kind: "portal" } };
    case "calendar":
      return { intent: { kind: "schedule" } };
    case "library_loans":
      return { intent: { kind: "loans" } };
    case "library_seats":
      return { intent: { kind: "seats", library: route.library } };
    case "ams_grades":
      return { intent: { kind: "ams", topic: "grades" } };
    case "ams_timetable":
      return { intent: { kind: "ams", topic: "timetable" } };
    case "ams_credits":
      return { intent: { kind: "ams", topic: "credits" } };
    case "school_menu":
      return { intent: route.menu ? { kind: "menu", id: route.menu } : { kind: "menus" } };
    case "settings":
      return { intent: { kind: "settings" } };
    case "grades":
    case "syllabus":
      return { open: route.topic };
    default: {
      const command = commandOf(route);
      if (command) return { intent: { kind: "read", command } };
      return route.course ? { open: "course_home" } : null;
    }
  }
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
    default:
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
    default:
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
