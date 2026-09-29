/**Shared filter panel — ONE set of filters drives Graph, List, and
 * Split. Every option is backed by data actually present (dynamic year
 * options include the current year; journal/publication-type/source
 * lists carry real counts). Honesty notes surface what filters cannot
 * say (unavailable citation counts, untyped retraction status, …).*/
import type { CSSProperties } from 'react';
import type { LandscapeFilters, Facets, SortKey, SortDir, RelationshipKind, FullTextKind } from '../../lib/landscapeFilter';
import {
  SORT_LABELS, DEFAULT_DIR, hasActiveFilters,
} from '../../lib/landscapeFilter';

interface Props {
  facets: Facets;
  filters: LandscapeFilters;
  onChange: (patch: Partial<LandscapeFilters>) => void;
  onClear: () => void;
  visibleNodes: number;
  visibleEdges: number;
  /** "18 of 43 papers" */
  summary: string;
  chips: string[];
  notes: string[];
  /** Truthful single-seed messages (running / complete states). */
  notice: string[];
}

const sectionLabel: CSSProperties = {
  fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--color-muted)',
};
const rowStyle: CSSProperties = { color: 'var(--color-sub)' };
const inputStyle: CSSProperties = {
  background: 'var(--color-bg)', border: '1px solid var(--color-edge)',
  color: 'var(--color-ink)', caretColor: 'var(--color-lavender)',
};

function toggleInArray(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
}

function toggleRel(arr: RelationshipKind[], value: RelationshipKind): RelationshipKind[] {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
}

function toggleKind(arr: FullTextKind[], value: FullTextKind): FullTextKind[] {
  return arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
}

