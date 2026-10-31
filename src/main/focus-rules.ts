/**
 * Focus mode rules: one row per school page the student finishes something on. The app only restyles the page
 * (hides menus, enlarges the body, rings the one button to press); it never clicks or submits. A rule whose
 * `ready` selector is missing leaves the page exactly as the school drew it.
 */
export interface FocusRule {
  id: string;
  /** Same task across the pages of one job (a quiz's intro and its taking page), so done counts only after a start. */
  task: string;
  host: RegExp;
  path: RegExp;
  /** Present only on the page this rule is for. */
  ready: string;
  hide: string[];
  /** CSS for the parts that stay, applied only while focus mode is on. */
  layout?: string;
  /** The first visible match is the button the student presses. */
  targets: string[];
  /** One line for the chat once the page is recognised (and its button found, when the rule has one). */
  hint?: string;
  /** Present once the job is finished; counts only after this pane saw the job still open. */
  done?: string;
  doneText?: string;
}

const CANVAS = /^(mylms|canvas)\.korea\.ac\.kr$/;
const CANVAS_CHROME = ["#header", "#left-side", ".ic-app-nav-toggle-and-crumbs", "#ku-chat-icon", ".ic-Layout-watermark", "#module_sequence_footer"];
const CANVAS_LAYOUT = [
  "#wrapper, #main, #not_right_side, .ic-Layout-columns { margin-left: 0 !important; padding-left: 0 !important; }",
  "#content { zoom: 1.1; padding: 24px 32px !important; max-width: 960px; margin: 0 auto !important; }",
].join("\n");

export const FOCUS_RULES: readonly FocusRule[] = [
  {
    id: "assignment",
    task: "assignment",
    host: CANVAS,
    path: /^\/courses\/\d+\/assignments\/\d+\/?$/,
    ready: "#assignment_show, .assignment_header",
    hide: CANVAS_CHROME,
    layout: CANVAS_LAYOUT,
    targets: ["#submit_assignment form:not([hidden]) button[type=submit]", "button.submit_assignment_link", "a.submit_assignment_link"],
    hint: "[과제 제출]을 누르고 파일을 올린 뒤, 아래 [과제 제출]을 한 번 더 누르면 끝나요",
    done: "#sidebar_content .details .header .icon-check",
    doneText: "과제 제출이 끝났어요",
  },
  {
    id: "quiz",
    task: "quiz",
    host: CANVAS,
    path: /^\/courses\/\d+\/quizzes\/\d+\/?$/,
    ready: "#quiz_show",
    hide: CANVAS_CHROME,
    layout: CANVAS_LAYOUT,
    targets: ["#take_quiz_link"],
    hint: "[퀴즈 응시]를 누르면 시작돼요. 시간 제한이 있으면 그때부터 시간이 가요",
    done: ".quiz-submission",
    doneText: "퀴즈 제출이 끝났어요",
  },
  {
    id: "quiz-take",
    task: "quiz",
    host: CANVAS,
    path: /^\/courses\/\d+\/quizzes\/\d+\/take\/?$/,
    ready: "#submit_quiz_form, #submit_quiz_button",
    hide: CANVAS_CHROME,
    layout: CANVAS_LAYOUT,
    targets: ["#submit_quiz_button"],
    hint: "다 풀고 맨 아래 [퀴즈 제출]을 누르면 끝나요",
  },
  {
    id: "quiz-history",
    task: "quiz",
    host: CANVAS,
    path: /^\/courses\/\d+\/quizzes\/\d+\/history\/?$/,
    ready: "#content",
    hide: CANVAS_CHROME,
    layout: CANVAS_LAYOUT,
    targets: [],
    done: "#content",
    doneText: "퀴즈 제출이 끝났어요",
  },
  {
    id: "notice",
    task: "notice",
    host: CANVAS,
    path: /^\/courses\/\d+\/(discussion_topics|announcements)\/\d+\/?$/,
    ready: "#discussion_topic",
    hide: [...CANVAS_CHROME, "#discussion-managebar", "#discussion-toolbar", "#right-side-wrapper"],
    layout: CANVAS_LAYOUT,
    targets: [],
  },
  {
    id: "lecture-tool",
    task: "lecture",
    host: CANVAS,
    path: /^\/courses\/\d+\/(modules\/items|external_tools)\/\d+\/?$/,
    ready: "iframe#tool_content",
    hide: CANVAS_CHROME,
    layout: [
      "#wrapper, #main, #not_right_side, .ic-Layout-columns { margin-left: 0 !important; padding-left: 0 !important; }",
      "#content { padding: 8px !important; }",
      "iframe#tool_content { min-height: calc(100vh - 32px) !important; }",
    ].join("\n"),
    targets: [],
  },
  {
    id: "portal-login",
    task: "portal",
    host: /^portal\.korea\.ac\.kr$/,
    path: /^\/(login\.jsp)?$/,
    ready: "button.btn_login",
    hide: [".notice_area", ".login_menu_area", ".chat_mascot"],
    targets: ["button.btn_login"],
    hint: "[로그인]을 누르고 포털 계정으로 들어가 주세요",
  },
  {
    id: "lecture-player",
    task: "lecture",
    host: /(^|\.)korea\.ac\.kr$/,
    path: /^\//,
    ready: ".vc-front-screen-play-btn, .vc-front-mixed-play-btn, .vc-front-multi-play-btn",
    hide: [],
    targets: [".vc-front-screen-play-btn", ".vc-front-mixed-play-btn", ".vc-front-multi-play-btn"],
    hint: "가운데 재생 버튼을 누르고 끝까지 보면 출석이 인정돼요",
  },
];

export function ruleFor(url: string, rules: readonly FocusRule[] = FOCUS_RULES): FocusRule | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  return rules.find((r) => r.host.test(u.hostname) && r.path.test(u.pathname)) ?? null;
}

