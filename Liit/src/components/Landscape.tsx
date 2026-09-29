/**Landscape workspace — research exploration where DISCOVERED papers
 * are explicitly distinguished from the project collection.
 *
 * - Graph / Split / List views over ONE shared filter set (the same
 *   filtered node+edge set drives every view; the choice persists).
 * - Discovered papers stay in the Landscape until the researcher
 *   clicks [+ Add to Project] (single or bulk) — membership only:
 *   provenance, nodes, and edges are preserved, never duplicated.
 * - Filters/sorting live in lib/landscapeFilter (pure functions over
 *   the single fetched payload — no network per filter; client-side
 *   for MVP, structured to move server-side later).
 * - Counts header: Landscape / In project / Discovered. Truthful
 *   empty + single-seed states. Provenance and relationships come from
 *   backend data only — no inferred relationships, no relevance
 *   judgments, no invented citation counts or retraction status.*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { LandscapeData, LandscapeEdge, LandscapeNode, LandscapeStatus } from '../lib/api';
import { Empty, Err, Loading, friendlyError } from '../lib/states';
import {
  DEFAULT_DIR, DEFAULT_FILTERS, activeChips, applyAll, clearedFilters,
  deriveFacets, honestyNotes,
} from '../lib/landscapeFilter';
import type { LandscapeFilters, SortKey } from '../lib/landscapeFilter';
import FilterPanel from './landscape/FilterPanel';
import PaperDetailCard from './landscape/PaperDetailCard';
import PaperTable from './landscape/PaperTable';

interface Props {
  projectId: string | null;
  /** Lifted to the shell so the selected node survives
   * Landscape → paper → Landscape navigation.*/
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  onSelectPaper: (id: string) => void;
  onOpenPaper: (id: string) => void;
  onGoSearch: () => void;
  refreshToken: number;
}

interface Transform { x: number; y: number; scale: number; }
interface Placed { node: LandscapeNode; x: number; y: number; }

type LandscapeView = 'graph' | 'split' | 'list';
const VIEW_KEY = 'liit.landscape.view';

type EdgeType = 'cites' | 'semantic_similarity';

const EDGE_STYLES: Record<EdgeType, { stroke: string; dasharray?: string; opacity: number; width: number; label: string }> = {
  cites: { stroke: '#a08ecf', opacity: 0.55, width: 1.2, label: 'cites' },
  semantic_similarity: { stroke: '#6b9e8c', dasharray: '4 3', opacity: 0.5, width: 1.2, label: 'semantic similarity' },
};