export default function FilterPanel({
  facets, filters, onChange, onClear, visibleNodes, visibleEdges,
  summary, chips, notes, notice,
}: Props) {
  const active = hasActiveFilters(filters);
  const relSet = new Set(filters.relationships);

  const check = (
    testid: string, checked: boolean, label: string,
    onToggle: () => void, key: string,
  ) => (
    <label key={key} data-testid={testid}
      className="flex items-center gap-2 py-0.5 cursor-pointer text-[11.5px] leading-tight"
      style={rowStyle}>
      <input type="checkbox" checked={checked} onChange={onToggle}
        className="rounded shrink-0" style={{ accentColor: 'var(--color-lavender)' }} />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );

  return (
    <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--color-edge)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider" style={sectionLabel}>
          Filters
        </div>
        {active && (
          <button onClick={onClear} data-testid="landscape-clear-filters"
            className="text-[10.5px] px-2 py-0.5 rounded transition-colors"
            style={{ border: '1px solid var(--color-edge)', color: 'var(--color-lav)' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-lavender)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-edge)')}>
            Clear filters
          </button>
        )}
      </div>

      {/* Filter summary: "18 of 43 papers" + active-filter chips. */}
      <div data-testid="landscape-filter-summary"
        className="text-[11px] mb-1.5" style={{ color: 'var(--color-sub)', fontFamily: 'var(--font-mono)' }}>
        {summary}
      </div>
      {chips.length > 0 && (
        <div className="text-[10.5px] leading-snug mb-2" style={{ color: 'var(--color-muted)' }}
          data-testid="landscape-filter-chips">
          Filters: {chips.join(' · ')}
        </div>
      )}

      {/* Keyword across stored metadata — not just the title. */}
      <div style={sectionLabel} className="mb-1.5">Keyword</div>
      <div className="flex items-center gap-1.5 rounded px-2 py-1.5 mb-2.5"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-edge)' }}>
        <input type="text" data-testid="landscape-filter-keyword"
          placeholder="Search papers by keyword…" value={filters.keyword}
          onChange={e => onChange({ keyword: e.target.value })}
          className="flex-1 bg-transparent text-[11.5px] border-0 outline-none"
          style={{ color: 'var(--color-ink)', caretColor: 'var(--color-lavender)' }} />
      </div>

      {/* Sort By with the spec's directions. */}
      <div style={sectionLabel} className="mb-1.5">Sort by</div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <select data-testid="landscape-sort-by" value={filters.sort}
          onChange={e => {
            const sort = e.target.value as SortKey;
            onChange({ sort, dir: DEFAULT_DIR[sort] });
          }}
          className="flex-1 min-w-0 rounded px-1.5 py-1 text-[11px] outline-none"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}>
          {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
            <option key={k} value={k}>{SORT_LABELS[k]}</option>
          ))}
        </select>
        <select data-testid="landscape-sort-dir" value={filters.dir}
          onChange={e => onChange({ dir: e.target.value as SortDir })}
          className="flex-1 min-w-0 rounded px-1.5 py-1 text-[11px] outline-none"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}>
          <option value="desc">
            {filters.sort === 'title' || filters.sort === 'journal' ? 'Z → A'
              : filters.sort === 'year' ? 'Newest → Oldest'
              : filters.sort === 'similarity' ? 'Highest → Lowest'
              : 'High → Low'}
          </option>
          <option value="asc">
            {filters.sort === 'title' || filters.sort === 'journal' ? 'A → Z'
              : filters.sort === 'year' ? 'Oldest → Newest'
              : filters.sort === 'similarity' ? 'Lowest → Highest'
              : 'Low → High'}
          </option>
        </select>
      </div>

      {/* Publication year: dynamic options (data years ∪ current year).
          Exact (from==to), range, after (from only), before (to only). */}
      <div style={sectionLabel} className="mb-1.5">Publication year</div>
      <div className="flex items-center gap-1.5 mb-2.5">
        <select data-testid="landscape-filter-year-from" value={filters.yearFrom}
          onChange={e => onChange({ yearFrom: e.target.value })}
          className="flex-1 min-w-0 rounded px-1.5 py-1 text-[11px] outline-none"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}>
          <option value="">from</option>
          {facets.years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ color: 'var(--color-muted)' }}>–</span>
        <select data-testid="landscape-filter-year-to" value={filters.yearTo}
          onChange={e => onChange({ yearTo: e.target.value })}
          className="flex-1 min-w-0 rounded px-1.5 py-1 text-[11px] outline-none"
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}>
          <option value="">to</option>
          {facets.years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Journal with counts (options only for journals actually present). */}
      {facets.journals.length > 0 && (
        <div className="mb-2.5">
          <div style={sectionLabel} className="mb-1.5">Journal</div>
          <input type="text" data-testid="landscape-filter-journal-search"
            placeholder="Filter journals…" value={filters.journalSearch}
            onChange={e => onChange({ journalSearch: e.target.value })}
            className="w-full rounded px-2 py-1 text-[11px] outline-none mb-1"
            style={inputStyle} />
          <div className="max-h-32 overflow-y-auto pr-1">
            {facets.journals
              .filter(j => j.name.toLowerCase().includes(filters.journalSearch.trim().toLowerCase()))
              .map(j => check(
                'landscape-journal-option',
                filters.journals.includes(j.name),
                `${j.name} (${j.count})`,
                () => onChange({ journals: toggleInArray(filters.journals, j.name) }),
                j.name,
              ))}
          </div>
        </div>
      )}

      {/* Author substring filter. */}
      <div style={sectionLabel} className="mb-1.5">Author</div>
      <input type="text" data-testid="landscape-filter-author"
        placeholder="Author name…" value={filters.author}
        onChange={e => onChange({ author: e.target.value })}
        className="w-full rounded px-2 py-1 text-[11px] outline-none mb-2.5" style={inputStyle} />

      {/* Retraction: excludes ONLY source-typed retracted papers;
          unavailable status is never assumed "not retracted". */}
      <div className="mb-2.5">
        <div style={sectionLabel} className="mb-1.5">Retraction status</div>
        {check('landscape-filter-retracted', filters.excludeRetracted,
          'Exclude retracted papers',
          () => onChange({ excludeRetracted: !filters.excludeRetracted}), 'retracted')}
        {!facets.hasRetractionMetadata && (
          <div className="text-[10.5px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Retraction metadata unavailable for all papers in this landscape.
          </div>
        )}
      </div>

      {/* Publication types: only types actually present in the data. */}
      {facets.pubTypes.length > 0 && (
        <div className="mb-2.5">
          <div style={sectionLabel} className="mb-1.5">Publication type</div>
          {facets.pubTypes.map(t => check(
            'landscape-filter-pubtype',
            filters.pubTypes.includes(t.type),
            `${t.type} (${t.count})`,
            () => onChange({ pubTypes: toggleInArray(filters.pubTypes, t.type) }),
            t.type,
          ))}
        </div>
      )}

      {/* Full text: free link (source-recorded), local full text, or
          metadata-only — three independent, honest options. */}
      <div className="mb-2.5">
        <div style={sectionLabel} className="mb-1.5">Open access / full text</div>
        {([
          ['free', 'Free full text (link available)'],
          ['local', 'Full text available'],
          ['metadata', 'Metadata only'],
        ] as [FullTextKind, string][]).map(([k, label]) => check(
          'landscape-filter-fulltext', filters.fullText.includes(k), label,
          () => onChange({ fullText: toggleKind(filters.fullText, k) }), k,
        ))}
      </div>

      {/* Discovery source: the provenance actually stored per paper. */}
      {facets.sources.length > 0 && (
        <div className="mb-2.5">
          <div style={sectionLabel} className="mb-1.5">Discovery source</div>
          {facets.sources.map(s => check(
            'landscape-filter-source', filters.sources.includes(s.type),
            `${s.label} (${s.count})`,
            () => onChange({ sources: toggleInArray(filters.sources, s.type) }),
            s.type,
          ))}
        </div>
      )}

      {/* Relationship type (edge set; graph + relationship columns). */}
      <div className="mb-2.5">
        <div style={sectionLabel} className="mb-1.5">Relationship type</div>
        {check('landscape-filter-relationship', relSet.has('cites'),
          'cites (from reference lists)',
          () => onChange({ relationships: toggleRel(filters.relationships, 'cites') }), 'rel-cites')}
        {check('landscape-filter-relationship', relSet.has('cited_by'),
          'cited by (PubMed)',
          () => onChange({ relationships: toggleRel(filters.relationships, 'cited_by') }), 'rel-citedby')}
        {check('landscape-filter-relationship', relSet.has('semantic_similarity'),
          'semantic similarity',
          () => onChange({ relationships: toggleRel(filters.relationships, 'semantic_similarity') }), 'rel-sim')}
      </div>

      {/* Semantic-similarity threshold — only when semantic edges exist
          (exactly one range input on the page in that case). */}
      {facets.hasSemantic && (
        <div className="mb-2.5">
          <div style={sectionLabel} className="mb-1">Min semantic similarity</div>
          <input type="range" min={-1} max={1} step={0.05} value={filters.minSim}
            onChange={e => onChange({ minSim: Number(e.target.value) })}
            className="w-full" style={{ accentColor: 'var(--color-teal)' }} />
          <div className="text-[10px]" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
            {filters.minSim <= -1 ? 'off (show all)' : `≥ ${filters.minSim.toFixed(2)}`}
          </div>
        </div>
      )}

      {/* Truthful notes (sort/filter limitations, unavailable data). */}
      {(notes.length > 0 || notice.length > 0) && (
        <div className="mt-1 space-y-1" data-testid="landscape-notes">
          {notice.map((t, i) => (
            <div key={`n${i}`} data-testid={i === 0 ? 'landscape-single-seed' : undefined}
              className="text-[11px] leading-snug" style={{ color: 'var(--color-sub)' }}>{t}</div>
          ))}
          {notes.map((t, i) => (
            <div key={`o${i}`} className="text-[10.5px] leading-snug" style={{ color: 'var(--color-muted)' }}>{t}</div>
          ))}
        </div>
      )}

      {/* Exact "N nodes · M edges" text (regression scripts scope on it). */}
      <div className="text-[10px] mt-2" style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
        {visibleNodes} nodes · {visibleEdges} edges
      </div>
      {!facets.hasSemantic && (
        <div className="text-[11px] mt-1.5" style={{ color: 'var(--color-muted)' }}>
          No semantic-similarity relationships are currently available.
        </div>
      )}
    </div>
  );
}
