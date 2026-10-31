import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { outcomeFor, parseRules, type Outcome } from "../commands";
import { suggestionsFor } from "../data";
import { navigate } from "../router";
import { api, useStore } from "../store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * Runs a sentence. With the AI connected, the Gateway turns it into one read-only command (the
 * student pressed Enter, so the call may spend credit); suggestion chips and any AI failure fall
 * back to the local rules. Only a rule-matched "받아줘" starts downloads by itself.
 */
export function useRunner() {
  const store = useStore();
  const ref = useRef(store);
  ref.current = store;
  return useCallback(async (text: string): Promise<Outcome> => {
    const s = ref.current;
    const rules = parseRules(text, s.data);
    if (rules.kind === "theme") {
      s.setTheme(rules.theme);
      return { kind: "theme", title: rules.title, theme: rules.theme };
    }
    if (rules.kind === "navigate") {
      navigate(rules.route);
      s.showToast(rules.title);
      return { kind: "navigate", title: rules.title, route: rules.route };
    }
    let command = rules.command;
    let start = !!rules.start;
    if (s.settings?.aiConnected && !suggestionsFor(s.data).includes(text)) {
      const ai = await api().interpret(text);
      if (ai) {
        command = ai.command;
        start = false;
      }
    }
    const snap = { watched: s.watched, read: s.read, downloaded: s.downloaded };
    const result = outcomeFor(command, s.data, snap, start);
    if (result.kind === "download" && result.start) s.download(result.files);
    return result;
  }, []);
}

export function CommandInput({
  id,
  label,
  placeholder,
  size,
  shortcuts,
  autoFocus = false,
  onRun,
}: {
  id: string;
  label: string;
  placeholder: string;
  size: "lg" | "sm";
  shortcuts: boolean;
  autoFocus?: boolean;
  onRun: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = query.trim();
    if (text) onRun(text);
  };

  return (
    <form className={`command-form command-${size}`} role="search" onSubmit={submit}>
      <Search className="command-icon" size={size === "lg" ? 20 : 16} aria-hidden="true" />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        className="command-input"
        type="text"
        autoComplete="off"
        autoFocus={autoFocus}
        enterKeyHint="go"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("");
            inputRef.current?.blur();
          }
        }}
      />
      {query ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="입력 지우기"
          title="입력 지우기"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : (
        shortcuts && (
          <kbd className="kbd" aria-hidden="true">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        )
      )}
    </form>
  );
}
