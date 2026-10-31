import { useStore } from "../store";

export function Toast() {
  const { toast } = useStore();
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="toast" key={toast.id}>
          {toast.text}
          {toast.note && <span className="toast-note">{toast.note}</span>}
        </div>
      )}
    </div>
  );
}
