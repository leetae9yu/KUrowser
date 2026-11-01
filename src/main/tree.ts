import type { TreeState } from "../shared/types.ts";
import { JEV_MODEL } from "./jev-guard.ts";
import { amsMenu } from "./portal.ts";
import { PORTAL_SCREENS } from "./portal-menus.ts";

/**
 * Opening a school page walks three steps: LMS course or portal, then the course or the portal group, then the
 * screen. The first two steps ride on the sentence's first Jev call; the screen is a second, one-question call.
 * Any step Jev is unsure of is asked back with that step's options.
 */
export const TREE_CONFIDENCE = 0.6;

export type Area = NonNullable<TreeState["area"]>;
export interface Screen {
  label: string;
  url: string;
}

const AREAS: Record<Area, string> = {
  lms: "LMS(Canvas) 과목 안의 화면: 강의계획서, 과목 성적, 공지, 과제, 주차학습, 출결, 게시판, 퀴즈",
  portal: "포털(KUPID)·학사시스템 화면: 휴학·복학, 장학, 등록금, 수강신청 조회, 졸업, 전과, 전체 성적, 교직, 학생상담 같은 학사·행정 메뉴",
};
const AREA_LABELS: Record<Area, string> = { lms: "LMS 과목 화면", portal: "포털 학사·행정 화면" };
const NONE = "__none__";

export const PORTAL_GROUPS: readonly string[] = [...new Set(PORTAL_SCREENS.map((s) => `${s.tab} > ${s.group}`))];

/** A portal screen's address for the school pane; academic-system menus go through its sign-in relay. */
export function portalUrl(url: string): string {
  const u = new URL(url);
  const menuId = u.hostname === "ams.korea.ac.kr" ? u.searchParams.get("menuId") : null;
  return menuId ? amsMenu(menuId) : url;
}

export function portalScreens(group: string): Screen[] {
  return PORTAL_SCREENS.filter((s) => `${s.tab} > ${s.group}` === group).map((s) => ({ label: s.label, url: portalUrl(s.url) }));
}

/** The tree questions added to the sentence's first Jev call. */
export function treeQuestions(): Record<string, unknown> {
  const groups: Record<string, string> = Object.fromEntries(PORTAL_GROUPS.map((g) => [g, `포털 메뉴 '${g}' (${portalScreens(g).map((s) => s.label).join(", ")})`]));
  groups[NONE] = "포털 메뉴가 아님";
  return {
    area: { type: "choice", instructions: "학생이 열어 달라는 화면은 어디에 있는가?", criteria: { ...AREAS, [NONE]: "학교 화면 열기가 아님" } },
    portal_group: { type: "choice", instructions: "포털 화면이라면 어느 메뉴 묶음인가?", criteria: groups },
  };
}

type Answer = { choice?: unknown; confidence?: unknown };
const conf = (a: Answer | undefined): number => (typeof a?.confidence === "number" ? a.confidence : 0);

/** The tree answers of the first call: a step is kept only when Jev is sure of it. */
export function readTree(answers: Record<string, Answer>, course: { name?: string; confidence: number }): Omit<TreeState, "text"> {
  const state: Omit<TreeState, "text"> = {};
  const area = answers.area?.choice;
  if ((area === "lms" || area === "portal") && conf(answers.area) >= TREE_CONFIDENCE) state.area = area;
  const group = answers.portal_group?.choice;
  if (state.area === "portal" && typeof group === "string" && PORTAL_GROUPS.includes(group) && conf(answers.portal_group) >= TREE_CONFIDENCE) state.group = group;
  if (state.area === "lms" && course.name && course.confidence >= TREE_CONFIDENCE) state.course = course.name;
  return state;
}

/** One step's options: what the student picks from when asked back, and what Jev picks from. */
export function stepOptions(state: TreeState, courses: string[], screens: Screen[] | null): { step: "area" | "course" | "group" | "screen"; labels: string[] } {
  if (!state.area) return { step: "area", labels: Object.values(AREA_LABELS) };
  if (state.area === "lms" && !state.course) return { step: "course", labels: courses };
  if (state.area === "portal" && !state.group) return { step: "group", labels: [...PORTAL_GROUPS] };
  return { step: "screen", labels: (screens ?? []).map((s) => s.label) };
}

/** The state after the student or Jev picks `label` at `step`; null when the label is not one of the options. */
export function pick(state: TreeState, step: "area" | "course" | "group" | "screen", label: string, labels: string[]): TreeState | null {
  if (!labels.includes(label)) return null;
  switch (step) {
    case "area":
      return { ...state, area: (Object.keys(AREA_LABELS) as Area[]).find((a) => AREA_LABELS[a] === label) };
    case "course":
      return { ...state, course: label };
    case "group":
      return { ...state, group: label };
    case "screen":
      return { ...state, screen: label };
  }
}

const STEP_QUESTIONS = {
  area: "학생이 열어 달라는 화면은 어디에 있는가?",
  course: "학생 문장이 가리키는 과목은? 줄임말도 그 과목으로 본다.",
  group: "학생이 열어 달라는 포털 화면은 어느 메뉴 묶음인가?",
  screen: "학생이 열어 달라는 화면은 이 중 무엇인가?",
} as const;

/** A one-question Jev call for one step; the options are numbered so any label text is a safe key. */
export function stepRequest(text: string, step: keyof typeof STEP_QUESTIONS, labels: string[]): Record<string, unknown> {
  const criteria: Record<string, string> = Object.fromEntries(labels.map((l, i) => [`o${i}`, l]));
  criteria[NONE] = "이 중에 없음";
  return { model: JEV_MODEL, state: { 학생_문장: text }, questions: { pick: { type: "choice", instructions: STEP_QUESTIONS[step], criteria } } };
}

export function readStep(body: unknown, labels: string[]): { label: string | null; confidence: number } {
  const answer = (body as { answers?: Record<string, Answer> } | null)?.answers?.pick;
  const choice = typeof answer?.choice === "string" ? answer.choice : "";
  const index = /^o\d+$/.test(choice) ? Number(choice.slice(1)) : -1;
  return { label: labels[index] ?? null, confidence: conf(answer) };
}

export function stepPrompt(step: "area" | "course" | "group" | "screen"): string {
  switch (step) {
    case "area":
      return "어느 쪽 화면을 열까요?";
    case "course":
      return "어느 과목 화면을 열까요?";
    case "group":
      return "포털의 어느 메뉴를 열까요?";
    case "screen":
      return "어느 화면을 열까요?";
  }
}