const CRIMSON = "#a6192e";

export function focusCss(rule: FocusRule): string {
  const hide = rule.hide.length ? `${rule.hide.map((s) => `html.kur-focus ${s}`).join(",\n")} { display: none !important; }` : "";
  const layout = (rule.layout ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [selectors, body] = line.split(" {");
      return `${selectors!.split(",").map((s) => `html.kur-focus ${s.trim()}`).join(", ")} {${body}`;
    })
    .join("\n");
  return [
    hide,
    layout,
    `html.kur-focus .kur-focus-target { outline: 3px solid ${CRIMSON} !important; outline-offset: 3px !important; box-shadow: 0 0 0 8px rgba(166, 25, 46, 0.18) !important; }`,
    `#kur-focus-arrow { display: none; position: absolute; z-index: 2147483647; pointer-events: none; color: ${CRIMSON}; font: 700 28px/1 sans-serif; animation: kur-nudge 1s ease-in-out infinite alternate; }`,
    "html.kur-focus #kur-focus-arrow { display: block; }",
    "@keyframes kur-nudge { from { transform: translateX(-6px); } to { transform: translateX(0); } }",
    "@media (prefers-reduced-motion: reduce) { #kur-focus-arrow { animation: none; } }",
  ]
    .filter(Boolean)
    .join("\n");
}

export interface PageArgs {
  css: string;
  ready: string;
  targets: string[];
  done: string | null;
  on: boolean;
}

export interface PageResult {
  matched: boolean;
  target: boolean;
  done: boolean;
}

/**
 * Runs inside the school page, so it may only touch the page's DOM and must not reference anything outside itself.
 * It adds one style element, one class on <html>, one class on the target and an arrow; it never clicks.
 */
export function focusPage(p: PageArgs): Promise<PageResult> {
  const doc = document;
  if (!doc.querySelector(p.ready)) return Promise.resolve({ matched: false, target: false, done: false });
  let style = doc.getElementById("kur-focus-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "kur-focus-style";
    (doc.head || doc.documentElement).appendChild(style);
  }
  style.textContent = p.css;
  doc.documentElement.classList.toggle("kur-focus", p.on);
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const mark = (): Element | null => {
    let el: Element | null = null;
    for (const q of p.targets) {
      el = Array.from(doc.querySelectorAll(q)).find(visible) ?? null;
      if (el) break;
    }
    for (const old of Array.from(doc.querySelectorAll(".kur-focus-target"))) if (old !== el) old.classList.remove("kur-focus-target");
    let arrow = doc.getElementById("kur-focus-arrow");
    if (!el) {
      arrow?.remove();
      return null;
    }
    const fresh = !el.classList.contains("kur-focus-target");
    if (fresh) el.classList.add("kur-focus-target");
    if (!arrow) {
      arrow = doc.createElement("div");
      arrow.id = "kur-focus-arrow";
      arrow.setAttribute("aria-hidden", "true");
      arrow.textContent = "\u279C";
      doc.body.appendChild(arrow);
    }
    const r = el.getBoundingClientRect();
    const left = r.left + window.scrollX - 40;
    arrow.style.left = `${Math.max(window.scrollX + 4, left)}px`;
    arrow.style.top = `${r.top + window.scrollY + r.height / 2 - 14}px`;
    if (fresh && doc.documentElement.classList.contains("kur-focus")) el.scrollIntoView({ block: "center", behavior: "smooth" });
    return el;
  };
  const w = window as unknown as { __kurFocus?: boolean };
  if (!w.__kurFocus && doc.body) {
    w.__kurFocus = true;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        mark();
      });
    }).observe(doc.body, { childList: true, subtree: true });
    window.addEventListener("resize", () => mark());
  }
  const finish = (): PageResult => ({ matched: true, target: !!mark(), done: !!p.done && !!doc.querySelector(p.done) });
  if (!p.targets.length || mark()) return Promise.resolve(finish());
  // Canvas draws some buttons after load; give them a moment before answering without one.
  return new Promise((resolve) => {
    let tries = 0;
    const tick = (): void => {
      tries += 1;
      if (mark() || tries >= 8) resolve(finish());
      else setTimeout(tick, 250);
    };
    setTimeout(tick, 250);
  });
}

export function pageScript(rule: FocusRule, on: boolean): string {
  const args: PageArgs = { css: focusCss(rule), ready: rule.ready, targets: rule.targets, done: rule.done ?? null, on };
  return `(${focusPage.toString()})(${JSON.stringify(args)})`;
}

/** What one school pane remembers between pages: jobs seen still open, and lines already said. */
export interface FocusMemory {
  armed: Set<string>;
  hinted: Set<string>;
}

export function newMemory(): FocusMemory {
  return { armed: new Set(), hinted: new Set() };
}

/** Turns one page result into at most one chat line: the next step, or done once a started job finishes. */
export function judge(memory: FocusMemory, rule: FocusRule, url: string, res: PageResult): { hint?: string; done?: string } {
  if (!res.matched) return {};
  const path = url.split(/[?#]/)[0]!;
  // One job per item: /courses/1/quizzes/2, /courses/1/quizzes/2/take and .../history share the first five segments.
  const job = `${rule.task} ${new URL(path).pathname.split("/").slice(0, 5).join("/")}`;
  if (rule.done && res.done) {
    if (!memory.armed.delete(job)) return {};
    return { done: rule.doneText ?? "끝났어요" };
  }
  if (rule.targets.length && !res.target) return {};
  if (rule.targets.length) memory.armed.add(job);
  const key = `${rule.id} ${path}`;
  if (!rule.hint || memory.hinted.has(key)) return {};
  memory.hinted.add(key);
  return { hint: rule.hint };
}
