/**Dense, sortable paper table shared by the List and Split views.
 * One checkbox column enables bulk [Add to Project]; the Status column
 * carries the explicit per-paper action (discovered → "+ Add to
 * Project", member → "✓ In Project"). Columns show only stored
 * metadata — citation counts read "Citation count unavailable" rather
 * than 0, and similarity appears only where a semantic score exists.*/
import type { CSSProperties, ReactElement } from 'react';
import type { LandscapeNode } from '../../lib/api';
import type { SortKey } from '../../lib/landscapeFilter';
import {
  citationLabel, fullTextLabel, freeFullTextUrl, provenanceTypes,
  sourceLabel,
} from '../../lib/landscapeFilter';

interface Props {
  nodes: LandscapeNode[];
  maxSims: Map<string, number>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onAdd: (id: string) => void;
  addingIds: Set<string>;
  onOpen: (id: string) => void;
  sort: SortKey;
  dir: 'asc' | 'desc';
  /** Header click: same key flips direction, new key takes its default. */
  onSortHeader: (key: SortKey) => void;
}

const TH: CSSProperties = {
  fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--color-muted)', textAlign: 'left', padding: '6px 8px',
  borderBottom: '1px solid var(--color-edge)', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, background: 'var(--color-surface)', zIndex: 1,
};

