/**Library: real project papers + paper detail (overview with the analysis
pipeline, the Methods workspace, evidence, synthesis, references, full
text). The Code tab is an honest "Not available yet" placeholder; the
Learn tab points to the contextual tutor, which runs as a layer over Full
Text selections and Methods items (select → Explain / Learn).

Processing statuses shown are exactly the backend's values: the ingest
`extraction_status` (pending | parsing | chunking | complete | partial |
error), the evidence/synthesis rows returned by the API, and the
`paper_processing` embedding stage (pending | complete | error), plus
in-flight labels for requests the UI is waiting on. Nothing is invented.

Analysis actions map 1:1 to existing endpoints: process, extract,
synthesize, embed (+ project similarity, so new edges reach Landscape).
Nothing runs automatically on page load — expensive LLM steps only run
when the researcher clicks them.*/
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { ApiPaper, Chunk, EmbeddingStats, EmbeddingStatusData, EvidenceItem, ExtractionRunStatus, ExtractionStats, IngestResult, PaperReference, PaperSynthesis, Section, SynthesisStats } from '../lib/api';
import { Empty, Err, Loading, StatusChip, friendlyError, statusActive, statusLabel } from '../lib/states';
import TutorPanel, { type TutorRequestCtx } from './TutorPanel';

interface Props {
  projectId: string | null;
  selectedPaperId: string | null;
  onSelectPaper: (id: string | null) => void;
  onGoSearch: () => void;
  /** Bump the Landscape refresh token (after an embedding changes edges). */
  onLandscapeChanged: () => void;
  /** Navigate to the Landscape view (to inspect fresh edges/nodes). */
  onGoLandscape: () => void;
  /** Initial paper-detail tab (the Methods index opens papers on Methods). */
  openDetailTab?: 'overview' | 'methods' | 'fulltext';
}

type Tab = 'overview' | 'methods' | 'evidence' | 'synthesis' | 'references' | 'fulltext' | 'code' | 'learn';

/** Methods-workspace sections, in walkthrough order. Only extraction
 * categories the backend actually produces (schema in src/teacher/
 * prompt.py): categories with no dedicated evidence — preprocessing,
 * parameters, software/tools — get no section, and sections without
 * items are omitted from the UI rather than shown empty.*/
export const METHOD_SECTIONS: { category: string; label: string }[] = [
  { category: 'task', label: 'Study / experimental task' },
  { category: 'population_or_dataset', label: 'Participants / population / dataset' },
  { category: 'stimuli', label: 'Stimuli / materials' },
  { category: 'experimental_procedure', label: 'Experimental design / procedure' },
  { category: 'variables', label: 'Measures / variables' },
  { category: 'methods', label: 'Methods' },
  { category: 'computational_methods', label: 'Computational methods / models' },
  { category: 'statistical_methods', label: 'Statistical methods' },
  { category: 'limitations', label: 'Reported limitations (author-stated)' },
];
export const METHOD_CATEGORIES = METHOD_SECTIONS.map(s => s.category);

/** Display-only marker for an author-stated comparison, trade-off, or
 * rationale in extracted wording ("…used A instead of B because…").
 * Flags the authors' own phrasing — never evaluates it. Limitations
 * count by schema: the extraction prompt only emits author-stated ones.*/
const AUTHOR_STATEMENT_RE = /\b(instead of|rather than|compared to|compared with|compared between|in contrast to|whereas|trade-?offs?|advantages?|disadvantages?|limitations?|we chose|we opted|because|in order to|due to|except for|superior to|better than|more effective)\b/i;
function isAuthorStated(ev: EvidenceItem): boolean {
  return ev.category === 'limitations' || AUTHOR_STATEMENT_RE.test(ev.text);
}

const PANEL = { background: 'var(--color-panel)', border: '1px solid var(--color-edge)' } as const;
const BTN = {
  background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)',
  border: '1px solid var(--color-edge)',
} as const;
const BTN_HOVER = { background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-lavender)' } as const;

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium font-mono"
      style={{ background: 'var(--color-panel)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}>
      {children}
    </span>
  );
}

function ActionButton({ label, busyLabel, busy, disabled, onClick }: {
  label: string; busyLabel: string; busy: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={busy || disabled}
      className="text-[11.5px] px-2.5 py-1.5 rounded transition-colors"
      style={{ ...BTN, opacity: busy || disabled ? 0.6 : 1 }}
      onMouseEnter={e => (busy || disabled || (e.currentTarget.style.border = BTN_HOVER.border))}
      onMouseLeave={e => (e.currentTarget.style.border = BTN.border)}>
      {busy ? busyLabel : label}
    </button>
  );
}

function fmtAuthors(authors: string[]): string {
  if (!authors.length) return 'Authors not available';
  if (authors.length === 1) return authors[0];
  return `${authors[0]} +${authors.length - 1}`;
}

function pageLabel(e: EvidenceItem): string {
  if (e.page_start == null) return 'SOURCE LOCATION UNKNOWN';
  return e.page_end != null && e.page_end !== e.page_start
    ? `pp. ${e.page_start}–${e.page_end}` : `p. ${e.page_start}`;
}

function EvidenceCard({ ev }: { ev: EvidenceItem }) {
  return (
    <div className="p-3 rounded" style={PANEL} data-ev-id={ev.id}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lavender)' }}>{ev.category}</span>
        <span className="text-[10.5px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
          {ev.section}{ev.subsection ? ` / ${ev.subsection}` : ''} · {ev.chunk_id} · {pageLabel(ev)}
        </span>
      </div>
      <p className="text-[12.5px] leading-relaxed" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-sub)' }}>{ev.text}</p>
    </div>
  );
}

/** One Methods-workspace row: extracted information, its provenance
 * (section path, page or SOURCE LOCATION UNKNOWN, chunk, evidence id),
 * and expandable verbatim source text. The AUTHOR-STATED chip marks the
 * authors' own wording — it is attribution, never a judgment.*/
