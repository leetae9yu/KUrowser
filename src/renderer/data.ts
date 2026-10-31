import { at, minutesAgo } from "./format";

/* Every course, person, and item below is invented for this demo. */

export type CourseId = "ds" | "la" | "os" | "econ" | "write";

export interface Course {
  id: CourseId;
  name: string;
  prof: string;
  hue: 1 | 2 | 3 | 4 | 5;
  aliases: string[];
}

export interface Assignment {
  id: string;
  courseId: CourseId;
  title: string;
  due: Date;
  submitted: boolean;
}

export interface Lecture {
  id: string;
  courseId: CourseId;
  week: number;
  title: string;
  minutes: number;
  /** Last moment the view counts for attendance. */
  until: Date;
  watchedAtStart: boolean;
}

export interface Notice {
  id: string;
  courseId: CourseId;
  title: string;
  summary: string;
  body: string;
  postedAt: Date;
  readAtStart: boolean;
}

export interface FileItem {
  id: string;
  courseId: CourseId;
  name: string;
  sizeMB: number;
  week: number;
  postedAt: Date;
  isNew: boolean;
}

export const courses: Course[] = [
  { id: "ds", name: "자료구조", prof: "한서진", hue: 1, aliases: ["자료구조", "자구", "데이터구조"] },
  { id: "la", name: "선형대수", prof: "오민재", hue: 2, aliases: ["선형대수", "선대"] },
  { id: "os", name: "운영체제", prof: "윤가람", hue: 3, aliases: ["운영체제", "운체", "os"] },
  { id: "econ", name: "경제학원론", prof: "박도윤", hue: 4, aliases: ["경제학원론", "경제", "경원"] },
  { id: "write", name: "대학 글쓰기", prof: "서은채", hue: 5, aliases: ["대학글쓰기", "글쓰기", "대글"] },
];

export const courseById = Object.fromEntries(courses.map((c) => [c.id, c])) as Record<CourseId, Course>;

export const assignments: Assignment[] = [
  { id: "a1", courseId: "ds", title: "과제 3: 이진 탐색 트리 구현", due: at(0, 23, 59), submitted: false },
  { id: "a2", courseId: "la", title: "문제 세트 5: 고유값과 고유벡터", due: at(1, 18), submitted: false },
  { id: "a3", courseId: "os", title: "실습 4: CPU 스케줄러 시뮬레이션 보고서", due: at(3, 23, 59), submitted: false },
  { id: "a4", courseId: "econ", title: "중간 리포트: 수요곡선 사례 분석", due: at(5, 12), submitted: false },
  { id: "a5", courseId: "write", title: "논증문 초고", due: at(6, 23, 59), submitted: false },
  { id: "a6", courseId: "ds", title: "과제 4: 해시 테이블", due: at(12, 23, 59), submitted: false },
  { id: "a7", courseId: "la", title: "문제 세트 4: 행렬식", due: at(-3, 18), submitted: true },
  { id: "a8", courseId: "os", title: "실습 3: 프로세스와 스레드", due: at(-5, 23, 59), submitted: true },
];

export const lectures: Lecture[] = [
  { id: "l1", courseId: "econ", week: 8, title: "수요와 공급의 탄력성", minutes: 38, until: at(1, 23, 59), watchedAtStart: false },
  { id: "l2", courseId: "ds", week: 9, title: "트리 순회와 힙", minutes: 52, until: at(2, 23, 59), watchedAtStart: false },
  { id: "l3", courseId: "la", week: 9, title: "고유값 분해", minutes: 61, until: at(3, 23, 59), watchedAtStart: false },
  { id: "l4", courseId: "os", week: 9, title: "교착 상태와 회피", minutes: 47, until: at(4, 23, 59), watchedAtStart: false },
  { id: "l5", courseId: "ds", week: 8, title: "이진 탐색 트리", minutes: 55, until: at(-4, 23, 59), watchedAtStart: true },
  { id: "l6", courseId: "os", week: 8, title: "동기화와 세마포어", minutes: 50, until: at(-3, 23, 59), watchedAtStart: true },
  { id: "l7", courseId: "la", week: 8, title: "행렬식의 성질", minutes: 58, until: at(-4, 23, 59), watchedAtStart: true },
  { id: "l8", courseId: "write", week: 8, title: "반론과 재반론 쓰기", minutes: 35, until: at(-2, 23, 59), watchedAtStart: true },
  { id: "l9", courseId: "econ", week: 7, title: "시장 균형", minutes: 41, until: at(-9, 23, 59), watchedAtStart: true },
];