function sortTh(key: SortKey, label: string, sort: SortKey, dir: string,
  onClick: (k: SortKey) => void): ReactElement {
  const active = sort === key;
  return (
    <th style={{ ...TH, cursor: 'pointer', color: active ? 'var(--color-lav-light)' : TH.color }}
      onClick={() => onClick(key)} data-testid={`landscape-sort-${key}`}>
      {label}{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

export default function PaperTable({
  nodes, maxSims, selectedId, onSelect, selectedIds, onToggleSelect,
  onToggleAll, onAdd, addingIds, onOpen, sort, dir, onSortHeader,
}: Props) {
  const allSelected = nodes.length > 0 && nodes.every(n => selectedIds.has(n.id));

  if (nodes.length === 0) {
    return (
      <div className="p-6 text-center text-[12.5px]" style={{ color: 'var(--color-sub)' }}>
        No papers match the current filters.
      </div>
    );
  }

  return (
    <table className="w-full border-collapse" data-testid="landscape-list"
      style={{ fontSize: '11.5px' }}>
      <thead>
        <tr>
          <th style={{ ...TH, width: '30px' }}>
            <input type="checkbox" checked={allSelected} onChange={onToggleAll}
              data-testid="landscape-select-all"
              style={{ accentColor: 'var(--color-lavender)' }} />
          </th>
          {sortTh('title', 'Paper', sort, dir, onSortHeader)}
          {sortTh('journal', 'Journal · Year', sort, dir, onSortHeader)}
          <th style={TH}>Identifiers</th>
          <th style={TH}>Pub type</th>
          <th style={TH}>Full text</th>
          {sortTh('citation_count', 'Citations', sort, dir, onSortHeader)}
          <th style={TH}>Discovered via</th>
          {sortTh('similarity', 'Similarity', sort, dir, onSortHeader)}
          <th style={TH}>Status</th>
          <th style={TH}>Open</th>
        </tr>
      </thead>
      <tbody>
        {nodes.map(n => {
          const ft = fullTextLabel(n);
          const sim = maxSims.get(n.id) ?? null;
          const selected = n.id === selectedId;
          const adding = addingIds.has(n.id);
          return (
            <tr key={n.id} data-testid="landscape-row" data-paper-id={n.id}
              onClick={() => onSelect(n.id)}
              style={{
                cursor: 'pointer',
                background: selected ? 'rgba(160,142,207,0.10)' : 'transparent',
                borderBottom: '1px solid var(--color-edge)',
              }}>
              <td style={{ padding: '6px 8px', verticalAlign: 'top' }}
                onClick={e => e.stopPropagation()}>
                <input type="checkbox" data-testid="landscape-row-select"
                  data-paper-id={n.id}
                  checked={selectedIds.has(n.id)}
                  onChange={() => onToggleSelect(n.id)}
                  style={{ accentColor: 'var(--color-lavender)' }} />
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', minWidth: '260px', maxWidth: '420px' }}>
                <div className="font-medium leading-snug"
                  style={{ fontFamily: 'var(--font-serif)', color: 'var(--color-ink)' }}>
                  {n.title || 'Untitled'}
                </div>
                <div className="leading-snug" style={{ color: 'var(--color-muted)', fontSize: '10.5px' }}>
                  {(n.authors.slice(0, 3).join(', ') || 'Authors not available')}{n.authors.length > 3 ? ` +${n.authors.length - 3}` : ''}
                </div>
                {n.abstract && (
                  <div className="leading-snug mt-0.5"
                    style={{ color: 'var(--color-sub)', fontSize: '10.5px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {n.abstract}
                  </div>
                )}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', minWidth: '150px' }}>
                <div className="leading-snug" style={{ color: 'var(--color-sub)' }}>
                  {n.journal || <span style={{ color: 'var(--color-muted)' }}>Journal not available</span>}
                </div>
                <div style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: '10.5px' }}>
                  {n.year ?? 'Year not available'}
                </div>
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', fontFamily: 'var(--font-mono)', fontSize: '10.5px', color: 'var(--color-sub)' }}>
                <div>{n.doi && `DOI ${n.doi}`}</div>
                <div>{n.pmid && `PMID ${n.pmid}`}</div>
                <div>{n.arxiv_id && `arXiv ${n.arxiv_id}`}</div>
                {!n.doi && !n.pmid && !n.arxiv_id && <span style={{ color: 'var(--color-muted)' }}>No identifiers</span>}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', fontSize: '10.5px', color: 'var(--color-sub)' }}>
                {(n.pub_types ?? []).length > 0 ? n.pub_types.join(', ')
                  : <span style={{ color: 'var(--color-muted)' }}>Publication type unavailable</span>}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', fontSize: '10.5px' }}>
                {ft.free && (
                  <a href={freeFullTextUrl(n)} target="_blank" rel="noreferrer"
                    className="underline block" style={{ color: 'var(--color-teal)' }}>Free full text</a>
                )}
                {ft.local && <span style={{ color: 'var(--color-sub)' }}>Full text available</span>}
                {ft.meta && <span style={{ color: 'var(--color-amber)' }}>Metadata only</span>}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', fontSize: '10.5px', whiteSpace: 'nowrap' }}>
                <span style={{ color: n.citation_count == null ? 'var(--color-muted)' : 'var(--color-sub)' }}>
                  {citationLabel(n)}
                </span>
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', fontSize: '10.5px', fontFamily: 'var(--font-mono)', color: 'var(--color-sub)' }}>
                {provenanceTypes(n).map(sourceLabel).join(', ') || 'unknown'}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', fontSize: '10.5px', fontFamily: 'var(--font-mono)', color: 'var(--color-sub)' }}>
                {sim != null ? sim.toFixed(4) : <span style={{ color: 'var(--color-muted)' }}>—</span>}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}
                onClick={e => e.stopPropagation()}>
                {n.in_project ? (
                  <span data-testid="landscape-in-project" className="text-[10.5px] px-1.5 py-0.5 rounded inline-block"
                    style={{ border: '1px solid var(--color-teal)', color: 'var(--color-teal)' }}>
                    ✓ In Project
                  </span>
                ) : (
                  <div className="flex flex-col items-start gap-1">
                    <span data-testid="landscape-discovered" className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ border: '1px dashed var(--color-amber)', color: 'var(--color-amber)' }}>
                      Discovered
                    </span>
                    <button onClick={() => onAdd(n.id)} disabled={adding}
                      data-testid="landscape-add-to-project"
                      data-paper-id={n.id}
                      className="text-[10.5px] px-1.5 py-0.5 rounded transition-colors"
                      style={{ background: 'var(--color-lav-dim)', color: 'var(--color-lav-light)', border: '1px solid var(--color-edge)' }}>
                      {adding ? 'Adding…' : '+ Add to Project'}
                    </button>
                  </div>
                )}
              </td>
              <td style={{ padding: '6px 8px', verticalAlign: 'top' }}
                onClick={e => e.stopPropagation()}>
                <button onClick={() => onOpen(n.id)} data-testid="landscape-open-paper"
                  data-paper-id={n.id}
                  className="text-[10.5px] px-1.5 py-0.5 rounded transition-colors"
                  style={{ border: '1px solid var(--color-edge)', color: 'var(--color-lav-light)' }}>
                  Open
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
