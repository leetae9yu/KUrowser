import type { Loan, PortalNotice, ReadCommand, ScheduleEntry, SchoolMenu, SeatRoom, SitesSnapshot } from "../shared/types";
import { shortCourseName, type Theme, type Assignment, type Course, type Data, type FileItem, type Lecture, type Notice, type Recording } from "./data";
import { addDays, today0, weekStart } from "./format";
import type { Route } from "./router";

export type Outcome =
  | { kind: "deadlines"; title: string; assignments: Assignment[]; lectures: Lecture[] }
  | { kind: "lectures"; title: string; items: Lecture[] }
  | { kind: "notices"; title: string; items: Notice[] }
  | { kind: "download"; title: string; files: FileItem[]; start: boolean; courseId?: string; onlyNew?: boolean }
  | { kind: "course"; title: string; course: Course }
  | { kind: "courses"; title: string }
  | { kind: "recordings"; title: string; items: Recording[]; courseId?: string }
  | { kind: "navigate"; title: string; route: Route }
  | { kind: "theme"; title: string; theme: Theme }
  | { kind: "portal"; title: string; items: PortalNotice[] }
  | { kind: "schedule"; title: string; items: ScheduleEntry[] }
  | { kind: "menus"; title: string; items: SchoolMenu[] }
  | { kind: "loans"; title: string; items: Loan[] }
  | { kind: "seats"; title: string; items: SeatRoom[] }
  | { kind: "unknown"; title: string };

export interface Snapshot {
  watched: Set<string>;
  read: Set<string>;
  downloaded: Set<string>;
}

export type Parsed =
  | { kind: "read"; command: ReadCommand; start?: boolean }
  | { kind: "recordings"; course?: string }
  | { kind: "theme"; theme: Theme; title: string }
  | { kind: "navigate"; route: Route; title: string }
  | { kind: "portal" }
  | { kind: "schedule"; word?: string }
  | { kind: "menu"; menu: SchoolMenu }
  | { kind: "menus" }
  | { kind: "loans" }
  | { kind: "seats"; library?: string }
  | { kind: "ams"; topic: "grades" | "timetable" | "credits" };

/** Words for each library in the seat service, matched without spaces. */
const LIBRARY_WORDS: readonly (readonly [string, string[]])[] = [
  ["중앙도서관", ["중앙도서관", "중도"]],
  ["중앙광장", ["중앙광장", "중광"]],
  ["백주년기념 학술정보관", ["백주년", "학술정보관", "백기"]],
  ["과학도서관", ["과학도서관", "과도"]],
  ["하나스퀘어", ["하나스퀘어", "하스"]],
  ["법학도서관", ["법학도서관", "법도"]],
];

const OPEN_WORDS = ["열어", "열기", "화면", "들어가", "바로가기", "가줘", "켜줘", "페이지"];
/** Calendar words a student asks the registrar's calendar about; the first match also filters the answer. */
const SCHEDULE_WORDS = ["중간고사", "기말고사", "수강신청", "수강정정", "수강포기", "개강", "종강", "방학", "휴학", "복학", "등록기간", "졸업", "전과", "이중전공", "복수전공", "공휴일"];

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

function findCourse(s: string, data: Data): Course | undefined {
  const bare = (name: string) => shortCourseName(name).toLowerCase().replace(/\s+/g, "");
  return data.courses.find((c) => c.aliases.some((a) => a && s.includes(a)) || (bare(c.name).length > 1 && s.includes(bare(c.name))));
}

function rangeOf(s: string): Extract<ReadCommand, { command: "deadlines" }>["range"] {
  if (has(s, "오늘")) return "today";
  if (has(s, "내일")) return "tomorrow";
  if (has(s, "다음주")) return "nextweek";
  if (has(s, "이번달", "한달")) return "month";
  return "week";
}

/** Words that name an LMS item; a sentence with one stays with the LMS rules even when it also names a calendar event. */
const LMS_WORDS = ["공지", "자료", "파일", "강의", "녹화", "인강", "과제", "숙제", "제출", "마감", "슬라이드"];

