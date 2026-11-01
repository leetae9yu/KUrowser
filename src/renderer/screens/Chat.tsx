import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatIntent, ChatReply, SchoolMenu } from "../../shared/types";
import { libraryIn, loansOutcome, outcomeFor, parseRules, portalOutcome, recordingsOutcome, SCHEDULE_WORDS, scheduleOutcome, seatsOutcome, type Outcome, type Parsed } from "../commands";
import { AmsCard, type AmsTopic } from "../components/AmsCard";
import { CommandInput } from "../components/CommandInput";
import { ResultCard } from "../components/ResultCard";
import { suggestionsFor } from "../data";
import { navigate } from "../router";
import { api, useStore } from "../store";
import { Home } from "./Home";

type Tone = "plain" | "quiet" | "done";
type Message =
  | { id: number; from: "user"; text: string }
  | { id: number; from: "app"; kind: "text"; text: string; tone: Tone }
  | { id: number; from: "app"; kind: "result"; outcome: Outcome }
  | { id: number; from: "app"; kind: "ams"; topic: AmsTopic }
  | { id: number; from: "app"; kind: "choices"; text: string; options: Choice[] };
type Choice = Extract<ChatReply, { kind: "choices" }>["options"][number];
type Draft = Message extends infer M ? (M extends Message ? Omit<M, "id"> : never) : never;

const AI_FAILED = "AI에 묻지 못했어요";
const AMS_FRESH_MS = 30 * 60_000;
const FALLBACK_NOTE: Record<Extract<ChatReply, { kind: "fallback" }>["reason"], string | null> = {
  offline: null,
  credits: "이번 달 AI 크레딧이 모자라서 단어로 알아들었어요",
  failed: "AI에 묻지 못해서 단어로 알아들었어요",
};

/** An AI intent as the rules would have parsed it; a download it names waits for the student's click. */
function fromIntent(intent: ChatIntent, text: string, menus: SchoolMenu[]): Parsed {
  switch (intent.kind) {
    case "read":
      return { kind: "read", command: intent.command };
    case "schedule":
      return { kind: "schedule", word: SCHEDULE_WORDS.find((w) => text.replace(/\s+/g, "").includes(w)) };
    case "menu": {
      const menu = menus.find((m) => m.id === intent.id);
      return menu ? { kind: "menu", menu } : { kind: "menus" };
    }
    case "settings":
      return { kind: "navigate", route: { name: "settings" }, title: "설정을 열었어요" };
    case "seats":
      return { kind: "seats", library: intent.library ?? libraryIn(text) };
    default:
      return intent;
  }
}

function fromReply(reply: Exclude<ChatReply, { kind: "intent" | "fallback" }>): Draft {
  switch (reply.kind) {
    case "refused":
      return { from: "app", kind: "text", text: reply.text, tone: "quiet" };
    case "choices":
      return { from: "app", kind: "choices", text: reply.text, options: reply.options };
    case "opened":
    case "answer":
    case "clarify":
    case "error":
      return { from: "app", kind: "text", text: reply.text, tone: "plain" };
  }
}

