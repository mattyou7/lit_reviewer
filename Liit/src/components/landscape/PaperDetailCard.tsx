/**Selected-paper detail — one component for the Graph sidebar
 * (compact) and the Split view (full). Shows exactly what the backend
 * stores: metadata, identifiers, project membership with the explicit
 * [Add to Project] action, provenance ("Discovered through"),
 * relationships, plus truthful unavailable states (citation count,
 * retraction status, publication type) — never invented values.*/
import type { CSSProperties } from 'react';
import type { ApiPaper, DiscoveryItem, LandscapeEdge, LandscapeNode } from '../../lib/api';
import { StatusChip } from '../../lib/states';
import {
  citationLabel, freeFullTextUrl, retractionLabel, sourceLabel,
} from '../../lib/landscapeFilter';

interface Props {
  node: LandscapeNode;
  /** All edges touching this node (unfiltered relationships). */
  edges: LandscapeEdge[];
  titleOf: (id: string) => string;
  paperDetail: ApiPaper | null;
  detailError: boolean;
  isSeed: boolean;
  variant: 'compact' | 'full';
  onOpenPaper: (id: string) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  adding: boolean;
}

/** Stored cosine value, shown as-is — never relabeled as relevance.*/
function fmtSim(v: number | null): string {
  return v == null ? 'not available' : v.toFixed(4);
}

function clip(title: string, n: number): string {
  return title.length > n ? `${title.slice(0, n - 1)}…` : title;
}

/** Honest provenance wording: which discovery route found this paper,
 * through which database. Never "recommended" / "relevant". */
function routeLabel(d: DiscoveryItem): string {
  if (d.type === 'citation_discovery') return 'reference lookup';
  if (d.type === 'cited_by_discovery') return 'PubMed cited-by';
  if (d.type === 'semantic_discovery') {
    const db = d.source === 'pubmed' ? 'PubMed' : d.source === 'arxiv' ? 'arXiv' : d.source;
    return `semantic search (${db || 'unknown source'})`;
  }
  if (d.source === 'pubmed') return 'PubMed';
  if (d.source === 'arxiv') return 'arXiv';
  return d.type;
}

const labelStyle: CSSProperties = {
  fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--color-muted)',
};