function MethodItem({ ev, chunks, onOpenEvidence, onLearn }: {
  ev: EvidenceItem; chunks: Chunk[] | null; onOpenEvidence: (id: string) => void;
  onLearn: (ev: EvidenceItem) => void;
}) {
  const [showSource, setShowSource] = useState(false);
  const stated = isAuthorStated(ev);
  const loc = ev.location_status !== 'known' || ev.page_start == null
    ? 'SOURCE LOCATION UNKNOWN' : pageLabel(ev);
  const chunk = chunks?.find(c => c.chunk_id === ev.chunk_id);
  return (
    <div className="p-3 rounded method-item" style={PANEL} data-ev-id={ev.id}>
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
          style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lavender)' }}>{ev.category}</span>
        {stated && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono"
            style={{ color: 'var(--color-amber)', border: '1px solid var(--color-amber)' }}>AUTHOR-STATED</span>
        )}
        <span className="text-[10.5px] font-mono provenance-line" style={{ color: 'var(--color-muted)' }}>
          {ev.section}{ev.subsection ? ` → ${ev.subsection}` : ''} · {loc} · {ev.chunk_id}
        </span>
      </div>
      <div className="text-[9.5px] uppercase tracking-wider font-mono mb-0.5" style={{ color: 'var(--color-muted)' }}>
        EXTRACTED INFORMATION
      </div>
      <p className="text-[12.5px] leading-relaxed extracted-text"
        style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-sub)' }}>{ev.text}</p>
      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
        <button onClick={() => setShowSource(v => !v)} className="text-[10.5px] underline"
          style={{ color: 'var(--color-lav-light)', fontFamily: 'var(--font-mono)' }}>
          {showSource ? 'Hide source text' : 'Show source text'}
        </button>
        <button onClick={() => onOpenEvidence(ev.id)} className="text-[10.5px] underline"
          style={{ color: 'var(--color-lav-light)', fontFamily: 'var(--font-mono)' }}>
          Open in Evidence →
        </button>
        <button data-method-learn onClick={() => onLearn(ev)} className="text-[10.5px] underline"
          style={{ color: 'var(--color-lav-light)', fontFamily: 'var(--font-mono)' }}>
          Learn
        </button>
        <span className="text-[10px] font-mono truncate" style={{ color: 'var(--color-muted)' }}
          title={ev.id}>evidence {ev.id}</span>
      </div>
      {showSource && (
        <div className="mt-2">
          <div className="text-[9.5px] uppercase tracking-wider font-mono mb-0.5"
            style={{ color: 'var(--color-muted)' }}>SOURCE TEXT</div>
          {chunks === null ? (
            <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Loading source text…</div>
          ) : !chunk ? (
            <div className="text-[11px]" style={{ color: 'var(--color-amber)' }}>
              SOURCE TEXT UNAVAILABLE — chunk {ev.chunk_id} is not among the stored chunks.
            </div>
          ) : (
            <p className="text-[12.5px] leading-relaxed pl-3 selectable-text source-text-block"
              style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)', borderLeft: '2px solid var(--color-edge)' }}>
              {chunk.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatsLine({ tone, text, warnings }: { tone: 'ok' | 'warn' | 'err'; text: string; warnings: string[] }) {
  const color = tone === 'err' ? 'var(--color-rose)' : tone === 'warn' ? 'var(--color-amber)' : 'var(--color-teal)';
  return (
    <div className="mb-3 text-[11.5px] rounded px-2.5 py-2" style={{ ...PANEL, color }}>
      <div>{text}</div>
      {warnings.slice(0, 4).map((w, i) => (
        <div key={i} className="mt-0.5" style={{ color: 'var(--color-amber)' }}>· {String(w).slice(0, 200)}</div>
      ))}
    </div>
  );
}

/** One row of the analysis pipeline. `state` is derived from real backend
 * data only: ok (done), active (running), pending (not done yet),
 * error (backend reported a failure), load (state still loading).*/
function AnalysisRow({ label, state, detail, action }: {
  label: string;
  state: 'ok' | 'active' | 'pending' | 'warn' | 'error' | 'load';
  detail?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const mark = state === 'ok' ? '✓' : state === 'active' ? '◌' : state === 'warn' ? '!' : state === 'error' ? '✕' : state === 'load' ? '…' : '○';
  const color = state === 'ok' ? 'var(--color-teal)'
    : state === 'error' ? 'var(--color-rose)'
    : state === 'warn' ? 'var(--color-amber)'
    : state === 'active' ? 'var(--color-lavender)'
    : 'var(--color-muted)';
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-edge)' }}>
      <div className="min-w-0">
        <div className="text-[12px] flex items-center gap-1.5">
          <span className={state === 'active' ? 'animate-pulse' : ''} style={{ color }}>{mark}</span>
          <span style={{ color: 'var(--color-sub)' }}>{label}</span>
        </div>
        <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-muted)' }}>{detail}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function PaperDetail({ paperId, projectId, onBack, onLandscapeChanged, onGoLandscape, onMembershipChanged, initialTab }: {
  paperId: string; projectId: string | null; onBack: () => void;
  onLandscapeChanged: () => void; onGoLandscape: () => void;
  /** Refreshes the parent collection list after an add/remove. */
  onMembershipChanged?: () => void;
  initialTab?: 'overview' | 'methods' | 'fulltext';
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'overview');
  const [paper, setPaper] = useState<ApiPaper | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[] | null>(null);
  const [extractRun, setExtractRun] = useState<ExtractionRunStatus | 'unavailable' | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [synthesis, setSynthesis] = useState<PaperSynthesis | 'missing' | null>(null);
  const [references, setReferences] = useState<PaperReference[] | null>(null);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [embedding, setEmbedding] = useState<EmbeddingStatusData | 'unavailable' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'attach' | 'process' | 'extract' | 'synthesize' | 'embed' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [processResult, setProcessResult] = useState<IngestResult | null>(null);
  const [extractStats, setExtractStats] = useState<ExtractionStats | null>(null);
  const [synthStats, setSynthStats] = useState<SynthesisStats | null>(null);
  const [embedStats, setEmbedStats] = useState<EmbeddingStats | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Contextual learning (beta): null = no panel open. Paper load resets
   * it, so no previous paper's context is ever retained.*/
  const [tutor, setTutor] = useState<TutorRequestCtx | null>(null);
  const [ftSelection, setFtSelection] = useState<(TutorRequestCtx & { x: number; y: number }) | null>(null);
  const [ftHint, setFtHint] = useState(false);
  // Project-collection membership (Library = explicit members only).
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  /** [Add to Project] / Remove from project — membership only. Removing
   *  drops the paper from the Library while the Landscape node,
   *  provenance, and edges remain untouched (never destroyed here). */
  const changeMembership = async (inProject: boolean) => {
    if (!projectId) return;
    setMembershipBusy(true);
    setMembershipError(null);
    try {
      const p = inProject
        ? await api.addToCollection(projectId, paperId)
        : await api.removeFromCollection(projectId, paperId);
      setPaper(prev => (prev && prev.id === p.id ? { ...prev, in_project: p.in_project } : prev));
      onMembershipChanged?.();
      onLandscapeChanged();
    } catch (e) {
      setMembershipError(friendlyError(e, 'Membership'));
    } finally {
      setMembershipBusy(false);
    }
  };
  /** Ref mirror of ftSelection: the chip launches from this, so the
   * click itself can never race a re-render that clears the selection.*/
  const ftSelRef = useRef<(TutorRequestCtx & { x: number; y: number }) | null>(null);

  const load = useCallback(() => {
    setError(null);
    setPaper(null); setEvidence(null); setSynthesis(null);
    setReferences(null); setSections(null); setChunks(null); setEmbedding(null);
    setExtractRun(null);
    setTutor(null); setFtSelection(null); setFtHint(false); ftSelRef.current = null;
    let cancelled = false;
    (async () => {
      try {
        const p = await api.getPaper(paperId);
        if (cancelled) return;
        setPaper(p);
        const evP: Promise<EvidenceItem[]> = api.listEvidence(paperId).catch(() => [] as EvidenceItem[]);
        const synP: Promise<PaperSynthesis | 'missing'> = api.getSynthesis(paperId).catch(() => 'missing' as const);
        const refP: Promise<PaperReference[]> = api.listReferences(paperId).catch(() => [] as PaperReference[]);
        const secP: Promise<Section[]> = api.listSections(paperId).catch(() => [] as Section[]);
        const chunkP: Promise<Chunk[]> = api.listChunks(paperId).catch(() => [] as Chunk[]);
        const embP: Promise<EmbeddingStatusData | 'unavailable'> =
          api.embeddingStatus(paperId).catch(() => 'unavailable' as const);
        const runP: Promise<ExtractionRunStatus | 'unavailable'> =
          api.extractionStatus(paperId).catch(() => 'unavailable' as const);
        const [ev, syn, refs, secs, chs, emb, run] =
          await Promise.all([evP, synP, refP, secP, chunkP, embP, runP]);
        if (cancelled) return;
        setEvidence(ev); setSynthesis(syn); setReferences(refs);
        setSections(secs); setChunks(chs); setEmbedding(emb);
        setExtractRun(run);
      } catch (e) {
        if (!cancelled) setError(friendlyError(e, 'Paper detail'));
      }
    })();
    return () => { cancelled = true; };
  }, [paperId]);

  /** Quiet refresh after actions / when processing finishes: keeps the
   * current view rendered (no "Loading paper…" flash) while updating it.*/
  const refresh = useCallback(async () => {
    try {
      const [p, ev, syn, refs, secs, chs, emb, run] = await Promise.all([
        api.getPaper(paperId),
        api.listEvidence(paperId).catch(() => [] as EvidenceItem[]),
        api.getSynthesis(paperId).catch(() => 'missing' as const),
        api.listReferences(paperId).catch(() => [] as PaperReference[]),
        api.listSections(paperId).catch(() => [] as Section[]),
        api.listChunks(paperId).catch(() => [] as Chunk[]),
        api.embeddingStatus(paperId).catch(() => 'unavailable' as const),
        api.extractionStatus(paperId).catch(() => 'unavailable' as const),
      ]);
      setPaper(p); setEvidence(ev); setSynthesis(syn); setReferences(refs);
      setSections(secs); setChunks(chs); setEmbedding(emb);
      setExtractRun(run);
    } catch {
      /* transient failure — polling or the next action retries */
    }
  }, [paperId]);

  useEffect(load, [load]);

  /** Phase-6 link from a Methods item to its evidence card: switch to the
   * Evidence tab and leave a persistent marker on the linked card.*/
  const openEvidence = (id: string) => { setHighlightId(id); setTab('evidence'); };
  useEffect(() => {
    if (tab !== 'evidence' || !highlightId) return;
    document.querySelectorAll('[data-highlight]').forEach(el => {
      delete (el as HTMLElement).dataset.highlight;
      (el as HTMLElement).style.outline = '';
    });
    const el = document.querySelector(`[data-ev-id="${highlightId}"]`) as HTMLElement | null;
    if (el) {
      el.dataset.highlight = '1';
      el.style.outline = '1px solid var(--color-lavender)';
      el.scrollIntoView({ block: 'center' });
    }
  }, [tab, highlightId, evidence]);

  // Poll processing status while the ingest pipeline runs so the UI never
  // looks frozen; refresh tab data when the status turns terminal.
  const active = !!paper && statusActive(paper.extraction_status);
  const wasActive = useRef(false);
  useEffect(() => {
    if (!active) { wasActive.current = false; return; }
    wasActive.current = true;
    const timer = setInterval(async () => {
      try {
        const s = await api.processingStatus(paperId);
        setPaper(prev => prev
          ? { ...prev, extraction_status: s.extraction_status, parsing_warnings: s.parsing_warnings }
          : prev);
        if (!statusActive(s.extraction_status) && wasActive.current) {
          wasActive.current = false;
          refresh();
        }
      } catch {
        /* transient poll failure — the next tick retries */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [active, paperId, refresh]);

  const attachPdf = async (file: File) => {
    setBusy('attach'); setActionError(null);
    try {
      await api.attachPdf(paperId, file);
      await refresh();
    } catch (e) {
      setActionError(friendlyError(e, 'PDF attach'));
    } finally {
      setBusy(null);
    }
  };

  const reprocess = async () => {
    setBusy('process'); setActionError(null); setProcessResult(null);
    try {
      const r = await api.processPaper(paperId);
      setProcessResult(r);
      await refresh();
    } catch (e) {
      setActionError(friendlyError(e, 'Processing'));
    } finally {
      setBusy(null);
    }
  };

  const runExtract = async () => {
    setBusy('extract'); setActionError(null); setExtractStats(null);
    try {
      // force=false: the backend skips chunks that already succeeded for
      // this (model, prompt, schema) and retries only failed ones.
      const stats = await api.extractPaper(paperId);
      setExtractStats(stats);
      await refresh();
    } catch (e) {
      setActionError(friendlyError(e, 'Extraction'));
    } finally {
      setBusy(null);
    }
  };

  const runSynthesize = async () => {
    setBusy('synthesize'); setActionError(null); setSynthStats(null);
    try {
      // Only a *complete* row would be returned cached, so force it only
      // in that case; missing/partial/error rows re-run without force.
      const force = synthesis !== null && synthesis !== 'missing'
        && synthesis.synthesis_status === 'complete';
      const stats = await api.synthesizePaper(paperId, { force });
      setSynthStats(stats);
      await refresh();
    } catch (e) {
      setActionError(friendlyError(e, 'Synthesis'));
    } finally {
      setBusy(null);
    }
  };

  /** Embed → recompute stored similarity pairs → refresh Landscape.
   * Non-forced: the backend hash-skips when the representation did not
   * change, so revisiting never regenerates vectors needlessly.*/
  const runEmbed = async () => {
    setBusy('embed'); setActionError(null); setEmbedStats(null);
    try {
      const stats = await api.embedPaper(paperId);
      setEmbedStats(stats);
      const st = await api.embeddingStatus(paperId).catch(() => null);
      setEmbedding(st ?? 'unavailable');
      if (stats.status === 'error') {
        setActionError(`Embedding failed: ${stats.warnings.join('; ') || 'no detail reported'}`);
        return;
      }
      if (projectId) {
        try {
          // Store missing cosine pairs so this paper's semantic-similarity
          // edges appear in Landscape (landscape only reads stored pairs).
          await api.projectSimilarity(projectId);
        } catch (e) {
          setActionError(
            `Embedding ${stats.cached ? 'unchanged' : 'generated'}, but updating `
            + `landscape similarity failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      onLandscapeChanged();
    } catch (e) {
      setActionError(friendlyError(e, 'Embedding'));
    } finally {
      setBusy(null);
    }
  };

  /** Contextual-learning capture: the verbatim selection plus the
   * provenance of the paragraph it sits in (section, subsection, page,
   * and the paragraph's own text as bounded surrounding context). The
   * selection is sent exactly as captured — never rewritten.*/
  const readSelection = (): (TutorRequestCtx & { x: number; y: number }) | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
    const node = sel.anchorNode;
    const el = (node && node.nodeType === 3 ? node.parentElement : node) as HTMLElement | null;
    const block = el ? (el.closest('[data-ft-page]') as HTMLElement | null) : null;
    if (!block) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    return {
      text: sel.toString(),   // preserved exactly as selected
      context: block.getAttribute('data-ft-text') ?? '',
      section: block.getAttribute('data-ft-section') ?? '',
      subsection: block.getAttribute('data-ft-sub') ?? '',
      page: Number(block.getAttribute('data-ft-page')),
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 150)),
      y: Math.max(8, rect.top - 44),
    };
  };

  const handleFullTextSelect = () => {
    const ctx = readSelection();
    ftSelRef.current = ctx;
    setFtSelection(ctx);
  };

  /** Toolbar fallback: without a selection it surfaces the honest hint
   * instead of calling the tutor.*/
  const toolbarExplain = () => {
    const ctx = readSelection();
    if (!ctx) { setFtHint(true); setFtSelection(null); ftSelRef.current = null; return; }
    setFtHint(false); setFtSelection(null); ftSelRef.current = null; setTutor(ctx);
  };

  /** Methods → Learning: the extracted statement is the selection, its
   * stored source chunk is the context, the evidence id links back.*/
  const learnFromMethod = (ev: EvidenceItem) => {
    const chunk = chunks?.find(c => c.chunk_id === ev.chunk_id);
    setTutor({
      text: ev.text,
      context: chunk?.text ?? '',
      section: ev.section,
      subsection: ev.subsection,
      page: ev.page_start,
      evidenceId: ev.id,
    });
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'methods', label: 'Methods' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'synthesis', label: 'Synthesis' },
    { id: 'references', label: 'References' },
    { id: 'fulltext', label: 'Full Text' },
    { id: 'code', label: 'Code' },
    { id: 'learn', label: 'Learn' },
  ];

  if (error && !paper) return <Err message={error} onRetry={load} />;
  if (!paper) return <Loading text="Loading paper…" />;

  const metaOnly = !paper.source_pdf_path;
  const identifiers = [paper.doi && `DOI ${paper.doi}`, paper.pmid && `PMID ${paper.pmid}`, paper.arxiv_id && `arXiv ${paper.arxiv_id}`].filter(Boolean);
  const methodEvidence = (evidence ?? []).filter(ev => METHOD_CATEGORIES.includes(ev.category));
  const evidenceCount = evidence?.length ?? 0;

  // ---- Analysis-pipeline derived state (real backend data only) ----
  const chunkCount = chunks?.length ?? 0;
  const chunksKnown = chunks !== null;
  const sectionsCount = sections?.length ?? 0;
  const ingestActive = statusActive(paper.extraction_status);
  const canExtract = !metaOnly && (!chunksKnown || chunkCount > 0);
  const extractButton = (
    <ActionButton
      label={evidenceCount > 0 ? 'Re-run extraction' : 'Extract evidence'}
      busyLabel="Extracting…" busy={busy === 'extract'} disabled={!canExtract}
      onClick={runExtract} />
  );
  /** Complete rows need `force` to actually re-run; the label says so. */
  const synthState = synthesis === null ? 'load'
    : synthesis === 'missing' ? 'missing' : synthesis.synthesis_status;
  const synthButtonLabel = synthState === 'load' ? 'Generate synthesis'
    : synthState === 'missing' ? 'Generate synthesis'
    : synthState === 'complete' ? 'Regenerate synthesis' : 'Retry synthesis';
  const synthFieldCount = (synthesis && synthesis !== 'missing')
    ? Object.values(synthesis.synthesis).filter(items => items.length > 0).length
    : 0;
  const synthButton = (
    <ActionButton
      label={synthButtonLabel}
      busyLabel="Synthesizing…" busy={busy === 'synthesize'}
      disabled={evidenceCount === 0}
      onClick={runSynthesize} />
  );
  const processButton = (
    <ActionButton
      label={sectionsCount > 0 || evidenceCount > 0 || paper.extraction_status !== 'pending'
        ? 'Re-run processing' : 'Process paper'}
      busyLabel="Processing…" busy={busy === 'process'} onClick={reprocess} />
  );
  const embedButton = (
    <ActionButton label="Update embedding" busyLabel="Embedding…"
      busy={busy === 'embed'} onClick={runEmbed} />
  );
  /** Small text link to the tab holding an operation's results. */
  const openLink = (target: Tab, label: string) => (
    <button onClick={() => setTab(target)} className="text-[10.5px] underline"
      style={{ color: 'var(--color-lav-light)', fontFamily: 'var(--font-mono)' }}>
      {label}
    </button>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="px-5 pt-4 pb-0 border-b" style={{ borderColor: 'var(--color-edge)' }}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold leading-snug mb-1" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
            {paper.title || 'Untitled'}
          </h2>
          <button onClick={onBack} title="Back to library list"
            className="shrink-0 text-[11px] px-2 py-1 rounded transition-colors"
            style={{ color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
            ← Library
          </button>
        </div>
        <div className="text-[12px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
          {paper.authors.length ? paper.authors.join(' · ') : 'Authors not available'}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>
          <span>{paper.journal || 'Journal not available'}</span>
          <span>·</span>
          <span>{paper.year ?? 'Year not available'}</span>
          <span>·</span>
          <span className="italic">{paper.discovery_source_type.replace(/_/g, ' ')}</span>
          <StatusChip status={paper.extraction_status} />
          {metaOnly && <Badge>Metadata only — PDF not available</Badge>}
        </div>
        {identifiers.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {identifiers.map(id => <Badge key={id}>{id}</Badge>)}
          </div>
        )}
        {/* Project collection membership. The Library holds ONLY explicit
            members; removing membership leaves the Landscape node and
            every relationship intact (re-add any time). */}
        <div className="flex items-center gap-2 flex-wrap mb-2" data-testid="library-membership">
          {paper.in_project ? (
            <>
              <span data-testid="library-in-project"
                className="text-[11px] px-1.5 py-0.5 rounded"
                style={{ border: '1px solid var(--color-teal)', color: 'var(--color-teal)' }}>
                ✓ In Project
              </span>
              <button onClick={() => changeMembership(false)} disabled={membershipBusy}
                data-testid="library-remove"
                className="text-[11px] px-2 py-0.5 rounded transition-colors"
                style={{ border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-rose)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}
                title="Removes project membership only — the paper stays in the Landscape.">
                {membershipBusy ? 'Removing…' : 'Remove from project'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => changeMembership(true)} disabled={membershipBusy}
                data-testid="library-add"
                className="text-[11px] px-2 py-1 rounded transition-colors"
                style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
                {membershipBusy ? 'Adding…' : '+ Add to Project'}
              </button>
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                Removed from the project collection — the paper remains in the Landscape.
              </span>
            </>
          )}
        </div>
        {membershipError && (
          <div data-testid="library-membership-error" className="mb-2 text-[11.5px]"
            style={{ color: 'var(--color-rose)' }}>
            {membershipError}
          </div>
        )}
        {metaOnly && (
          <div className="mb-2">
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) attachPdf(f); e.target.value = ''; }} />
            <ActionButton label="Attach PDF to this paper" busyLabel="Uploading & processing…"
              busy={busy === 'attach'} onClick={() => fileRef.current?.click()} />
          </div>
        )}
        <div className="flex items-center gap-0 -mb-px overflow-x-auto">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-[12px] font-medium transition-colors whitespace-nowrap ${tab === t.id ? 'tab-active' : 'tab-inactive'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="px-5 py-2 text-[11.5px]" style={{ color: 'var(--color-rose)', background: 'rgba(194,111,111,0.06)', borderBottom: '1px solid var(--color-edge)' }}>
          {actionError}
        </div>
      )}

      {/* Contextual learning (beta): a layer over the current paper only. */}
      {tutor && paper && (
        <TutorPanel paperId={paperId} paperTitle={paper.title || 'Untitled'}
          req={tutor} onClose={() => setTutor(null)} />
      )}

      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' && (
          <div className="p-5 max-w-2xl">
            <h3 className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>Abstract</h3>
            <p className="text-[14px] leading-relaxed mb-5" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
              {paper.abstract || 'Not available'}
            </p>

            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-muted)' }}>
                Analysis pipeline
              </h3>
              <span className="text-[10.5px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                {metaOnly ? 'metadata-only paper' : 'PDF ingested'}
              </span>
            </div>

            <div className="px-3 rounded" style={PANEL}>
              <AnalysisRow
                label="Paper"
                state="ok"
                detail={`Imported · ${paper.discovery_source_type.replace(/_/g, ' ')}${metaOnly ? ' · no PDF attached' : ''}`}
              />

              <AnalysisRow
                label="Processing (parse → chunk)"
                state={metaOnly ? 'pending'
                  : ingestActive ? 'active'
                  : paper.extraction_status === 'error' ? 'error'
                  : chunksKnown && chunkCount > 0
                    ? (paper.extraction_status === 'partial' ? 'warn' : 'ok')
                  : chunksKnown ? 'pending' : 'load'}
                detail={
                  metaOnly ? 'No PDF attached — attach one to parse and chunk.'
                  : ingestActive ? `${statusLabel(paper.extraction_status)} — this view refreshes automatically.`
                  : paper.extraction_status === 'error'
                    ? (paper.parsing_warnings.length
                        ? `Ingest failed: ${String(paper.parsing_warnings[0]).slice(0, 160)}`
                        : 'Ingest failed — see warnings below.')
                    : chunksKnown && chunkCount > 0
                      ? <>{chunkCount} chunks · {sectionsCount} sections · <StatusChip status={paper.extraction_status} /></>
                      : chunksKnown ? 'No chunks produced yet.' : 'Loading…'
                }
                action={metaOnly ? undefined : processButton}
              />

              <AnalysisRow
                label="Evidence extraction"
                state={evidence === null ? 'load'
                  : evidenceCount > 0 ? (extractStats?.status === 'error' ? 'warn' : 'ok')
                  : extractStats?.status === 'error' ? 'error' : 'pending'}
                detail={
                  evidence === null ? 'Loading…'
                  : evidenceCount > 0
                    ? <>{evidenceCount} evidence items · runs skip already-extracted chunks {openLink('evidence', 'Open Evidence →')}</>
                  : metaOnly ? 'Metadata-only paper: attach a PDF first.'
                  : !canExtract ? 'No chunks to extract — process the paper first.'
                  : 'Not extracted yet.'
                }
                action={extractButton}
              />

              <AnalysisRow
                label="Synthesis"
                state={synthesis === null ? 'load'
                  : synthesis === 'missing' ? (extractStats?.status === 'error' ? 'error' : 'pending')
                  : synthesis.synthesis_status === 'complete' ? 'ok'
                  : synthesis.synthesis_status === 'partial' ? 'warn' : 'error'}
                detail={
                  synthesis === null ? 'Loading…'
                  : synthesis === 'missing'
                    ? (evidenceCount === 0
                        ? 'Needs evidence first — run extraction.'
                        : 'Not generated yet.')
                    : synthesis.synthesis_status === 'complete'
                      ? <>{synthFieldCount} fields populated · {synthesis.model_name} {openLink('synthesis', 'Open Synthesis →')}</>
                      : <>{synthesis.synthesis_status === 'partial' ? 'Partial' : 'Error'}: {(synthesis.error || 'no detail reported').slice(0, 160)} {openLink('synthesis', 'Open Synthesis →')}</>
                }
                action={synthButton}
              />

              <AnalysisRow
                label="Embedding"
                state={embedding === null ? 'load'
                  : embedding === 'unavailable' ? 'error'
                  : embedding.status === 'complete' ? 'ok'
                  : embedding.status === 'error' ? 'error' : 'pending'}
                detail={
                  embedding === null ? 'Loading…'
                  : embedding === 'unavailable' ? 'Status unavailable — reload the paper to retry.'
                  : embedding.status === 'error'
                    ? (embedding.error || 'Embedding failed — see warnings below.')
                    : embedding.status === 'complete'
                      ? (() => {
                          const emb = embedding.embeddings[0];
                          return emb
                            ? <>{emb.dim}d · {emb.model_name} · from {emb.source_repr}</>
                            : 'Generated';
                        })()
                      : 'Not generated yet — used for semantic-similarity edges in Landscape.'
                }
                action={embedButton}
              />
            </div>

            {(paper.parsing_warnings.length > 0 || processResult || extractStats || synthStats || embedStats) && (
              <div className="mt-3 p-3 rounded text-[11px]" style={PANEL}>
                {processResult && (
                  <div style={{ color: processResult.status === 'error' ? 'var(--color-rose)' : 'var(--color-teal)' }}>
                    Last processing run: {processResult.pages} pages → {processResult.chunks} chunks ({processResult.status})
                    {processResult.warnings.length > 0 && (
                      <span style={{ color: 'var(--color-amber)' }}> · {processResult.warnings.length} warning(s)</span>
                    )}
                  </div>
                )}
                {extractStats && (
                  <div style={{ color: extractStats.status === 'error' ? 'var(--color-rose)' : extractStats.status === 'partial' ? 'var(--color-amber)' : 'var(--color-teal)' }}>
                    Last extraction run: {extractStats.status} · {extractStats.succeeded}/{extractStats.chunks_total} chunks ({extractStats.skipped_cached} already cached) · {extractStats.evidence_items} items
                  </div>
                )}
                {synthStats && (
                  <div style={{ color: synthStats.status === 'error' ? 'var(--color-rose)' : synthStats.status === 'partial' ? 'var(--color-amber)' : 'var(--color-teal)' }}>
                    Last synthesis run: {synthStats.status}{synthStats.cached ? ' (cached — nothing to redo)' : ''} · {synthStats.fields_populated} fields populated
                  </div>
                )}
                {embedStats && (
                  <div style={{ color: embedStats.status === 'error' ? 'var(--color-rose)' : 'var(--color-teal)' }}>
                    Last embedding run: {embedStats.status}{embedStats.cached ? ' (unchanged — reused stored vector)' : embedStats.dim ? ` · ${embedStats.dim}d` : ''}
                    {embedStats.status !== 'error' && (
                      <button onClick={onGoLandscape} className="underline ml-1"
                        style={{ color: 'var(--color-lav-light)', fontFamily: 'var(--font-mono)' }}>
                        Open Landscape →
                      </button>
                    )}
                  </div>
                )}
                {paper.parsing_warnings.slice(0, 5).map((w, i) => (
                  <div key={`w${i}`} className="mt-0.5" style={{ color: 'var(--color-amber)' }}>· {String(w).slice(0, 160)}</div>
                ))}
              </div>
            )}

            <div className="mt-3 text-[11px]" style={{ color: 'var(--color-muted)' }}>
              Actions run on demand — nothing re-runs just by opening this page.
              Failed runs never delete a previously successful result.
            </div>

            {error && <div className="mt-3 text-[11.5px]" style={{ color: 'var(--color-rose)' }}>{error}</div>}
          </div>
        )}

        {tab === 'methods' && (
          <div className="p-5 max-w-2xl">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-muted)' }}>
                Method evidence{evidence ? ` · ${methodEvidence.length} items` : ''}
              </span>
              {extractButton}
            </div>
            {extractStats && (
              <StatsLine
                tone={extractStats.status === 'error' ? 'err' : extractStats.status === 'partial' ? 'warn' : 'ok'}
                text={`Extraction ${extractStats.status}: ${extractStats.succeeded}/${extractStats.chunks_total} chunks · ${extractStats.evidence_items} items${extractStats.duration_seconds ? ` · ${extractStats.duration_seconds.toFixed(1)}s` : ''}`}
                warnings={extractStats.warnings} />
            )}
            {extractRun !== null && extractRun !== 'unavailable' && extractRun.run === 'partial' && (
              <div className="mb-3 text-[11.5px] rounded px-2.5 py-2" style={{ ...PANEL, color: 'var(--color-amber)' }}>
                Extraction partial — {extractRun.succeeded}/{extractRun.chunks_total} chunks succeeded · {extractRun.failed} failed
                {extractRun.error ? ` · ${extractRun.error.slice(0, 140)}` : ''}
              </div>
            )}
            {extractRun !== null && extractRun !== 'unavailable' && extractRun.run === 'failed' && methodEvidence.length > 0 && (
              <div className="mb-3 text-[11.5px] rounded px-2.5 py-2" style={{ ...PANEL, color: 'var(--color-rose)' }}>
                Extraction failed — {extractRun.failed}/{extractRun.chunks_total} chunks failed on the latest attempt
                {extractRun.error ? ` · ${extractRun.error.slice(0, 140)}` : ''}
              </div>
            )}
            {evidence === null ? <Loading text="Loading method evidence…" />
              : methodEvidence.length === 0 ? (
                metaOnly ? (
                  <Empty
                    title="Method extraction has not been performed for this paper."
                    hint="This paper has metadata only — attach the PDF (button above), then run extraction from Overview. LiiT does not start it automatically."
                    action={extractButton} />
                ) : extractRun === null ? (
                  <Loading text="Loading extraction status…" />
                ) : extractRun === 'unavailable' ? (
                  <Empty
                    title="Extraction state unavailable."
                    hint="Could not read this paper's extraction status. Reopen the paper to retry." />
                ) : extractRun.run === 'not_run' ? (
                  <Empty
                    title="Method extraction has not been run for this paper."
                    hint="Extraction is on demand: it pulls procedures, models, and statistics from the stored text when you run it."
                    action={extractButton} />
                ) : extractRun.run === 'failed' ? (
                  <Empty
                    title="Method extraction failed."
                    hint={`${extractRun.failed}/${extractRun.chunks_total} chunks failed on the latest attempt.${extractRun.error ? ` First error: ${extractRun.error.slice(0, 160)}` : ''}`}
                    action={extractButton} />
                ) : (
                  <Empty
                    title="No method information was extracted from the available text."
                    hint={`Extraction ran on ${extractRun.succeeded}/${extractRun.chunks_total} chunks but produced no items in the method categories.`} />
                )
              ) : (
                <>
                  {METHOD_SECTIONS.map(sec => {
                    const items = methodEvidence.filter(ev => ev.category === sec.category);
                    if (!items.length) return null;
                    return (
                      <div key={sec.category} className="mb-5">
                        <h4 className="text-[11px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--color-lavender)' }}>
                          {sec.label}
                        </h4>
                        <div className="space-y-2.5">
                          {items.map(ev => (
                            <MethodItem key={ev.id} ev={ev} chunks={chunks}
                              onOpenEvidence={openEvidence} onLearn={learnFromMethod} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {(() => {
                    const stated = methodEvidence.filter(isAuthorStated);
                    if (!stated.length) return null;
                    return (
                      <div className="mb-5">
                        <h4 className="text-[11px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--color-amber)' }}>
                          AUTHOR-STATED — comparisons, trade-offs & rationale
                        </h4>
                        <div className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>
                          Extracted from the paper: these statements belong to its authors, shown as written.
                          LiiT does not evaluate or rank them.
                        </div>
                        <div className="space-y-2.5">
                          {stated.map(ev => (
                            <MethodItem key={`stated-${ev.id}`} ev={ev} chunks={chunks}
                              onOpenEvidence={openEvidence} onLearn={learnFromMethod} />
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
          </div>
        )}

        {tab === 'evidence' && (
          <div className="p-5 max-w-2xl">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-muted)' }}>
                Evidence{evidence ? ` · ${evidenceCount} items` : ''}
              </span>
              {extractButton}
            </div>
            {extractStats && (
              <StatsLine
                tone={extractStats.status === 'error' ? 'err' : extractStats.status === 'partial' ? 'warn' : 'ok'}
                text={`Extraction ${extractStats.status}: ${extractStats.succeeded}/${extractStats.chunks_total} chunks · ${extractStats.evidence_items} items${extractStats.duration_seconds ? ` · ${extractStats.duration_seconds.toFixed(1)}s` : ''}`}
                warnings={extractStats.warnings} />
            )}
            {evidence === null ? <Loading text="Loading evidence…" /> : evidence.length === 0 ? (
              <Empty
                title="Evidence extraction has not produced any items yet."
                hint={metaOnly
                  ? 'Metadata-only paper: attach a PDF on Overview, then run extraction.'
                  : 'Run extraction to produce structured evidence for this paper.'} />
            ) : (
              <div className="space-y-2.5">
                {evidence.map(ev => <EvidenceCard key={ev.id} ev={ev} />)}
              </div>
            )}
          </div>
        )}

        {tab === 'synthesis' && (
          <div className="p-5 max-w-2xl">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-muted)' }}>Synthesis</span>
              {synthButton}
            </div>
            {evidenceCount === 0 && !metaOnly && (
              <div className="mb-3 text-[11px]" style={{ color: 'var(--color-muted)' }}>
                Synthesis runs on validated evidence — run extraction first.
              </div>
            )}
            {synthStats && (
              <StatsLine
                tone={synthStats.status === 'error' ? 'err' : synthStats.status === 'partial' ? 'warn' : 'ok'}
                text={`Synthesis ${synthStats.status}: ${synthStats.fields_populated} fields populated${synthStats.duration_seconds ? ` · ${synthStats.duration_seconds.toFixed(1)}s` : ''}`}
                warnings={synthStats.warnings} />
            )}
            {synthesis === null ? <Loading text="Loading synthesis…" /> : synthesis === 'missing' ? (
              <Empty
                title="Synthesis is not available yet."
                hint={evidenceCount === 0
                  ? (metaOnly ? 'Metadata-only paper: attach a PDF, run extraction, then synthesis.' : 'Run extraction first: synthesis only uses validated chunk evidence.')
                  : 'Run synthesis to summarize the paper from its extracted evidence.'} />
            ) : synthesis.synthesis_status !== 'complete' ? (
              <Empty title={`Synthesis ${synthesis.synthesis_status}`} hint={synthesis.error || 'Synthesis did not complete.'} />
            ) : (
              <div className="space-y-4">
                {Object.entries(synthesis.synthesis).map(([field, items]) => (
                  items.length > 0 && (
                    <div key={field}>
                      <h4 className="text-[11px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--color-lavender)' }}>
                        {field.replace(/_/g, ' ')}
                      </h4>
                      {items.map((it, i) => (
                        <div key={i} className="mb-2 pl-3" style={{ borderLeft: '2px solid var(--color-edge)' }}>
                          <p className="text-[12.5px] leading-relaxed" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-sub)' }}>{it.text}</p>
                          <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                            {it.sources.map(s => `${s.chunk_id} p.${s.page_start ?? '?'}`).join(' · ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'references' && (
          <div className="p-5 max-w-2xl">
            {references === null ? <Loading text="Loading references…" /> : references.length === 0 ? (
              <Empty
                title="No resolved references were found."
                hint={metaOnly
                  ? 'Metadata-only paper: attach a PDF to enable reference extraction.'
                  : 'No reference section was detected in this PDF.'} />
            ) : (
              <>
                <div className="mb-3 text-[11px] font-mono" style={{ color: 'var(--color-muted)' }}>
                  {references.length} reference{references.length === 1 ? '' : 's'} · {references.filter(r => r.resolved_paper_id).length} resolved
                </div>
                <div className="space-y-2">
                  {references.map(ref => (
                    <div key={ref.id} className="px-3 py-2.5 rounded" style={PANEL}>
                      <div className="text-[12.5px] mb-0.5" style={{ color: 'var(--color-ink)' }}>
                        {ref.title || ref.raw_text.slice(0, 220)}
                      </div>
                      <div className="text-[11px] flex flex-wrap gap-x-2" style={{ color: 'var(--color-muted)' }}>
                        {ref.authors.length > 0 && <span>{ref.authors.slice(0, 3).join(', ')}</span>}
                        {ref.journal && <span>{ref.journal}</span>}
                        {ref.year && <span>{ref.year}</span>}
                        <span className="font-mono">{ref.resolution_status}{ref.resolved_paper_id ? ' → in project' : ''}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'fulltext' && (
          <div className="p-5 max-w-2xl">
            {sections === null ? <Loading text="Loading full text…" /> : sections.length === 0 ? (
              <Empty title="Full text not available" hint="Metadata-only paper: attach a PDF to enable full-text extraction." />
            ) : (
              <div data-ft-root onMouseUp={handleFullTextSelect} onKeyUp={handleFullTextSelect}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-muted)' }}>
                    Full text · {sections.length} sections
                  </span>
                  <button
                    data-ft-toolbar onClick={toolbarExplain}
                    className="text-[11px] px-2 py-1 rounded transition-colors"
                    style={{ color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
                    Explain selection
                  </button>
                </div>
                {ftHint && (
                  <div
                    data-ft-hint
                    className="mb-3 text-[11.5px] rounded px-2.5 py-1.5"
                    style={{ color: 'var(--color-amber)', border: '1px solid var(--color-amber)' }}>
                    Select text from the paper to learn about it.
                  </div>
                )}
                {sections.map(sec => (
                  <div key={sec.name} className="mb-6">
                    <h4 className="text-[11px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--color-lavender)' }}>{sec.name}</h4>
                    {sec.items.filter(it => it.text.trim()).slice(0, 60).map((it, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 mb-2"
                        data-ft-section={sec.name}
                        data-ft-sub={it.subsection ?? ''}
                        data-ft-page={String(it.page)}
                        data-ft-text={it.text}>
                        <p className="flex-1 text-[13px] leading-relaxed selectable-text" style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-sub)' }}>
                          {it.text}
                        </p>
                        <span className="text-[10px] select-none shrink-0 mt-0.5" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>p.{it.page}</span>
                      </div>
                    ))}
                  </div>
                ))}
                {ftSelection && (
                  <button
                    data-ft-chip
                    onMouseDown={e => e.preventDefault()}   // keep the selection intact
                    onMouseUp={e => e.stopPropagation()}     // chip events never re-read/clear it
                    onClick={() => {
                      const c = ftSelRef.current;
                      if (c) { setTutor(c); setFtSelection(null); ftSelRef.current = null; }
                    }}
                    className="fixed z-50 px-2.5 py-1 rounded text-[11.5px] font-medium"
                    style={{
                      left: ftSelection.x, top: ftSelection.y,
                      background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)',
                      border: '1px solid var(--color-lavender)',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
                    }}>
                    Explain
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'code' && (
          <div className="p-5 max-w-2xl">
            <Empty
              title="Not available yet"
              hint="Code mapping is reserved for a later slice. Nothing here is generated or inferred."
            />
          </div>
        )}

        {tab === 'learn' && (
          <div className="p-5 max-w-2xl">
            <Empty
              title="Learning happens in context, next to the text"
              hint="Select a passage in Full Text and press Explain, or press Learn on any Methods item. The explanation is generated for that selection on the paper you are reading — nothing runs automatically, and nothing is stored here."
              action={
                <button
                  onClick={() => setTab('fulltext')}
                  className="text-[11.5px] px-3 py-1.5 rounded"
                  style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
                  Open Full Text
                </button>
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Library({ projectId, selectedPaperId, onSelectPaper, onGoSearch, onLandscapeChanged, onGoLandscape, openDetailTab }: Props) {
  const [papers, setPapers] = useState<ApiPaper[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!projectId) { setPapers([]); return; }
    setError(null);
    let cancelled = false;
    api.listPapers(projectId)
      .then(ps => { if (!cancelled) setPapers(ps); })
      .catch(e => { if (!cancelled) { setError(friendlyError(e, 'Library')); setPapers([]); } });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(load, [load]);

  // Refresh the list while any paper is mid-ingest so statuses stay live.
  const anyActive = (papers ?? []).some(p => statusActive(p.extraction_status));
  useEffect(() => {
    if (!projectId || !anyActive) return;
    const timer = setInterval(() => {
      api.listPapers(projectId).then(ps => setPapers(ps)).catch(() => { /* next tick */ });
    }, 2000);
    return () => clearInterval(timer);
  }, [projectId, anyActive]);

  const upload = async (file: File) => {
    if (!projectId) return;
    setUploading(true);
    setError(null);
    try {
      // Upload runs the ingest pipeline synchronously; the response carries
      // the paper with its final processing status.
      const paper = await api.uploadPaper(projectId, file);
      load();
      if (paper?.id) onSelectPaper(paper.id); // show the new paper immediately
    } catch (e) {
      setError(friendlyError(e, 'PDF upload'));
    } finally {
      setUploading(false);
    }
  };

  const q = filter.toLowerCase();
  const visible = (papers ?? []).filter(p =>
    !q || p.title.toLowerCase().includes(q) || p.authors.some(a => a.toLowerCase().includes(q)));

  return (
    <div className="flex h-full">
      <div className="w-[180px] shrink-0 flex flex-col border-r overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Library</span>
          <div className="text-[11px] mt-1" style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>
            {papers === null ? '…' : `${papers.length} paper${papers.length === 1 ? '' : 's'}`}
          </div>
          {/* Collection semantics in its own element (the count element
              above keeps its exact "N papers" text). Library = explicitly
              added members only; discoveries stay in the Landscape. */}
          <div className="text-[10.5px] mt-1 leading-snug"
            data-testid="library-collection-subtitle"
            style={{ color: 'var(--color-muted)' }}>
            Project collection — seed and explicitly added papers. Discovered papers live in the Landscape until added.
          </div>
        </div>
        <div className="flex-1" />
        <div className="p-2 border-t" style={{ borderColor: 'var(--color-edge)' }}>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading || !projectId}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[11.5px] transition-colors"
            style={{ color: 'var(--color-muted)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
            {uploading ? 'Uploading & processing…' : 'Upload PDF'}
          </button>
        </div>
      </div>

      <div className="w-[280px] shrink-0 flex flex-col border-r overflow-hidden" style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
        <div className="px-3 py-2.5 border-b" style={{ borderColor: 'var(--color-edge)' }}>
          <div className="flex items-center gap-1.5 rounded px-2 py-1.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--color-muted)' }}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="text" placeholder="Filter papers…" value={filter} onChange={e => setFilter(e.target.value)}
              className="flex-1 bg-transparent text-[12px] border-0 outline-none"
              style={{ color: 'var(--color-ink)', caretColor: 'var(--color-lavender)' }} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="px-3 py-2 flex items-start justify-between gap-2">
              <span className="text-[11.5px]" style={{ color: 'var(--color-rose)' }}>{error}</span>
              <button onClick={load} className="text-[11px] shrink-0" style={{ color: 'var(--color-lav-light)' }}>Retry</button>
            </div>
          )}
          {papers === null ? <Loading text="Loading library…" /> : visible.length === 0 ? (
            <div className="p-4 text-center">
              <div className="text-[12.5px] mb-1" style={{ color: 'var(--color-sub)' }}>
                {(papers ?? []).length === 0
                  ? 'Add a paper or search PubMed/arXiv.'
                  : 'No papers match this filter.'}
              </div>
              {(papers ?? []).length === 0 && (
                <button onClick={onGoSearch} className="text-[11.5px] mt-1 px-2.5 py-1.5 rounded"
                  style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
                  Search PubMed/arXiv →
                </button>
              )}
            </div>
          ) : visible.map(p => (
            <button key={p.id} onClick={() => onSelectPaper(p.id)}
              className="w-full text-left px-3 py-2.5 border-b transition-colors"
              style={{ borderColor: 'var(--color-edge)', background: p.id === selectedPaperId ? 'rgba(160,142,207,0.08)' : 'transparent' }}>
              <div className="text-[12.5px] font-medium leading-snug line-clamp-2 mb-1" style={{ color: 'var(--color-ink)' }}>
                {p.title || 'Untitled'}
              </div>
              <div className="text-[11px] truncate mb-1" style={{ color: 'var(--color-muted)' }}>
                {fmtAuthors(p.authors)} · {p.year ?? '—'}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <StatusChip status={p.extraction_status} />
                {!p.source_pdf_path && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--color-panel)', color: 'var(--color-muted)', border: '1px solid var(--color-edge)' }}>
                    metadata-only
                  </span>
                )}
                <span className="text-[10px] italic truncate" style={{ color: 'var(--color-muted)' }}>
                  {p.discovery_source_type.replace(/_/g, ' ')}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedPaperId ? (
        <PaperDetail key={selectedPaperId} paperId={selectedPaperId} projectId={projectId}
          onBack={() => onSelectPaper(null)} onLandscapeChanged={onLandscapeChanged}
          onMembershipChanged={load}
          onGoLandscape={onGoLandscape} initialTab={openDetailTab} />
      ) : (
        <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-muted)' }}>
          <span className="text-sm">Select a paper to begin reading</span>
        </div>
      )}
    </div>
  );
}