function Bubble({ message, onRun, onPick }: { message: Message; onRun: (text: string) => void; onPick: (choice: Choice) => void }) {
  if (message.from === "app" && message.kind === "choices") {
    return (
      <li className="msg msg-app msg-choices">
        <p className="bubble bubble-app">{message.text}</p>
        <ul className="chips chips-reply" aria-label={message.text}>
          {message.options.map((o) => (
            <li key={o.label}>
              <button type="button" className="chip" onClick={() => onPick(o)}>
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      </li>
    );
  }
  if (message.from === "user") {
    return (
      <li className="msg msg-user">
        <p className="bubble bubble-user">{message.text}</p>
      </li>
    );
  }
  if (message.kind === "ams") {
    return (
      <li className="msg msg-app msg-card">
        <div className="card">
          <AmsCard topic={message.topic} />
        </div>
      </li>
    );
  }
  if (message.kind === "result") {
    return (
      <li className="msg msg-app msg-card">
        <div className="card">
          <ResultCard outcome={message.outcome} onRun={onRun} />
        </div>
      </li>
    );
  }
  if (message.tone === "done") {
    return (
      <li className="msg msg-app">
        <p className="bubble bubble-app bubble-done">
          <Check size={16} aria-hidden="true" />
          <span>{message.text}</span>
        </p>
      </li>
    );
  }
  return (
    <li className="msg msg-app">
      <p className={`bubble bubble-app${message.tone === "quiet" ? " bubble-quiet" : ""}`}>{message.text}</p>
    </li>
  );
}

/** Local rules answer first and the AI only gets sentences they cannot place; stays mounted behind Settings so a running batch keeps its place. */
export function Chat({ active }: { active: boolean }) {
  const store = useStore();
  const latest = useRef(store);
  latest.current = store;
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const asked = messages.some((m) => m.from === "user");
  const count = messages.length + (busy ? 1 : 0);
  const seen = useRef(0);
  /** Requests waiting for data; one made before any course loaded is read again from its text once they have. */
  const queued = useRef<Array<{ text: string; typed: boolean; rules: Parsed; blind: boolean }>>([]);

  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread || !active || count === 0) return;
    const arrived = count > seen.current;
    seen.current = count;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    thread.scrollTo({ top: thread.scrollHeight, behavior: arrived && !reduce ? "smooth" : "auto" });
  }, [count, active]);

  // A reply can grow after it lands (a result list, STT progress) and opening the school page resizes the column;
  // while the reader is at the bottom, stay there.
  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || !active) return;
    let pinned = true;
    const onScroll = () => {
      pinned = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    };
    const observer = new ResizeObserver(() => {
      if (pinned) thread.scrollTop = thread.scrollHeight;
    });
    observer.observe(thread);
    for (const child of Array.from(thread.children)) observer.observe(child);
    thread.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      thread.removeEventListener("scroll", onScroll);
    };
  }, [active, count]);

  const push = (draft: Draft) => {
    seq.current += 1;
    setMessages((prev) => [...prev, { ...draft, id: seq.current }]);
  };

  // Focus mode on the school page says the next step once, and checks the job off when the school shows it done.
  useEffect(
    () =>
      api().onFocus((e) =>
        push(e.kind === "done" ? { from: "app", kind: "text", text: `${e.text}. 학교 화면을 닫았어요`, tone: "done" } : { from: "app", kind: "text", text: e.text, tone: "plain" }),
      ),
    [],
  );

  // A request that needs data still loading waits for it instead of answering "none" from an empty list.
  const waiting = (rules: Parsed): boolean => {
    const snap = latest.current.snapshot;
    if (rules.kind === "theme" || rules.kind === "navigate" || rules.kind === "menu" || rules.kind === "menus" || rules.kind === "seats" || rules.kind === "ams") return false;
    if (rules.kind === "loans") {
      const library = latest.current.sites.library;
      return !library.fetchedAt && !library.error && library.data.signedIn;
    }
    if (rules.kind === "portal" || rules.kind === "schedule") {
      const portal = latest.current.sites.portal;
      return !portal.fetchedAt && !portal.error;
    }
    if (snap.phase === "error") return false;
    if (snap.phase !== "ready") return true;
    // A part shown from the last run answers at once; only a part that never loaded makes the request wait.
    const missing = (part: "lectures" | "files") => snap.pending.includes(part) && !snap.loaded.includes(part);
    if (rules.kind === "recordings") return missing("lectures");
    const c = rules.command.command;
    if (c === "lectures" || c === "deadlines") return missing("lectures");
    if (c === "files") return missing("files");
    return false;
  };

  useEffect(() => {
    const next = queued.current[0];
    if (!next || busy) return;
    if (next.blind ? !coursesKnown() : waiting(next.rules)) return;
    queued.current = queued.current.slice(1);
    void (next.blind ? send(next.text, next.typed, false) : perform(next.rules, next.text, next.typed));
  });

  const coursesKnown = (): boolean => {
    const s = latest.current;
    return s.data.courses.length > 0 || s.snapshot.phase === "ready" || s.snapshot.phase === "error";
  };

  const hold = (text: string, typed: boolean, rules: Parsed) => {
    const s = latest.current;
    queued.current = [...queued.current, { text, typed, rules, blind: !coursesKnown() }];
    const site = rules.kind === "portal" || rules.kind === "schedule" || rules.kind === "loans";
    const login = !site && (s.snapshot.phase === "login" || s.snapshot.phase === "keychain");
    push({ from: "app", kind: "text", text: login ? "학교 로그인이 끝나면 이어서 할게요" : "아직 불러오는 중이에요. 끝나면 이어서 할게요", tone: "plain" });
  };

  /**
   * A typed sentence goes to Jev first; chips, card buttons and course names are fixed commands and run at once
   * with the word rules. The rules also answer when the AI is not connected, out of credits, or its call failed.
   */
  const send = async (text: string, typed: boolean, echo = true) => {
    if (busy) return;
    if (echo) push({ from: "user", text });
    const s = latest.current;
    if (!typed || !s.settings?.aiConnected) return perform(parseRules(text, s.data, s.sites), text, typed);
    // Jev picks the course from the course list, so a sentence typed before any course loaded waits for it.
    if (!coursesKnown()) return hold(text, typed, parseRules(text, s.data, s.sites));
    setBusy(true);
    let reply: ChatReply;
    try {
      reply = await api().chat(text);
    } catch (error) {
      reply = { kind: "error", text: error instanceof Error && error.message ? error.message : AI_FAILED };
    } finally {
      setBusy(false);
    }
    const now = latest.current;
    if (reply.kind === "intent") return perform(fromIntent(reply.intent, text, now.sites.menus), text, false);
    if (reply.kind === "fallback") {
      const note = FALLBACK_NOTE[reply.reason];
      if (note) push({ from: "app", kind: "text", text: note, tone: "quiet" });
      return perform(parseRules(text, now.data, now.sites), text, false);
    }
    push(fromReply(reply));
  };

  /** `typed` stays true only for a sentence the AI has not read yet, so a re-read after loading may still ask it. */
  const perform = async (rules: Parsed, text: string, typed: boolean) => {
    const s = latest.current;
    if (waiting(rules)) return hold(text, typed, rules);
    if (rules.kind === "theme") {
      s.setTheme(rules.theme);
      push({ from: "app", kind: "text", text: rules.title, tone: "plain" });
      return;
    }
    if (rules.kind === "navigate") {
      navigate(rules.route);
      push({ from: "app", kind: "text", text: rules.title, tone: "plain" });
      return;
    }
    if (rules.kind === "recordings") {
      push({ from: "app", kind: "result", outcome: recordingsOutcome(s.data, rules.course) });
      return;
    }
    if (rules.kind === "portal") {
      push({ from: "app", kind: "result", outcome: portalOutcome(s.sites, s.read) });
      return;
    }
    if (rules.kind === "schedule") {
      push({ from: "app", kind: "result", outcome: scheduleOutcome(s.sites, rules.word) });
      return;
    }
    if (rules.kind === "ams") {
      push({ from: "app", kind: "ams", topic: rules.topic });
      // Data older than half an hour, or none yet, is read again (signing in with a mailed code if needed).
      const fresh = s.ams.phase === "ready" && !!s.ams.at && Date.now() - Date.parse(s.ams.at) < AMS_FRESH_MS;
      const busyAms = ["sending", "code", "verifying", "loading"].includes(s.ams.phase);
      if (!fresh && !busyAms) void api().amsStart();
      return;
    }
    if (rules.kind === "loans") {
      push({ from: "app", kind: "result", outcome: loansOutcome(s.sites) });
      return;
    }
    if (rules.kind === "seats") {
      setBusy(true);
      try {
        const seats = await api().seats();
        push({ from: "app", kind: "result", outcome: seatsOutcome(seats.rooms, rules.library, seats.error) });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (rules.kind === "menus") {
      push({ from: "app", kind: "result", outcome: { kind: "menus", title: "어느 학교 화면을 열까요?", items: s.sites.menus } });
      return;
    }
    if (rules.kind === "menu") {
      const opened = await api().openMenu(rules.menu.id);
      const ams = rules.menu.url.includes("ams.korea.ac.kr");
      push({
        from: "app",
        kind: "text",
        text: opened ? `왼쪽에 ${rules.menu.label} 화면을 열었어요${ams ? ". 학사시스템은 메일로 온 인증번호를 한 번 넣어야 해요" : ""}` : "그 화면을 열지 못했어요",
        tone: "plain",
      });
      return;
    }
    const snap = { watched: s.watched, read: s.read, downloaded: s.downloaded };
    const outcome = outcomeFor(rules.command, s.data, snap, !!rules.start);
    if (outcome.kind === "download" && outcome.start) s.download(outcome.files);
    push({ from: "app", kind: "result", outcome });
  };

  const run = (text: string) => void send(text, false);
  /** A step picked from the options asked back; the main process walks on from it (one more Jev call at most). */
  const choose = async (choice: Choice) => {
    if (busy) return;
    push({ from: "user", text: choice.label });
    setBusy(true);
    let reply: ChatReply;
    try {
      reply = await api().treeContinue(choice.state);
    } catch (error) {
      reply = { kind: "error", text: error instanceof Error && error.message ? error.message : AI_FAILED };
    } finally {
      setBusy(false);
    }
    if (reply.kind === "intent" || reply.kind === "fallback") return;
    push(fromReply(reply));
  };
  const ask = (text: string) => void send(text, true);

  return (
    <section className="chat" hidden={!active} aria-label="대화">
      <div className="thread" ref={threadRef} role="log" aria-live="polite">
        <ol className="messages">
          <li className="msg msg-app msg-card" aria-live="off">
            <div className="card">
              <Home active={active} />
            </div>
          </li>
          {messages.map((m) => (
            <Bubble key={m.id} message={m} onRun={run} onPick={choose} />
          ))}
          {busy && (
            <li className="msg msg-app">
              <p className="bubble bubble-app typing">
                <span className="sr-only">답을 준비하고 있어요</span>
                <span className="typing-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </p>
            </li>
          )}
        </ol>
      </div>
      <div className="composer">
        {!asked && (
          <>
            <p className="chips-label" id="chips-label">
              이렇게 말해 보세요
            </p>
            <ul className="chips" aria-labelledby="chips-label">
              {suggestionsFor(store.data).map((s) => (
                <li key={s}>
                  <button type="button" className="chip" disabled={busy} onClick={() => run(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        <CommandInput id="chat-input" label="한 문장으로 말하기" placeholder="예: 이번 주 마감 뭐 있어" busy={busy} autoFocus onRun={ask} />
        {store.settings?.aiConnected && store.settings.aiCredits !== null && (
          <p className="composer-note">고대 AI · 이번 달 남은 크레딧 {Math.floor(store.settings.aiCredits).toLocaleString("ko-KR")}</p>
        )}
      </div>
    </section>
  );
}
