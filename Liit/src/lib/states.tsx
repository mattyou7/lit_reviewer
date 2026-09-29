/**Shared loading/empty/error states in the LiiT visual language.*/

export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <span className="text-[12.5px] animate-pulse" style={{ color: 'var(--color-muted)' }}>{text}</span>
    </div>
  );
}

export function Err({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-[12.5px] mb-2" style={{ color: 'var(--color-rose)' }}>{message}</div>
        {onRetry && (
          <button onClick={onRetry} className="text-[11.5px] px-3 py-1.5 rounded transition-colors"
            style={{ color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-[13px] mb-1" style={{ color: 'var(--color-sub)' }}>{title}</div>
        {hint && <div className="text-[11.5px] mb-3" style={{ color: 'var(--color-muted)' }}>{hint}</div>}
        {action}
      </div>
    </div>
  );
}

export function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-[12px]">
      <span className="shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="text-right break-words" style={{ color: 'var(--color-sub)', fontFamily: mono ? 'var(--font-mono)' : undefined, fontSize: mono ? 11 : undefined }}>
        {value || 'Not available'}
      </span>
    </div>
  );
}

/**Backend extraction_status values (pipeline.py): pending | parsing |
 * chunking | complete | partial | error. Anything else renders raw.*/
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  parsing: "Parsing…",
  chunking: "Chunking…",
  complete: "Complete",
  partial: "Partial",
  error: "Error",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** True while the ingest pipeline is still running (worth polling).*/
export function statusActive(status: string): boolean {
  return status === "parsing" || status === "chunking";
}

export function StatusChip({ status }: { status: string }) {
  const active = statusActive(status);
  const tone =
    status === "complete" ? "var(--color-teal)"
    : status === "partial" ? "var(--color-amber)"
    : status === "error" ? "var(--color-rose)"
    : status === "pending" ? "var(--color-muted)"
    : "var(--color-lavender)";
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono ${active ? "animate-pulse" : ""}`}
      style={{ color: tone, border: `1px solid ${tone}` }}
    >
      {statusLabel(status)}
    </span>
  );
}

export function friendlyError(e: unknown, context: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/cannot reach|failed to fetch|networkerror/i.test(msg)) {
    return `${context} failed. Check your network connection and that the LiiT backend is running, then try again.`;
  }
  return `${context} failed: ${msg.slice(0, 220)}`;
}
