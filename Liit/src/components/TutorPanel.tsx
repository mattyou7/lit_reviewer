/**Contextual learning panel (beta): a compact layer over the paper the
 * researcher is reading — not a chatbot. The selected passage stays
 * visible verbatim beside the explanation, clearly distinguished from it;
 * provenance (section/subsection/page/evidence id) and the paper title
 * keep the source context in view. One general explanation mode (the
 * only one the backend supports), close/retry/explain-again, no chat
 * history, nothing persisted. The request fires only when this panel
 * opens — never on paper load, upload, parsing, extraction, synthesis,
 * or discovery.*/
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { TutorExplain } from '../lib/api';

/**Everything the panel sends: the verbatim selection plus bounded
 * context and location metadata from the paper currently open.*/
export interface TutorRequestCtx {
  text: string;
  context?: string;
  section?: string;
  subsection?: string;
  page?: number | null;
  evidenceId?: string;
}

interface Props {
  paperId: string;
  paperTitle: string;
  req: TutorRequestCtx;
  onClose: () => void;
}

export default function TutorPanel({ paperId, paperTitle, req, onClose }: Props) {
  const [res, setRes] = useState<TutorExplain | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const ask = async () => {
    setBusy(true);
    setError(null);
    setRes(null);
    try {
      const r = await api.explain({
        paper_id: paperId,
        text: req.text,
        context: req.context ?? '',
        section: req.section ?? '',
        subsection: req.subsection ?? '',
        page: req.page ?? null,
        evidence_id: req.evidenceId ?? '',
      });
      setRes(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Exactly one run per panel open (React StrictMode invokes effects twice).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void ask();
  }, []);

  // Escape returns to the paper without losing the selection state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const prov = [
    req.section ? (req.subsection ? `${req.section} → ${req.subsection}` : req.section) : '',
    req.page != null ? `p. ${req.page}` : '',
    req.evidenceId ? `evidence ${req.evidenceId}` : '',
  ].filter(Boolean).join(' · ');

  const failed = Boolean(error) || res?.status === 'unavailable' || res?.status === 'error';
  const showExplanation = res !== null && res.status !== 'error' && res.status !== 'unavailable'
    && res.explanation !== '';

  return (
    <div
      data-tutor-panel
      className="fixed right-5 top-[96px] z-40 w-[400px] max-h-[74vh] overflow-y-auto rounded p-4"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-lavender)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
      }}>
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-lavender)' }}>Learning</div>
          <div data-tutor-paper className="text-[11px] truncate" title={paperTitle} style={{ color: 'var(--color-muted)' }}>{paperTitle}</div>
        </div>
        <button
          data-tutor-close onClick={onClose} aria-label="Close learning panel"
          className="shrink-0 text-[13px] leading-none px-1.5 py-0.5 rounded"
          style={{ color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}>
          ✕
        </button>
      </div>

      {/* The researcher's material — verbatim, quotation-styled. */}
      <div className="mb-3">
        <div className="text-[9.5px] uppercase tracking-wider font-mono mb-1" style={{ color: 'var(--color-muted)' }}>Selected text</div>
        <p
          data-tutor-selected
          className="text-[12.5px] leading-relaxed pl-2.5 selectable-text"
          style={{
            fontFamily: 'var(--font-serif)', color: 'var(--color-ink)',
            borderLeft: '2px solid var(--color-lavender)', background: 'var(--color-lav-dim)',
          }}>
          {req.text}
        </p>
        {prov && (
          <div data-tutor-prov className="text-[10px] font-mono mt-1" style={{ color: 'var(--color-muted)' }}>{prov}</div>
        )}
      </div>

      {busy && (
        <div data-tutor-busy className="text-[12.5px] animate-pulse mb-2" style={{ color: 'var(--color-lav-light)' }}>
          Explaining…
        </div>
      )}

      {!busy && error !== null && (
        <div data-tutor-error className="mb-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-rose)' }}>
          {error}
        </div>
      )}

      {!busy && error === null && res !== null && res.status === 'unavailable' && (
        <div className="mb-2">
          <div data-tutor-unavailable className="text-[12.5px] mb-0.5" style={{ color: 'var(--color-rose)' }}>
            Learning is currently unavailable.
          </div>
          <div data-tutor-error className="text-[11.5px] leading-relaxed" style={{ color: 'var(--color-amber)' }}>
            {res.error}
          </div>
        </div>
      )}

      {!busy && error === null && res !== null && res.status === 'error' && (
        <div data-tutor-error className="mb-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-rose)' }}>
          {res.error || 'The explanation failed.'}
        </div>
      )}

      {!busy && error === null && res !== null && res.status === 'insufficient' && (
        <div
          data-tutor-insufficient
          className="mb-2 text-[11.5px] rounded px-2 py-1.5"
          style={{ color: 'var(--color-amber)', border: '1px solid var(--color-amber)' }}>
          The available text does not contain enough information to explain this.
        </div>
      )}

      {showExplanation && res !== null && (
        <div className="mb-2">
          <div className="text-[9.5px] uppercase tracking-wider font-mono mb-1" style={{ color: 'var(--color-muted)' }}>Explanation</div>
          <div
            data-tutor-explanation
            className="text-[12.5px] leading-relaxed rounded p-2"
            style={{ color: 'var(--color-sub)', background: 'var(--color-panel-alt)', border: '1px solid var(--color-edge)' }}>
            {res.explanation}
          </div>
          <div className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>
            Generated explanation — the selection above stays visible for reference.
          </div>
        </div>
      )}

      {res !== null && res.truncated && (
        <div className="text-[10.5px] mb-1" style={{ color: 'var(--color-amber)' }}>
          Selection shortened for the model.
        </div>
      )}

      {res !== null && !busy && (
        <div data-tutor-meta className="text-[10px] font-mono" style={{ color: 'var(--color-muted)' }}>
          model {res.model} · {res.duration_seconds}s
        </div>
      )}

      <div className="flex items-center gap-2.5 mt-3">
        {!busy && failed && (
          <button
            data-tutor-retry onClick={() => void ask()}
            className="text-[11.5px] px-2.5 py-1 rounded"
            style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
            Retry
          </button>
        )}
        {!busy && !failed && res !== null && (
          <button
            data-tutor-again onClick={() => void ask()}
            className="text-[11.5px] px-2.5 py-1 rounded"
            style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
            Explain again
          </button>
        )}
        <button
          data-tutor-close-foot onClick={onClose}
          className="text-[11.5px] px-2.5 py-1 rounded"
          style={{ color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}>
          Close
        </button>
      </div>
    </div>
  );
}