function layout(nodes: LandscapeNode[]): Placed[] {
  const sorted = [...nodes].sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.id.localeCompare(b.id));
  const n = sorted.length;
  const radius = Math.max(140, n * 46);
  const cx = 500, cy = 340;
  return sorted.map((node, i) => {
    if (n === 1) return { node, x: cx, y: cy };
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return { node, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

function shortLabel(title: string): string[] {
  const words = title.split(/\s+/).filter(Boolean);
  if (!words.length) return ['Untitled'];
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > 22 && current) { lines.push(current.trim()); current = w; }
    else current = `${current} ${w}`;
    if (lines.length === 2) break;
  }
  if (current.trim()) lines.push(current.trim());
  return lines.slice(0, 3);
}

/** Stored cosine value, shown as-is — never relabeled as relevance.*/
function fmtSim(v: number | null): string {
  return v == null ? 'not available' : v.toFixed(4);
}

export default function Landscape({
  projectId, selectedNodeId, onSelectNode, onSelectPaper, onOpenPaper, onGoSearch, refreshToken,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [data, setData] = useState<LandscapeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null);
  const [pinnedEdge, setPinnedEdge] = useState<number | null>(null);
  const [paperDetail, setPaperDetail] = useState<Awaited<ReturnType<typeof api.getPaper>> | null>(null);
  const [detailError, setDetailError] = useState(false);
  /** Truthful state of the automatic one-seed landscape build. */
  const [build, setBuild] = useState<LandscapeStatus | null>(null);
  const [statusEpoch, setStatusEpoch] = useState(0);
  const [retryError, setRetryError] = useState<string | null>(null);
  const lastRunKey = useRef<string | null>(null);

  // Workspace: view choice (persists) + ONE shared filter set.
  const [view, setView] = useState<LandscapeView>(() => {
    if (typeof localStorage === 'undefined') return 'graph';
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'split' || v === 'list' ? v : 'graph';
  });
  const [filters, setFilters] = useState<LandscapeFilters>(DEFAULT_FILTERS);
  /** Checkbox selection for bulk [Add to Project] (List + Split). */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage unavailable */ }
  }, [view]);

  useEffect(() => { setSelectedIds(new Set()); }, [projectId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(() => {
    if (!projectId) { setData({ project_id: '', nodes: [], edges: [] }); return; }
    setError(null);
    let cancelled = false;
    api.landscape(projectId)
      .then(d => { if (!cancelled) { setData(d); } })
      .catch(e => { if (!cancelled) setError(friendlyError(e, 'Landscape')); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(load, [load, refreshToken]);

  // Automatic landscape build status: real step names while running
  // (2s poll), then per-channel outcomes for the error banner. The
  // graph refreshes whenever a run's outcome changes — no fake
  // percentages, only actual backend states.
  useEffect(() => {
    if (!projectId) { setBuild(null); lastRunKey.current = null; return; }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      api.landscapeStatus(projectId)
        .then(s => {
          if (cancelled) return;
          setBuild(s);
          if (s.status === 'running') {
            lastRunKey.current = null;
            timer = setTimeout(tick, 2000);
          } else {
            const key = `${s.status}:${s.updated_at}`;
            if (lastRunKey.current !== key) {
              lastRunKey.current = key;
              load();
            }
            timer = setTimeout(tick, 5000);
          }
        })
        .catch(() => { if (!cancelled) timer = setTimeout(tick, 5000); });
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [projectId, load, statusEpoch]);

  // Paper ingest status comes from the existing GET /papers/{id}.
  useEffect(() => {
    setPinnedEdge(null);
    setHoveredEdge(null);
    if (!selectedNodeId) { setPaperDetail(null); setDetailError(false); return; }
    let cancelled = false;
    setPaperDetail(null);
    setDetailError(false);
    api.getPaper(selectedNodeId)
      .then(p => { if (!cancelled) setPaperDetail(p); })
      .catch(() => { if (!cancelled) setDetailError(true); });
    return () => { cancelled = true; };
  }, [selectedNodeId]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.88 : 1.14;
      const rect = svg.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setTransform(prev => {
        const newScale = Math.max(0.2, Math.min(5, prev.scale * factor));
        const k = newScale / prev.scale;
        return { x: cx - k * (cx - prev.x), y: cy - k * (cy - prev.y), scale: newScale };
      });
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const handleMove = (e: MouseEvent) => {
      setTransform(prev => ({ ...prev, x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y }));
    };
    const handleUp = () => setIsDragging(false);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => { document.removeEventListener('mousemove', handleMove); document.removeEventListener('mouseup', handleUp); };
  }, [isDragging]);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as SVGElement;
    if (target.closest('.graph-node') || target.closest('.graph-edge-hit')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  }, [transform.x, transform.y]);

  // Layout spans ALL nodes so positions stay stable while filtering.
  const placed = useMemo(() => layout(data?.nodes ?? []), [data]);
  const nodeMap = useMemo(() => Object.fromEntries(placed.map(p => [p.node.id, p])), [placed]);
  const titleOf = useCallback((id: string) => nodeMap[id]?.node.title || id, [nodeMap]);

  // ONE filtered + sorted set shared by Graph, List, and Split.
  const filtered = useMemo(
    () => (data ? applyAll(data, filters) : null),
    [data, filters]);
  /** Dynamic facets (years ∪ current year, journal/type/source counts,
   *  semantic-availability) derived from the fetched payload only. */
  const live = useMemo(
    () => deriveFacets(data ?? { project_id: '', nodes: [], edges: [] }),
    [data]);

  const filteredIds = useMemo(
    () => new Set((filtered?.nodes ?? []).map(n => n.id)),
    [filtered]);
  const visibleNodes = useMemo(
    () => placed.filter(p => filteredIds.has(p.node.id)),
    [placed, filteredIds]);
  /** {edge, idx} pairs — idx is the index in data.edges so hover/pin
   * state survives client-side filtering.*/
  const visibleEdges = useMemo(() => filtered?.edges ?? [], [filtered]);
  const visibleEdgeIdxs = useMemo(() => new Set(visibleEdges.map(v => v.idx)), [visibleEdges]);

  /** Parallel separation (px) for edges between the same pair of nodes —
   * e.g. a citation edge and a similarity edge — so neither line is
   * painted over the other and both stay hoverable. The perpendicular is
   * computed once from the canonical (sorted) pair direction: edges store
   * source/target in arbitrary order, and per-edge frames would collapse
   * reversed edges back onto the same line. Keyed by data.edges index so
   * positions are stable across client-side filtering.*/
  const edgeOffsets = useMemo(() => {
    const edges = data?.edges ?? [];
    const groups = new Map<string, number[]>();
    edges.forEach((e, i) => {
      const key = [e.source, e.target].sort().join('|');
      const g = groups.get(key);
      if (g) g.push(i); else groups.set(key, [i]);
    });
    const offsets = new Map<number, [number, number]>();
    const GAP = 12;
    groups.forEach(idxs => {
      if (idxs.length < 2) return;
      const first = edges[idxs[0]];
      const [a, b] = [first.source, first.target].sort();
      const pa = nodeMap[a], pb = nodeMap[b];
      if (!pa || !pb) return;
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const px = -dy / len, py = dx / len;
      idxs.forEach((i, k) => {
        const off = (k - (idxs.length - 1) / 2) * GAP;
        offsets.set(i, [px * off, py * off]);
      });
    });
    return offsets;
  }, [data, nodeMap]);

  const connectedTo = useMemo(() => {
    if (!hoveredId || !data) return new Set<string>();
    const connected = new Set<string>();
    data.edges.forEach(e => {
      if (e.source === hoveredId) connected.add(e.target);
      if (e.target === hoveredId) connected.add(e.source);
    });
    return connected;
  }, [hoveredId, data]);

  const selected = selectedNodeId ? nodeMap[selectedNodeId]?.node ?? null : null;
  /** Relationship panel shows ALL stored relationships of the paper
   * (unfiltered) — counts are facts, not view state. */
  const selectedEdges = useMemo(() => {
    if (!selectedNodeId || !data) return [] as LandscapeEdge[];
    return data.edges.filter(e => e.source === selectedNodeId || e.target === selectedNodeId);
  }, [selectedNodeId, data]);

  /** Hovered wins over pinned; hidden if its edge was filtered out.*/
  const activeEdgeIdx = hoveredEdge != null && visibleEdgeIdxs.has(hoveredEdge)
    ? hoveredEdge
    : pinnedEdge != null && visibleEdgeIdxs.has(pinnedEdge) ? pinnedEdge : null;
  const activeEdge = activeEdgeIdx != null ? data?.edges[activeEdgeIdx] ?? null : null;

  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    (data?.nodes ?? []).forEach(n => m.set(n.id, n.title));
    return m;
  }, [data]);

  /** Seed = the user's uploaded PDF (user_import, or the run's seed). */
  const isSeedNode = (n: LandscapeNode) =>
    (build != null && build.seed_paper_id !== '' && build.seed_paper_id === n.id)
    || n.discovery_source === 'user_import'
    || n.discovery.some(d => d.type === 'user_import');

  const channelErrors = (build?.channels ?? []).flatMap(c =>
    [c.error, ...c.errors].filter(Boolean)
      .map(m => `${c.channel}${c.source ? ` (${c.source})` : ''}: ${m}`));

  const retryDiscovery = () => {
    if (!projectId) return;
    setRetryError(null);
    api.discoverLandscape(projectId, build?.seed_paper_id ?? '')
      .then(s => { setBuild(s); setStatusEpoch(e => e + 1); })
      .catch(e => setRetryError(friendlyError(e, 'Discovery')));
  };

  // Counts header: Landscape / In project / Discovered.
  const total = data?.nodes.length ?? 0;
  const inProjectCount = useMemo(
    () => (data?.nodes ?? []).filter(n => n.in_project).length, [data]);
  const discoveredCount = total - inProjectCount;

  const chips = useMemo(() => activeChips(filters), [filters]);
  const notes = useMemo(
    () => (data ? honestyNotes(data.nodes, filters, filtered?.maxSims ?? new Map()) : []),
    [data, filters, filtered]);

  /** Truthful single-seed states (never "add more papers!"): running →
   * searching; complete → no additional discoveries/relationships. */
  const notice = useMemo(() => {
    if (total !== 1) return [] as string[];
    const lines = ['1 paper in landscape.'];
    if (build?.status === 'running') lines.push('Searching for related literature...');
    else if (build?.status === 'complete') {
      lines.push('1 paper found. No additional discoveries were available.');
      lines.push('No additional relationships were discovered.');
    }
    return lines;
  }, [total, build]);

  // ---- explicit membership actions (discovered → project) ----

  const patchMembership = useCallback((paperId: string, inProject: boolean) => {
    setData(d => (d
      ? { ...d, nodes: d.nodes.map(n => (n.id === paperId ? { ...n, in_project: inProject } : n)) }
      : d));
    setPaperDetail(prev => (prev && prev.id === paperId ? { ...prev, in_project: inProject } : prev));
  }, []);

  const setAdding = (paperId: string, on: boolean) => {
    setAddingIds(prev => {
      const next = new Set(prev);
      if (on) next.add(paperId); else next.delete(paperId);
      return next;
    });
  };

  /** Single [Add to Project]: membership only — provenance, node, and
   * edges preserved; status flips to "✓ In Project" immediately. */
  const addOne = (paperId: string) => {
    if (!projectId) return;
    setAdding(paperId, true);
    api.addToCollection(projectId, paperId)
      .then(p => patchMembership(paperId, p.in_project))
      .catch(e => setToast({ kind: 'error', text: friendlyError(e, 'Add to project') }))
      .finally(() => setAdding(paperId, false));
  };

  /** Remove membership only — the paper stays in the Landscape with
   * every relationship intact (discovery is never destroyed here). */
  const removeOne = (paperId: string) => {
    if (!projectId) return;
    setAdding(paperId, true);
    api.removeFromCollection(projectId, paperId)
      .then(p => patchMembership(paperId, p.in_project))
      .catch(e => setToast({ kind: 'error', text: friendlyError(e, 'Remove from project') }))
      .finally(() => setAdding(paperId, false));
  };

  const addableIds = useMemo(
    () => [...selectedIds].filter(id => {
      const n = (data?.nodes ?? []).find(x => x.id === id);
      return Boolean(n && !n.in_project);
    }),
    [selectedIds, data]);

  /** Bulk [Add to Project]: "7 papers added to <project>." */
  const addSelected = () => {
    if (!projectId || addableIds.length === 0) return;
    setBulkBusy(true);
    api.bulkAddToCollection(projectId, addableIds)
      .then(res => {
        const addedIds = addableIds.filter(id => !res.not_found.includes(id));
        setData(d => (d
          ? { ...d, nodes: d.nodes.map(n => (addedIds.includes(n.id) ? { ...n, in_project: true } : n)) }
          : d));
        let text = res.added > 0
          ? `${res.added} paper${res.added === 1 ? '' : 's'} added to ${res.project_name}.`
          : `No papers added — ${res.already_in_project} already in ${res.project_name}.`;
        if (res.not_found.length > 0) text += ` ${res.not_found.length} not found.`;
        setToast({ kind: 'ok', text });
        setSelectedIds(new Set());
      })
      .catch(e => setToast({ kind: 'error', text: friendlyError(e, 'Add to project') }))
      .finally(() => setBulkBusy(false));
  };

  const patchFilters = (patch: Partial<LandscapeFilters>) =>
    setFilters(f => ({ ...f, ...patch }));

  const onSortHeader = (key: SortKey) =>
    setFilters(f => (f.sort === key
      ? { ...f, dir: f.dir === 'asc' ? 'desc' : 'asc' }
      : { ...f, sort: key, dir: DEFAULT_DIR[key] }));

  const toggleSelect = (id: string) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds(prev => {
      const rows = filtered?.nodes ?? [];
      const all = rows.length > 0 && rows.every(n => prev.has(n.id));
      if (all) return new Set();
      return new Set(rows.map(n => n.id));
    });

  if (!projectId) return <Empty title="No project selected" />;
  if (error) return <Err message={error} onRetry={load} />;
  if (!data) return <Loading text="Loading landscape…" />;
  if (data.nodes.length === 0) {
    return (
      <div data-testid="landscape-empty" className="flex-1 flex flex-col overflow-hidden">
        <Empty
          title="Add a seed paper to begin exploring the research landscape."
          hint="Upload a seed PDF — first-degree discovery (references, cited-by, semantic similarity) runs automatically."
          action={
            <button onClick={onGoSearch} className="text-[11.5px] px-3 py-1.5 rounded"
              style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-lavender)' }}>
              Search literature →
            </button>
          }
        />
      </div>
    );
  }

  const edgeOf = (e: LandscapeEdge) => EDGE_STYLES[e.relationship as EdgeType] ?? EDGE_STYLES.semantic_similarity;
  const summaryText = `${filtered ? filtered.nodes.length : 0} of ${data.nodes.length} papers`;

  const detailCard = (variant: 'compact' | 'full') => (
    selected ? (
      <PaperDetailCard
        node={selected}
        edges={selectedEdges}
        titleOf={titleOf}
        paperDetail={paperDetail}
        detailError={detailError}
        isSeed={isSeedNode(selected)}
        variant={variant}
        onOpenPaper={onOpenPaper}
        onAdd={addOne}
        onRemove={removeOne}
        adding={addingIds.has(selected.id)} />
    ) : null
  );

  const bulkBar = view !== 'graph' && selectedIds.size > 0 ? (
    <div data-testid="landscape-bulk-bar"
      className="flex items-center gap-3 px-3 py-2 border-b shrink-0 flex-wrap"
      style={{ borderColor: 'var(--color-edge)', background: 'var(--color-panel)' }}>
      <span className="text-[11.5px]" style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>
        {selectedIds.size} selected · {addableIds.length} not yet in project
      </span>
      <button onClick={addSelected} disabled={bulkBusy || addableIds.length === 0}
        data-testid="landscape-bulk-add"
        className="text-[11.5px] px-2.5 py-1 rounded transition-colors"
        style={{
          background: addableIds.length > 0 && !bulkBusy ? 'var(--color-lav-dim)' : 'transparent',
          color: addableIds.length > 0 || bulkBusy ? 'var(--color-lav-light)' : 'var(--color-muted)',
          border: '1px solid var(--color-edge)',
        }}>
        {bulkBusy ? 'Adding…' : 'Add selected to project'}
      </button>
      <button onClick={() => setSelectedIds(new Set())} data-testid="landscape-bulk-clear"
        className="text-[11px] px-2 py-1 rounded"
        style={{ border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}>
        Clear selection
      </button>
    </div>
  ) : null;

  const table = (
    <PaperTable
      nodes={filtered?.nodes ?? []}
      maxSims={filtered?.maxSims ?? new Map()}
      selectedId={selectedNodeId}
      onSelect={id => { onSelectNode(id); onSelectPaper(id); }}
      selectedIds={selectedIds}
      onToggleSelect={toggleSelect}
      onToggleAll={toggleAll}
      onAdd={addOne}
      addingIds={addingIds}
      onOpen={onOpenPaper}
      sort={filters.sort}
      dir={filters.dir}
      onSortHeader={onSortHeader} />
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Workspace toolbar: persistent view switcher + counts header. */}
      <div className="flex items-center gap-3 px-3 py-2 border-b shrink-0 flex-wrap"
        style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}
        data-testid="landscape-toolbar">
        <div className="flex items-center gap-1">
          {([['graph', 'Graph'], ['split', 'Split'], ['list', 'List']] as [LandscapeView, string][])
            .map(([v, label]) => (
              <button key={v} data-testid={`landscape-view-${v}`} onClick={() => setView(v)}
                className="text-[11.5px] px-2.5 py-1 rounded transition-colors"
                style={view === v
                  ? { background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-lavender)' }
                  : { color: 'var(--color-muted)', border: '1px solid transparent' }}>
                {label}
              </button>
            ))}
        </div>
        <div data-testid="landscape-counts" className="text-[11px]"
          style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>
          Landscape {total} · In project {inProjectCount} · Discovered {discoveredCount}
        </div>
        <div className="flex-1" />
        {toast && (
          <div data-testid={toast.kind === 'ok' ? 'landscape-toast' : 'landscape-toast-error'}
            className="text-[11.5px] px-2.5 py-1 rounded"
            style={{
              background: 'rgba(35,34,47,0.95)',
              border: `1px solid ${toast.kind === 'ok' ? 'var(--color-teal)' : 'var(--color-rose)'}`,
              color: toast.kind === 'ok' ? 'var(--color-teal)' : 'var(--color-rose)',
            }}>
            {toast.text}
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Main area: the active view over the SAME filtered set. */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {view === 'graph' ? (
            <div className="flex-1 relative overflow-hidden" style={{ background: 'var(--color-bg)' }}>
              <svg ref={svgRef} className="graph-area w-full h-full" onMouseDown={handleSvgMouseDown}>
                <defs>
                  <marker id="arrow-cites" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="#a08ecf" opacity="0.5" />
                  </marker>
                </defs>
                <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
                  {visibleEdges.map(({ edge, idx }) => {
                    const src = nodeMap[edge.source];
                    const tgt = nodeMap[edge.target];
                    if (!src || !tgt) return null;
                    const style = edgeOf(edge);
                    const dx = tgt.x - src.x;
                    const dy = tgt.y - src.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    const r = 14;
                    const ex = tgt.x - (dx / dist) * (r + 3);
                    const ey = tgt.y - (dy / dist) * (r + 3);
                    const onNode = hoveredId && (edge.source === hoveredId || edge.target === hoveredId);
                    const isActive = activeEdgeIdx === idx;
                    const isDimmed = (hoveredId && !onNode) || (activeEdgeIdx != null && !isActive);
                    const o = edgeOffsets.get(idx);
                    const ox = o ? o[0] : 0;
                    const oy = o ? o[1] : 0;
                    return (
                      <g key={`${edge.source}-${edge.target}-${edge.relationship}-${idx}`}>
                        <line
                          x1={src.x + ox} y1={src.y + oy} x2={ex + ox} y2={ey + oy}
                          className="edge-line"
                          stroke={style.stroke} strokeWidth={style.width * ((onNode || isActive) ? 2 : 1)}
                          strokeDasharray={style.dasharray}
                          opacity={isDimmed ? 0.1 : isActive ? style.opacity * 1.8 : style.opacity * ((onNode ?? false) ? 1.6 : 1)}
                          markerEnd={edge.relationship === 'cites' ? 'url(#arrow-cites)' : undefined}
                          style={{ transition: 'opacity 0.15s', pointerEvents: 'none' }} />
                        {/* Wide transparent hit area so thin edges are hoverable/clickable. */}
                        <line
                          x1={src.x + ox} y1={src.y + oy} x2={ex + ox} y2={ey + oy}
                          className="graph-edge-hit" data-rel={edge.relationship}
                          stroke="transparent" strokeWidth={14}
                          style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                          onMouseEnter={() => setHoveredEdge(idx)}
                          onMouseLeave={() => setHoveredEdge(null)}
                          onClick={() => setPinnedEdge(prev => (prev === idx ? null : idx))} />
                      </g>
                    );
                  })}
                  {visibleNodes.map(({ node, x, y }) => {
                    const isSelected = node.id === selectedNodeId;
                    const isHovered = node.id === hoveredId;
                    const isConnected = connectedTo.has(node.id);
                    const isDimmed = hoveredId && node.id !== hoveredId && !isConnected;
                    const isSeed = isSeedNode(node);
                    const lines = shortLabel(node.title);
                    return (
                      <g key={node.id} className="graph-node" style={{ cursor: 'pointer', opacity: isDimmed ? 0.25 : 1, transition: 'opacity 0.15s' }}
                        data-in-project={node.in_project ? '1' : '0'}
                        onMouseEnter={() => setHoveredId(node.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => { setPinnedEdge(null); onSelectNode(node.id); onSelectPaper(node.id); }}>
                        <circle cx={x} cy={y} r={14 + (isSelected || isHovered ? 2 : 0)}
                          fill={isSelected ? 'rgba(160,142,207,0.25)' : isHovered ? 'rgba(160,142,207,0.15)' : 'rgba(43,41,57,0.9)'}
                          stroke={isSelected ? '#c0adf0' : isHovered ? '#a08ecf' : isSeed ? '#6b9e8c' : isConnected ? '#a08ecf' : node.in_project ? '#3c3952' : '#8a6d2f'}
                          strokeWidth={isSelected ? 2 : isSeed ? 1.6 : 1.2}
                          strokeDasharray={!node.in_project && !isSelected && !isSeed ? '3 2' : undefined}
                          style={{ transition: 'all 0.12s' }} />
                        <text x={x} y={y + 3} textAnchor="middle" fontSize="8" fill={isSelected ? '#c0adf0' : '#928ea8'}
                          fontFamily="Inter, sans-serif" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                          {node.year ?? ''}
                        </text>
                        {lines.map((line, li) => (
                          <text key={li} x={x} y={y + 28 + li * 12}
                            textAnchor="middle" fontSize="9.5" fill={isSelected ? '#c0adf0' : isHovered ? '#a08ecf' : '#928ea8'}
                            fontFamily="Inter, sans-serif" style={{ userSelect: 'none', pointerEvents: 'none' }}>
                            {line}
                          </text>
                        ))}
                      </g>
                    );
                  })}
                </g>
              </svg>

              {/* Automatic build: truthful busy state while running (real step
                  names, 2s poll) — never a fabricated percentage. */}
              {build?.status === 'running' && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded text-[11.5px]"
                  style={{ background: 'rgba(35,34,47,0.95)', border: '1px solid var(--color-teal)', color: 'var(--color-sub)' }}
                  data-testid="landscape-building">
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--color-teal)' }} />
                  Building landscape… {build.step || 'starting'}
                </div>
              )}

              {/* Existing papers whose automatic build never ran (the seed
                  entered before the trigger existed, or via an explicit
                  import): a clearly-labelled, explicit action — no silent
                  re-trigger, no fabricated state. */}
              {build && build.status === 'idle' && data.nodes.length > 0 && !retryError && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-3 px-3 py-1.5 rounded text-[11.5px]"
                  style={{ background: 'rgba(35,34,47,0.95)', border: '1px solid var(--color-edge)' }}
                  data-testid="landscape-idle-discovery">
                  <span style={{ color: 'var(--color-sub)' }}>
                    Automatic discovery has not run for these papers yet.
                  </span>
                  <button onClick={retryDiscovery}
                    className="text-[11px] px-2.5 py-1 rounded"
                    style={{ border: '1px solid var(--color-lav)', color: 'var(--color-lav)' }}>
                    Retry discovery
                  </button>
                </div>
              )}

              {/* Post-build: per-channel discovery errors surfaced verbatim,
                  with an explicit Retry (same bounded first-degree run). */}
              {build && build.status !== 'running'
                && (channelErrors.length > 0 || Boolean(build.error) || Boolean(retryError)) && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 max-w-[560px] p-2.5 rounded text-[11.5px] leading-snug"
                  style={{ background: 'rgba(35,34,47,0.97)', border: '1px solid var(--color-amber)' }}
                  data-testid="landscape-channel-errors">
                  <div className="font-medium mb-1" style={{ color: 'var(--color-amber)' }}>
                    {build.error ? 'Landscape build failed.'
                      : channelErrors.length > 0 ? 'Discovery finished with channel errors — results are partial.'
                      : 'Retry could not be started.'}
                  </div>
                  {build.error && <div style={{ color: 'var(--color-sub)' }}>{build.error}</div>}
                  {retryError && <div style={{ color: 'var(--color-sub)' }}>{retryError}</div>}
                  {channelErrors.length > 0 && (
                    <ul className="mt-1 mb-1.5 space-y-0.5" style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>
                      {channelErrors.slice(0, 4).map((m, i) => <li key={i} className="break-words">{m}</li>)}
                      {channelErrors.length > 4 && <li>… and {channelErrors.length - 4} more</li>}
                    </ul>
                  )}
                  <button onClick={retryDiscovery}
                    className="text-[11px] px-2.5 py-1 rounded"
                    style={{ border: '1px solid var(--color-amber)', color: 'var(--color-amber)' }}>
                    Retry discovery
                  </button>
                </div>
              )}

              <div className="absolute top-3 left-3 flex items-center gap-2">
                <button onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}
                  className="text-[11px] px-2.5 py-1.5 rounded flex items-center gap-1.5 transition-colors"
                  style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-ink)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-muted)')}>
                  Reset view
                </button>
                <div className="text-[10px] px-2 py-1.5 rounded" style={{ background: 'var(--color-panel)', border: '1px solid var(--color-edge)', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                  ×{transform.scale.toFixed(2)}
                </div>
              </div>

              {/* What the hovered/pinned edge actually represents — backend
                  relationship data only. */}
              {activeEdge && (
                <div className="edge-explanation absolute top-3 right-3 max-w-[340px] p-2.5 rounded text-[11.5px] leading-snug break-words"
                  style={{ background: 'rgba(35,34,47,0.95)', border: '1px solid var(--color-edge)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <svg width="20" height="6">
                      <line x1="0" y1="3" x2="20" y2="3" stroke={edgeOf(activeEdge).stroke}
                        strokeWidth="1.8" strokeDasharray={edgeOf(activeEdge).dasharray} opacity="0.75" />
                    </svg>
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                      {edgeOf(activeEdge).label}
                    </span>
                  </div>
                  {activeEdge.relationship === 'cites' ? (
                    <>
                      <div style={{ color: 'var(--color-sub)' }}>
                        {titleOf(activeEdge.source)} cites {titleOf(activeEdge.target)}
                      </div>
                      {activeEdge.mechanism && (
                        <div className="mt-0.5" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                          via {activeEdge.mechanism}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ color: 'var(--color-sub)' }}>Semantic similarity: {fmtSim(activeEdge.similarity)}</div>
                      <div className="mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        {titleOf(activeEdge.source)} ↔ {titleOf(activeEdge.target)}
                      </div>
                    </>
                  )}
                  {pinnedEdge === activeEdgeIdx && (
                    <div className="mt-1 text-[10px]" style={{ color: 'var(--color-muted)' }}>Pinned — click the edge again to dismiss.</div>
                  )}
                </div>
              )}

              {data.nodes.length > 0 && visibleNodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-[12.5px] px-3 py-2 rounded" style={{ color: 'var(--color-sub)', background: 'rgba(35,34,47,0.95)', border: '1px solid var(--color-edge)' }}>
                    No papers match the current filters.
                  </div>
                </div>
              )}

              <div className="absolute bottom-3 left-3 text-[10px] flex flex-col gap-1.5 p-2.5 rounded" style={{ background: 'rgba(35,34,47,0.9)', border: '1px solid var(--color-edge)' }}>
                {(Object.keys(EDGE_STYLES) as EdgeType[]).map(t => (
                  <div key={t} className="flex items-center gap-2">
                    <svg width="20" height="6">
                      <line x1="0" y1="3" x2="20" y2="3" stroke={EDGE_STYLES[t].stroke} strokeWidth="1.8" strokeDasharray={EDGE_STYLES[t].dasharray} opacity="0.75" />
                    </svg>
                    <span style={{ color: 'var(--color-muted)' }}>{EDGE_STYLES[t].label}</span>
                  </div>
                ))}
                <div className="pt-1 border-t flex items-center gap-2" style={{ borderColor: 'var(--color-edge)' }}>
                  <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="none" stroke="var(--color-teal)" strokeWidth="1.2" /></svg>
                  <span style={{ color: 'var(--color-muted)' }}>in project</span>
                </div>
                <div className="flex items-center gap-2">
                  <svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="none" stroke="#8a6d2f" strokeWidth="1.2" strokeDasharray="2.5 2" /></svg>
                  <span style={{ color: 'var(--color-muted)' }}>discovered (not in project)</span>
                </div>
              </div>
            </div>
          ) : view === 'split' ? (
            <>
              {bulkBar}
              <div className="flex flex-1 min-h-0">
                <div className="w-[55%] min-w-0 overflow-auto border-r" style={{ borderColor: 'var(--color-edge)' }}>
                  {table}
                </div>
                <div className="flex-1 min-w-0 overflow-y-auto">
                  {detailCard('full') ?? (
                    <div className="p-3 text-[11.5px]" style={{ color: 'var(--color-muted)' }}>
                      Click a paper to see details.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {bulkBar}
              <div className="flex-1 overflow-auto">
                {table}
              </div>
            </>
          )}
        </main>

        {/* Shared sidebar: ONE filter panel for every view (+ the graph
            node detail when the Graph view is active). */}
        <aside className="w-[272px] shrink-0 flex flex-col border-l overflow-hidden"
          style={{ borderColor: 'var(--color-edge)', background: 'var(--color-surface)' }}>
          <div className="max-h-[58%] overflow-y-auto shrink-0">
            <FilterPanel
              facets={live}
              filters={filters}
              onChange={patchFilters}
              onClear={() => setFilters(f => clearedFilters(f))}
              visibleNodes={visibleNodes.length}
              visibleEdges={visibleEdges.length}
              summary={summaryText}
              chips={chips}
              notes={notes}
              notice={notice} />
          </div>
          <div className="flex-1 overflow-y-auto">
            {view === 'graph' && (detailCard('compact') ?? (
              <div className="p-3 text-[11.5px]" style={{ color: 'var(--color-muted)' }}>
                Click a node to see details. Hover or click an edge to see what it represents.
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