export default function PaperDetailCard({
  node, edges, titleOf, paperDetail, detailError, isSeed, variant,
  onOpenPaper, onAdd, onRemove, adding,
}: Props) {
  const full = variant === 'full';
  const freeUrl = freeFullTextUrl(node);
  const localText = !node.metadata_only;
  const retraction = retractionLabel(node.retracted);
  const citesOut = edges.filter(e => e.relationship === 'cites' && e.source === node.id).length;
  const citesIn = edges.filter(e => e.relationship === 'cites' && e.target === node.id).length;
  const sims = edges.filter(e => e.relationship === 'semantic_similarity').length;

  return (
    <div className="p-3" data-testid={full ? 'landscape-detail' : 'landscape-detail-compact'}>
      <div className="mb-2" style={labelStyle}>Selected paper</div>
      <div className="font-medium leading-snug mb-2"
        style={{ fontSize: full ? '14px' : '12.5px', fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
        {node.title || 'Untitled'}
      </div>
      <div className="text-[11px] mb-1" style={{ color: 'var(--color-muted)' }}>
        {(node.authors.slice(0, 2).join(', ') || 'Authors not available')}{node.authors.length > 2 ? ' +' + (node.authors.length - 2) : ''} · {node.year ?? 'Year not available'}
      </div>
      <div className="text-[11px] mb-1" style={{ color: 'var(--color-muted)' }}>
        {node.journal || 'Journal not available'}
      </div>
      <div className="text-[11px] mb-2" style={{ color: 'var(--color-muted)' }}>
        {[node.doi && `DOI ${node.doi}`, node.pmid && `PMID ${node.pmid}`, node.arxiv_id && `arXiv ${node.arxiv_id}`].filter(Boolean).join(' · ') || 'No identifiers'}
      </div>

      {/* Full-view metadata rows: citation / full text / retraction /
          publication type — each with an honest unavailable state. */}
      {full && (
        <div className="mb-2 space-y-0.5 text-[11.5px]" style={{ color: 'var(--color-sub)' }}>
          <div data-testid="landscape-citations">{citationLabel(node)}</div>
          <div data-testid="landscape-fulltext" className="flex items-center gap-2 flex-wrap">
            {freeUrl && (
              <a href={freeUrl} target="_blank" rel="noreferrer"
                className="underline" style={{ color: 'var(--color-teal)' }}>
                Free full text
              </a>
            )}
            {localText && <span style={{ color: 'var(--color-sub)' }}>Full text available</span>}
            {node.metadata_only && <span style={{ color: 'var(--color-amber)' }}>Metadata only</span>}
            {!freeUrl && !localText && !node.metadata_only && <span>Full text status unavailable</span>}
          </div>
          <div data-testid="landscape-retraction"
            style={{ color: retraction.tone === 'danger' ? 'var(--color-rose)'
              : retraction.tone === 'ok' ? 'var(--color-sub)' : 'var(--color-muted)' }}>
            {retraction.text}
          </div>
          <div data-testid="landscape-pubtypes">
            Publication type: {(node.pub_types ?? []).length > 0
              ? node.pub_types.join(' · ')
              : <span style={{ color: 'var(--color-muted)' }}>unavailable</span>}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {isSeed && (
          <span className="text-[10.5px] px-1.5 py-0.5 rounded"
            style={{ border: '1px solid var(--color-teal)', color: 'var(--color-teal)' }}>
            seed paper
          </span>
        )}
        {paperDetail ? <StatusChip status={paperDetail.extraction_status} />
          : detailError ? <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>status unavailable</span>
          : <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>loading status…</span>}
        <span className="text-[10.5px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
          embedding: {node.embedding_status}
        </span>
        {node.metadata_only && (
          <span className="text-[10.5px]" style={{ color: 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>metadata only</span>
        )}
      </div>

      {/* Project membership: discovered != added. Explicit action only —
          adding never duplicates the node or its relationships. */}
      <div className="flex items-center gap-2 mb-2.5 flex-wrap" data-testid="landscape-membership">
        {node.in_project ? (
          <>
            <span data-testid="landscape-in-project" className="text-[10.5px] px-1.5 py-0.5 rounded"
              style={{ border: '1px solid var(--color-teal)', color: 'var(--color-teal)' }}>
              ✓ In Project
            </span>
            <button onClick={() => onRemove(node.id)} disabled={adding}
              data-testid="landscape-remove"
              className="text-[10.5px] px-1.5 py-0.5 rounded transition-colors"
              style={{ border: '1px solid var(--color-edge)', color: 'var(--color-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-rose)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}
              title="Removes project membership only — the paper stays in the Landscape.">
              Remove from project
            </button>
          </>
        ) : (
          <>
            <span data-testid="landscape-discovered" className="text-[10.5px] px-1.5 py-0.5 rounded"
              style={{ border: '1px dashed var(--color-amber)', color: 'var(--color-amber)' }}>
              Discovered
            </span>
            <button onClick={() => onAdd(node.id)} disabled={adding}
              data-testid="landscape-add-to-project"
              className="text-[11px] px-2 py-1 rounded transition-colors"
              style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
              {adding ? 'Adding…' : '+ Add to Project'}
            </button>
          </>
        )}
      </div>

      {full && node.abstract && (
        <div className="mb-3 text-[11.5px] leading-relaxed whitespace-pre-line"
          style={{ color: 'var(--color-sub)', maxHeight: '180px', overflowY: 'auto' }}
          data-testid="landscape-abstract">
          {node.abstract}
        </div>
      )}

      <div className="mb-2">
        <div className="mb-1" style={labelStyle}>Discovered through</div>
        {node.discovery.length > 0 ? node.discovery.map((d, i) => (
          <div key={i} className="text-[11px] leading-snug py-0.5 break-words" style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>
            {d.type}
            {d.query && <span style={{ color: 'var(--color-muted)' }}> · "{d.query}"</span>}
            {d.external_id && <span style={{ color: 'var(--color-muted)' }}> · {d.external_id}</span>}
            {d.source_paper_id && (
              <div className="text-[10.5px]" style={{ color: 'var(--color-muted)' }}>
                via {routeLabel(d)} · from “{titleOf(d.source_paper_id) || 'the seed paper'}”
              </div>
            )}
          </div>
        )) : (
          <div className="text-[11px]" style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>
            {node.discovery_source ? `${node.discovery_source} (${sourceLabel(node.discovery_source)})` : 'unknown'}
          </div>
        )}
      </div>

      {node.concepts.length > 0 && (
        <div className="text-[11px] mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Concepts: <span style={{ color: 'var(--color-sub)' }}>{node.concepts.slice(0, 6).join(', ')}</span>
        </div>
      )}
      {node.methods.length > 0 && (
        <div className="text-[11px] mb-3" style={{ color: 'var(--color-muted)' }}>
          Methods: <span style={{ color: 'var(--color-sub)' }}>{node.methods.slice(0, 6).join(', ')}</span>
        </div>
      )}

      <div className="mb-3">
        <div className="mb-1" style={labelStyle}>Relationships</div>
        <div data-testid="landscape-rel-counts" className="text-[10.5px] mb-1"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
          Cites {citesOut} paper{citesOut === 1 ? '' : 's'} · Cited by {citesIn} · Semantic similarity {sims}
        </div>
        {edges.length === 0 && (
          <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>No relationships yet.</div>
        )}
        {edges.map((e, i) => (
          <div key={i} className="text-[11px] py-0.5 leading-snug break-words" style={{ color: 'var(--color-sub)' }}>
            {e.relationship === 'cites'
              ? (e.source === node.id
                ? <>cites → {clip(titleOf(e.target), 48)}</>
                : <>← cited by {clip(titleOf(e.source), 48)}</>)
              : <>semantic similarity {fmtSim(e.similarity)} ↔ {clip(titleOf(e.source === node.id ? e.target : e.source), 40)}</>}
          </div>
        ))}
      </div>

      <button onClick={() => onOpenPaper(node.id)}
        className="w-full text-center text-[11.5px] py-1.5 rounded transition-colors"
        style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
        Open Paper →
      </button>
    </div>
  );
}
