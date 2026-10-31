import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The composer under the thread: Enter sends, ⌘K (Ctrl K) or "/" focuses it, Escape clears it. Focus stays here after a send. */
export function CommandInput({
  id,
  label,
  placeholder,
  busy = false,
  autoFocus = false,
  onRun,
}: {
  id: string;
  label: string;
  placeholder: string;
  busy?: boolean;
  autoFocus?: boolean;
  onRun: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
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
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = query.trim();
    if (!text || busy) return;
    setQuery("");
    onRun(text);
    inputRef.current?.focus();
  };

  return (
    <form className="command-form" onSubmit={submit}>
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
        enterKeyHint="send"
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
      <span className="command-tail">
        {query ? (
          <button type="submit" className="send-btn" aria-label="보내기" title="보내기 (Enter)" disabled={busy}>
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        ) : (
          <kbd className="kbd" aria-hidden="true">
            {isMac ? "⌘K" : "Ctrl K"}
          </kbd>
        )}
      </span>
    </form>
  );
}