/** School-site sentences: a page to open on the left, the academic calendar, or the portal board. */
function parseSites(s: string, sites: SitesSnapshot | undefined, course: string | undefined): Parsed | null {
  const menu = sites?.menus.find((m) => m.words.some((w) => s.includes(w)));
  if (menu && has(s, ...OPEN_WORDS)) return { kind: "menu", menu };
  if (has(s, "학교메뉴", "학교바로가기", "학교사이트")) return { kind: "menus" };
  if (!has(s, ...LMS_WORDS)) {
    if (has(s, "이수학점", "취득학점", "몇학점", "학점요약", "졸업학점", "신청학점")) return { kind: "ams", topic: "credits" };
    if (has(s, "성적", "평점", "gpa", "학점")) return { kind: "ams", topic: "grades" };
    if (has(s, "시간표", "오늘수업", "내일수업", "수업시간", "강의실어디")) return { kind: "ams", topic: "timetable" };
  }
  const library = LIBRARY_WORDS.find(([, words]) => has(s, ...words))?.[0];
  if (has(s, "열람실", "좌석") || (has(s, "자리", "빈자리") && (library || has(s, "도서관")))) return { kind: "seats", library };
  if (has(s, "빌린책", "대출", "반납", "연체", "도서관책", "빌려온") && (!has(s, ...LMS_WORDS) || has(s, "도서관", "책"))) return { kind: "loans" };
  if (has(s, "학교공지", "포털", "학사공지", "전체공지", "학교소식", "kupid")) return { kind: "portal" };
  if (has(s, "학사일정", "학사력", "학사달력")) return { kind: "schedule", word: SCHEDULE_WORDS.find((w) => s.includes(w)) };
  const word = SCHEDULE_WORDS.find((w) => s.includes(w));
  if (word && !course && !has(s, ...LMS_WORDS)) return { kind: "schedule", word };
  return null;
}

export function parseRules(raw: string, data: Data, sites?: SitesSnapshot): Parsed {
  const s = raw.toLowerCase().replace(/\s+/g, "");
  const course = findCourse(s, data)?.name;

  if (has(s, "다크", "어둡", "어두운", "밤모드")) return { kind: "theme", theme: "dark", title: "어두운 화면으로 바꿨어요" };
  if (has(s, "라이트", "밝게", "밝은")) return { kind: "theme", theme: "light", title: "밝은 화면으로 바꿨어요" };
  const site = parseSites(s, sites, course);
  if (site) return site;
  if (has(s, "설정", "계정", "api", "로그아웃", "ai연결")) return { kind: "navigate", route: { name: "settings" }, title: "설정을 열었어요" };
  // "받아쓰기" contains "받아", so this sits before the download rule; lecture notes (강의안, 자료) stay files.
  if (has(s, "자막", "요약", "받아쓰기", "정리") && has(s, "강의", "녹화", "인강") && !has(s, "자료", "강의안", "슬라이드", "파일")) {
    return { kind: "recordings", course };
  }
  if (has(s, "받아", "다운", "저장해", "내려받")) return { kind: "read", command: { command: "files", course, onlyNew: has(s, "새", "최신", "이번주") }, start: true };
  if (has(s, "자료", "파일", "강의안", "슬라이드")) return { kind: "read", command: { command: "files", course, onlyNew: has(s, "새", "최신") } };
  if (has(s, "마감", "과제", "숙제", "할일", "해야", "제출", "due", "일정", "캘린더", "달력", "타임라인")) {
    return { kind: "read", command: { command: "deadlines", range: rangeOf(s), course, assignmentsOnly: has(s, "과제", "숙제", "제출") } };
  }
  if (has(s, "강의", "녹화", "인강", "영상")) return { kind: "read", command: { command: "lectures", course } };
  if (has(s, "공지", "알림", "새소식")) return { kind: "read", command: { command: "notices", course } };
  if (course) return { kind: "read", command: { command: "course", course } };
  if (has(s, "과목", "수업", "강좌")) return { kind: "read", command: { command: "courses" } };
  if (has(s, "오늘", "홈", "처음")) return { kind: "navigate", route: { name: "today" }, title: "할 일 화면을 열었어요" };
  return { kind: "read", command: { command: "unknown" } };
}