export const notices: Notice[] = [
  {
    id: "n1",
    courseId: "ds",
    title: "과제 3 채점 기준 안내",
    summary: "테스트 케이스 10개 공개, 부분 점수는 케이스당 10점",
    body: "과제 3은 공개된 테스트 케이스 10개로 채점합니다. 케이스 하나당 10점이며, 메모리 누수가 있으면 케이스마다 2점을 감점합니다. 늦은 제출은 하루에 10%씩 감점합니다.",
    postedAt: minutesAgo(95),
    readAtStart: false,
  },
  {
    id: "n2",
    courseId: "os",
    title: "다음 주 목요일 수업은 녹화강의로 대체",
    summary: "목요일 대면 수업 없음, 녹화강의 10주차로 대체",
    body: "다음 주 목요일 대면 수업은 없습니다. 같은 날 오전 9시에 10주차 녹화강의를 올립니다. 출석은 녹화강의 시청으로 인정합니다.",
    postedAt: minutesAgo(60 * 20),
    readAtStart: false,
  },
  {
    id: "n3",
    courseId: "econ",
    title: "중간고사 성적 공개와 이의신청 기간",
    summary: "성적은 성적 메뉴에서 확인, 이의신청은 수요일까지",
    body: "중간고사 성적을 공개했습니다. 성적 메뉴에서 확인할 수 있습니다. 이의신청은 다음 주 수요일 18시까지 조교 메일로 받습니다.",
    postedAt: minutesAgo(60 * 27),
    readAtStart: false,
  },
  {
    id: "n4",
    courseId: "write",
    title: "논증문 초고 분량 기준 변경",
    summary: "초고 분량을 A4 2쪽 이상으로 변경",
    body: "논증문 초고 분량을 A4 3쪽에서 2쪽 이상으로 바꿉니다. 참고문헌 쪽은 분량에 넣지 않습니다.",
    postedAt: minutesAgo(60 * 72),
    readAtStart: true,
  },
  {
    id: "n5",
    courseId: "la",
    title: "보강 일정 안내",
    summary: "보강은 다음 주 금요일 오후 3시, 같은 강의실",
    body: "휴강한 수업의 보강을 다음 주 금요일 오후 3시에 같은 강의실에서 합니다.",
    postedAt: minutesAgo(60 * 98),
    readAtStart: true,
  },
];

export const files: FileItem[] = [
  { id: "f1", courseId: "ds", name: "09_트리순회_슬라이드.pdf", sizeMB: 3.2, week: 9, postedAt: minutesAgo(130), isNew: true },
  { id: "f2", courseId: "ds", name: "09_예제코드.zip", sizeMB: 1.1, week: 9, postedAt: minutesAgo(128), isNew: true },
  { id: "f3", courseId: "la", name: "09_고유값_판서.pdf", sizeMB: 5.6, week: 9, postedAt: minutesAgo(60 * 6), isNew: true },
  { id: "f4", courseId: "os", name: "09_교착상태.pdf", sizeMB: 4.1, week: 9, postedAt: minutesAgo(60 * 9), isNew: true },
  { id: "f5", courseId: "os", name: "실습4_템플릿.zip", sizeMB: 0.8, week: 9, postedAt: minutesAgo(60 * 9), isNew: true },
  { id: "f6", courseId: "ds", name: "08_이진탐색트리_슬라이드.pdf", sizeMB: 2.8, week: 8, postedAt: minutesAgo(60 * 24 * 7), isNew: false },
  { id: "f7", courseId: "ds", name: "과제3_명세서.pdf", sizeMB: 0.4, week: 8, postedAt: minutesAgo(60 * 24 * 8), isNew: false },
  { id: "f8", courseId: "la", name: "08_행렬식_판서.pdf", sizeMB: 4.9, week: 8, postedAt: minutesAgo(60 * 24 * 7), isNew: false },
  { id: "f9", courseId: "os", name: "08_동기화.pdf", sizeMB: 3.7, week: 8, postedAt: minutesAgo(60 * 24 * 7), isNew: false },
  { id: "f10", courseId: "econ", name: "08_탄력성.pptx", sizeMB: 7.4, week: 8, postedAt: minutesAgo(60 * 24 * 5), isNew: false },
  { id: "f11", courseId: "write", name: "논증문_예시.docx", sizeMB: 0.2, week: 8, postedAt: minutesAgo(60 * 24 * 6), isNew: false },
];

export const suggestions = [
  "이번 주 마감 뭐 있어",
  "자료구조 자료 다 받아줘",
  "안 본 강의 몇 개야",
  "공지 요약해줘",
  "운영체제 열어줘",
  "과목 전체 보기",
];
