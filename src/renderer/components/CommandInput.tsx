import { Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { interpret, type Outcome } from "../commands";
import { navigate } from "../router";
import { useStore } from "../store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Runs a sentence: interprets it and performs the side effect the result names. */
export function useRunner() {
  const store = useStore();
  const ref = useRef(store);
  ref.current = store;
  return useCallback((text: string): Outcome => {
    const s = ref.current;
    const result = interpret(text, { watched: s.watched, read: s.read, downloaded: s.downloaded });
    if (result.kind === "download") s.download(result.files);
    if (result.kind === "theme") s.setTheme(result.theme);
    if (result.kind === "navigate") {
      navigate(result.route);
      s.showToast(result.title);
    }
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