function rangeDates(range: Extract<ReadCommand, { command: "deadlines" }>["range"]): { from: Date; to: Date; label: string } {
  const now = new Date();
  switch (range) {
    case "today":
      return { from: now, to: addDays(today0, 1), label: "오늘" };
    case "tomorrow":
      return { from: addDays(today0, 1), to: addDays(today0, 2), label: "내일" };
    case "nextweek":
      return { from: weekStart(1), to: weekStart(2), label: "다음 주" };
    case "month":
      return { from: now, to: addDays(today0, 31), label: "앞으로 한 달" };
    case "week":
      return { from: now, to: addDays(today0, 8), label: "앞으로 7일" };
  }
}

/** The last Hangul syllable ends in a consonant (이/가 choice). */
const hasFinal = (word: string): boolean => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
};

const day = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Portal notices: the new ones, or the latest few when none is new. */
export function portalOutcome(sites: SitesSnapshot, read: Set<string>): Outcome {
  const all = sites.portal.data.notices;
  const unread = all.filter((n) => !n.read && !read.has(n.id));
  if (!all.length) return { kind: "portal", title: sites.portal.error ?? "학교 공지를 아직 못 가져왔어요", items: [] };
  return unread.length
    ? { kind: "portal", title: `새 학교 공지 ${unread.length}건이에요`, items: unread }
    : { kind: "portal", title: "새 학교 공지는 없어요. 최근 공지예요", items: all.slice(0, 5) };
}

/** Calendar lines that have not ended yet, soonest first; a calendar word narrows them to that event. */
export function scheduleOutcome(sites: SitesSnapshot, word?: string, today = new Date()): Outcome {
  const now = day(today);
  const upcoming = sites.portal.data.schedule.filter((e) => e.end >= now);
  if (word) {
    const hits = sites.portal.data.schedule.filter((e) => e.event.replace(/\s+/g, "").includes(word));
    const next = hits.filter((e) => e.end >= now);
    const items = next.length ? next : hits.slice(-1);
    return { kind: "schedule", title: items.length ? `${word} 일정이에요` : `이번 학기 학사 일정에 ${word}${hasFinal(word) ? "이" : "가"} 없어요`, items };
  }
  if (!sites.portal.data.schedule.length) return { kind: "schedule", title: sites.portal.error ?? "학사 일정을 아직 못 가져왔어요", items: [] };
  return { kind: "schedule", title: upcoming.length ? "다가오는 학사 일정이에요" : "이번 학기 학사 일정이 끝났어요", items: upcoming.slice(0, 6) };
}

const monthDay = (iso: string): string => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

/** Books out, soonest due first. */
export function loansOutcome(sites: SitesSnapshot): Outcome {
  const { loans, signedIn } = sites.library.data;
  if (!signedIn) return { kind: "loans", title: "도서관 로그인을 하지 못했어요. 도서관 대출 화면에서 확인해 주세요", items: [] };
  if (!sites.library.fetchedAt) return { kind: "loans", title: sites.library.error ?? "대출 목록을 아직 못 가져왔어요", items: [] };
  if (!loans.length) return { kind: "loans", title: "빌린 책이 없어요", items: [] };
  return { kind: "loans", title: `빌린 책 ${loans.length}권, 가장 가까운 반납일은 ${monthDay(loans[0]!.due)}이에요`, items: loans };
}

