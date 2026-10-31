import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatReply, ReadCommand } from "../../shared/types";
import { outcomeFor, parseRules, portalOutcome, recordingsOutcome, scheduleOutcome, type Outcome, type Parsed } from "../commands";
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
  | { id: number; from: "app"; kind: "result"; outcome: Outcome };
type Draft = Message extends infer M ? (M extends Message ? Omit<M, "id"> : never) : never;

const AI_FAILED = "AI에 묻지 못했어요";

function fromReply(reply: ChatReply, outcome: (command: ReadCommand) => Outcome): Draft {
  switch (reply.kind) {
    case "command":
      return { from: "app", kind: "result", outcome: outcome(reply.command) };
    case "refused":
      return { from: "app", kind: "text", text: reply.text, tone: "quiet" };
    case "opened":
    case "answer":
    case "clarify":
    case "error":
      return { from: "app", kind: "text", text: reply.text, tone: "plain" };
  }
}

function Bubble({ message, onRun }: { message: Message; onRun: (text: string) => void }) {
  if (message.from === "user") {
    return (
      <li className="msg msg-user">
        <p className="bubble bubble-user">{message.text}</p>
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
  const queued = useRef<string[]>([]);

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
    if (rules.kind === "theme" || rules.kind === "navigate" || rules.kind === "menu" || rules.kind === "menus") return false;
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
    const text = queued.current[0];
    if (!text || busy) return;
    if (waiting(parseRules(text, store.data, store.sites))) return;
    queued.current = queued.current.slice(1);
    void send(text, false);
  });

  const send = async (text: string, echo = true) => {
    if (busy) return;
    if (echo) push({ from: "user", text });
    const s = latest.current;
    const rules = parseRules(text, s.data, s.sites);
    if (waiting(rules)) {
      queued.current = [...queued.current, text];
      const site = rules.kind === "portal" || rules.kind === "schedule";
      const login = !site && (s.snapshot.phase === "login" || s.snapshot.phase === "keychain");
      push({ from: "app", kind: "text", text: login ? "학교 로그인이 끝나면 이어서 할게요" : "아직 불러오는 중이에요. 끝나면 이어서 할게요", tone: "plain" });
      return;
    }
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
    if (rules.command.command !== "unknown" || !s.settings?.aiConnected) {
      const outcome = outcomeFor(rules.command, s.data, snap, !!rules.start);
      if (outcome.kind === "download" && outcome.start) s.download(outcome.files);
      push({ from: "app", kind: "result", outcome });
      return;
    }
    setBusy(true);
    try {
      const reply = await api().chat(text);
      const now = latest.current;
      push(fromReply(reply, (command) => outcomeFor(command, now.data, { watched: now.watched, read: now.read, downloaded: now.downloaded })));
    } catch (error) {
      push({ from: "app", kind: "text", text: error instanceof Error && error.message ? error.message : AI_FAILED, tone: "plain" });
    } finally {
      setBusy(false);
    }
  };

  const run = (text: string) => void send(text);

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
            <Bubble key={m.id} message={m} onRun={run} />
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
        <CommandInput id="chat-input" label="한 문장으로 말하기" placeholder="예: 이번 주 마감 뭐 있어" busy={busy} autoFocus onRun={run} />
      </div>
    </section>
  );
}