/** Reading rooms with the most free seats first, all libraries or one. */
export function seatsOutcome(rooms: SeatRoom[], library?: string, error?: string | null): Outcome {
  const items = rooms.filter((r) => !library || r.library === library).sort((a, b) => b.available - a.available);
  if (!items.length) return { kind: "seats", title: error ?? "열람실 좌석을 가져오지 못했어요", items };
  const free = items.reduce((sum, r) => sum + r.available, 0);
  return { kind: "seats", title: `${library ? `${library} ` : ""}열람실 빈자리 ${free}석이에요`, items };
}

/** Recorded lectures, newest week first, for the subtitles+summary card. */
export function recordingsOutcome(data: Data, courseName?: string): Outcome {
  const course = courseName ? data.courses.find((c) => c.name === courseName) : undefined;
  const scope = course ? `${course.name} ` : "";
  const items = data.recordings.filter((r) => !course || r.courseId === course.id).sort((a, b) => (b.week ?? -1) - (a.week ?? -1));
  return { kind: "recordings", title: items.length ? `${scope}녹화 강의 ${items.length}개예요` : `${scope}녹화 강의가 없어요`, items, courseId: course?.id };
}

export function outcomeFor(command: ReadCommand, data: Data, snap: Snapshot, start = false): Outcome {
  const course = "course" in command && command.course ? data.courses.find((c) => c.name === command.course) : undefined;
  const scope = course ? `${course.name} ` : "";
  const inCourse = (id: string) => !course || id === course.id;

  switch (command.command) {
    case "files": {
      let list = data.files.filter((f) => inCourse(f.courseId) && f.available && !snap.downloaded.has(f.id));
      if (command.onlyNew) list = list.filter((f) => f.isNew);
      const title = list.length
        ? start
          ? `${scope}자료 ${list.length}개를 받기 시작했어요`
          : `${scope}아직 안 받은 자료 ${list.length}개`
        : `${scope}새로 받을 자료가 없어요`;
      return { kind: "download", title, files: list, start, courseId: course?.id, onlyNew: command.onlyNew };
    }
    case "deadlines": {
      const range = rangeDates(command.range);
      const inRange = (d: Date) => d >= range.from && d < range.to;
      const due = data.assignments.filter((a) => !a.submitted && inCourse(a.courseId) && inRange(a.due)).sort((a, b) => a.due.getTime() - b.due.getTime());
      const lect = command.assignmentsOnly ? [] : data.lectures.filter((l) => inCourse(l.courseId) && !snap.watched.has(l.id) && l.until && inRange(l.until));
      const total = due.length + lect.length;
      return {
        kind: "deadlines",
        title: total ? `${range.label} ${scope}마감 ${total}개` : `${range.label} ${scope}마감이 없어요`,
        assignments: due,
        lectures: lect,
      };
    }
    case "lectures": {
      const items = data.lectures
        .filter((l) => inCourse(l.courseId) && !snap.watched.has(l.id))
        .sort((a, b) => (a.until?.getTime() ?? Infinity) - (b.until?.getTime() ?? Infinity));
      return { kind: "lectures", title: items.length ? `${scope}안 본 강의 ${items.length}개, 출석 기한이 가까운 순서예요` : `${scope}안 본 강의가 없어요`, items };
    }
    case "notices": {
      const scoped = data.notices.filter((n) => inCourse(n.courseId));
      const unread = scoped.filter((n) => !snap.read.has(n.id));
      const items = unread.length ? unread : scoped.slice(0, 3);
      return {
        kind: "notices",
        title: unread.length ? `${scope}새 공지 ${unread.length}건이에요` : scoped.length ? `${scope}새 공지는 없어요. 최근 공지예요` : `${scope}최근 공지가 없어요`,
        items,
      };
    }
    case "course":
      return course ? { kind: "course", title: course.name, course } : { kind: "unknown", title: "그 과목을 찾지 못했어요" };
    case "courses":
      return { kind: "courses", title: `이번 학기 과목 ${data.courses.length}개` };
    case "unknown":
      return { kind: "unknown", title: "아직 이 문장은 이해하지 못해요. 고대 AI를 연결하면 더 많은 문장을 알아들어요." };
  }
}
