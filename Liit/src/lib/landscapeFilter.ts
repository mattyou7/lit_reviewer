/**Landscape workspace filters + sorting — ONE filtered set drives the
 * Graph, List, and Split views (client-side over the single fetched
 * landscape payload; no network per filter, structured to move
 * server-side later).
 *
 * Honesty rules enforced here:
 *  - keyword searches stored metadata only (title, abstract, authors,
 *    journal, identifiers, concepts, methods) — never an LLM judgment
 *  - citation counts are NEVER invented: null = unavailable, sorted
 *    last in both directions, never treated as 0
 *  - retraction: only `retracted === true` (source-typed) is excluded;
 *    null ("unavailable") is never assumed "not retracted"
 *  - publication-type filtering uses only types actually present in the
 *    data; papers without type metadata are excluded when the filter is
 *    active, with an explicit note
 *  - similarity sorting applies only where a stored semantic-similarity
 *    score exists; papers without one sort last with an explicit note
 */
import type { LandscapeData, LandscapeEdge, LandscapeNode } from './api';

export type SortKey =
  | 'relevance' | 'citation_count' | 'year' | 'title'
  | 'journal' | 'similarity' | 'recently_discovered';
export type SortDir = 'asc' | 'desc';
export type RelationshipKind = 'cites' | 'cited_by' | 'semantic_similarity';
export type FullTextKind = 'free' | 'local' | 'metadata';

export interface LandscapeFilters {
  /** Keyword across stored metadata (not just the title). */
  keyword: string;
  /** Year range: exact (from==to), open range, or one-sided
   * (before = to only, after = from only). '' = unconstrained. */
  yearFrom: string;
  yearTo: string;
  journals: string[];
  /** UI-only: narrows the journal checkbox list itself. */
  journalSearch: string;
  author: string;
  excludeRetracted: boolean;
  pubTypes: string[];
  fullText: FullTextKind[];
  /** Provenance source type ids actually present in the data. */
  sources: string[];
  /** Visible relationship kinds (cites = reference-list citation edges,
   *  cited_by = PubMed cited-in edges, semantic_similarity). */
  relationships: RelationshipKind[];
  /** Semantic-similarity edge threshold (-1 = off). */
  minSim: number;
  sort: SortKey;
  dir: SortDir;
}

export const DEFAULT_RELATIONSHIPS: RelationshipKind[] =
  ['cites', 'cited_by', 'semantic_similarity'];

export const DEFAULT_FILTERS: LandscapeFilters = {
  keyword: '',
  yearFrom: '',
  yearTo: '',
  journals: [],
  journalSearch: '',
  author: '',
  excludeRetracted: false,
  pubTypes: [],
  fullText: [],
  sources: [],
  relationships: [...DEFAULT_RELATIONSHIPS],
  minSim: -1,
  sort: 'relevance',
  dir: 'desc',
};

/** Default direction per sort key (spec PART 6). */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  relevance: 'desc',
  citation_count: 'desc',
  year: 'desc', // Newest → Oldest
  title: 'asc', // A → Z
  journal: 'asc', // A → Z
  similarity: 'desc', // Highest → Lowest
  recently_discovered: 'desc',
};

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: 'Relevance',
  citation_count: 'Citation count',
  year: 'Year',
  title: 'Title',
  journal: 'Journal',
  similarity: 'Similarity',
  recently_discovered: 'Recently discovered',
};

/** Human labels for the provenance types actually stored. */
export const SOURCE_LABELS: Record<string, string> = {
  citation: 'Citation',
  citation_discovery: 'Citation',
  cited_by: 'Cited-by',
  cited_by_discovery: 'Cited-by',
  semantic_similarity: 'Semantic similarity',
  semantic_discovery: 'Semantic similarity',
  pubmed_query: 'PubMed discovery',
  arxiv_query: 'arXiv discovery',
  user_import: 'Manual import',
  direct_import: 'Manual import',
  user_added: 'Manual import',
};

export function sourceLabel(type: string): string {
  return SOURCE_LABELS[type] ?? type;
}

/** Provenance type ids stored for one node (actual rows; falls back to
 *  the paper's discovery_source_type when no route rows exist). */
export function provenanceTypes(node: LandscapeNode): string[] {
  const types = node.discovery?.map(d => d.type).filter(Boolean) ?? [];
  if (types.length > 0) return Array.from(new Set(types));
  return node.discovery_source ? [node.discovery_source] : [];
}

/** A free full-text link when the source recorded one. arXiv papers get
 *  arXiv's own stable /pdf/ URL — a real link, not an inference. */
export function freeFullTextUrl(node: LandscapeNode): string {
  if (node.pdf_url) return node.pdf_url;
  if (node.arxiv_id) {
    const base = node.arxiv_id.replace(/^arxiv:/i, '').split('v')[0];
    return base ? `https://arxiv.org/pdf/${base}.pdf` : '';
  }
  return '';
}

/** Highest stored semantic-similarity score involving this node, or
 *  null when the node has no semantic edge (never fabricated). */
export function maxSimilarityMap(
  edges: LandscapeEdge[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) {
    if (e.relationship !== 'semantic_similarity') continue;
    if (e.similarity == null) continue;
    for (const id of [e.source, e.target]) {
      const prev = m.get(id);
      if (prev == null || e.similarity > prev) m.set(id, e.similarity);
    }
  }
  return m;
}

export interface Facets {
  /** Options for the From/To selects: years present in the data plus
   *  the CURRENT year (dynamic — never hard-coded). */
  years: number[];
  journals: { name: string; count: number }[];
  pubTypes: { type: string; count: number }[];
  sources: { type: string; label: string; count: number }[];
  hasSemantic: boolean;
  hasRetractionMetadata: boolean;
}

export function deriveFacets(data: LandscapeData): Facets {
  const nodes = data.nodes;
  const yearSet = new Set<number>();
  const journalCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const n of nodes) {
    if (n.year != null) yearSet.add(n.year);
    if (n.journal) journalCounts.set(n.journal, (journalCounts.get(n.journal) ?? 0) + 1);
    for (const t of n.pub_types ?? []) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    for (const s of provenanceTypes(n)) sourceCounts.set(s, (sourceCounts.get(s) ?? 0) + 1);
  }
  yearSet.add(new Date().getFullYear()); // current year always offered
  const journals = Array.from(journalCounts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const pubTypes = Array.from(typeCounts, ([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const sources = Array.from(sourceCounts, ([type, count]) => ({
    type, count, label: sourceLabel(type),
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return {
    years: Array.from(yearSet).sort((a, b) => a - b),
    journals,
    pubTypes,
    sources,
    hasSemantic: data.edges.some(e => e.relationship === 'semantic_similarity'),
    hasRetractionMetadata: nodes.some(n => n.retracted !== null),
  };
}

/** Keyword across stored metadata — all terms must match somewhere,
 *  across any supported field. No ranking service, no LLM. */
export function matchesKeyword(node: LandscapeNode, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const terms = q.split(/\s+/).filter(Boolean);
  const hay = [
    node.title, node.abstract, node.journal,
    ...(node.authors ?? []),
    node.doi, node.pmid, node.arxiv_id,
    ...(node.concepts ?? []), ...(node.methods ?? []),
  ].join('\n').toLowerCase();
  return terms.every(t => hay.includes(t));
}

function matchesNode(n: LandscapeNode, f: LandscapeFilters): boolean {
  if (!matchesKeyword(n, f.keyword)) return false;

  if (f.yearFrom !== '' || f.yearTo !== '') {
    if (n.year == null) return false; // year filter excludes untyped years
    if (f.yearFrom !== '' && n.year < Number(f.yearFrom)) return false;
    if (f.yearTo !== '' && n.year > Number(f.yearTo)) return false;
  }

  if (f.journals.length > 0 && !f.journals.includes(n.journal)) return false;

  const author = f.author.trim().toLowerCase();
  if (author && !(n.authors ?? []).some(a => a.toLowerCase().includes(author))) {
    return false;
  }

  if (f.excludeRetracted && n.retracted === true) return false;

  if (f.pubTypes.length > 0) {
    // Only source-typed papers can match; untyped papers are excluded
    // (reported via note, never silently counted as "not matching").
    if (!(n.pub_types ?? []).some(t => f.pubTypes.includes(t))) return false;
  }

  if (f.fullText.length > 0) {
    const free = Boolean(freeFullTextUrl(n));
    const local = !n.metadata_only;
    const meta = n.metadata_only;
    const any = f.fullText.some(k =>
      (k === 'free' && free) || (k === 'local' && local) || (k === 'metadata' && meta));
    if (!any) return false;
  }

  if (f.sources.length > 0) {
    const types = provenanceTypes(n);
    if (!types.some(t => f.sources.includes(t))) return false;
  }

  return true;
}

/** Citations edges: "cites" = obtained from a paper's reference list
 *  (or unknown mechanism), "cited_by" = PubMed cited-in links. Every
 *  citation edge matches at least one default option — nothing is
 *  hidden unless the researcher unchecks it. */
export function edgeMatchesRelationships(
  edge: LandscapeEdge, relationships: RelationshipKind[],
): boolean {
  if (edge.relationship === 'semantic_similarity') {
    return relationships.includes('semantic_similarity');
  }
  if (edge.mechanism === 'pubmed_citedin') {
    return relationships.includes('cited_by');
  }
  return relationships.includes('cites');
}

export interface FilterResult {
  nodes: LandscapeNode[];
  /** Original data.edges index preserved so hover/pin state survives
   *  client-side filtering. */
  edges: { edge: LandscapeEdge; idx: number }[];
  total: number;
}

/** ONE filtered set for all three views. Graph filtering removes
 *  excluded nodes AND their edges (visualization only — never a DB
 *  deletion). */
export function applyFilters(
  data: LandscapeData, f: LandscapeFilters,
): FilterResult {
  const nodes = data.nodes.filter(n => matchesNode(n, f));
  const ids = new Set(nodes.map(n => n.id));
  const edges = data.edges
    .map((edge, idx) => ({ edge, idx }))
    .filter(({ edge }) =>
      ids.has(edge.source) && ids.has(edge.target)
      && edgeMatchesRelationships(edge, f.relationships)
      && (edge.relationship !== 'semantic_similarity'
        || f.minSim <= -1 || (edge.similarity ?? -1) >= f.minSim));
  return { nodes, edges, total: data.nodes.length };
}

// ---------------- sorting ----------------

function cmpNullableNum(
  a: number | null, b: number | null, dir: SortDir,
): number {
  // Unavailable sorts last in BOTH directions; never treated as 0.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

/** Field-priority keyword relevance (title > authors/journal >
 *  abstract > identifiers/concepts). Without a keyword, order is left
 *  unchanged (the original discovery order). */
export function relevanceScore(n: LandscapeNode, keyword: string): number {
  const q = keyword.trim().toLowerCase();
  if (!q) return 0;
  const terms = q.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const t of terms) {
    if (n.title?.toLowerCase().includes(t)) score += 4;
    if ((n.authors ?? []).some(a => a.toLowerCase().includes(t))) score += 2;
    if (n.journal?.toLowerCase().includes(t)) score += 2;
    if (n.abstract?.toLowerCase().includes(t)) score += 1;
    if ([n.doi, n.pmid, n.arxiv_id].some(v => v?.toLowerCase().includes(t))) score += 0.5;
  }
  return score;
}

export function sortNodes(
  nodes: LandscapeNode[], f: LandscapeFilters,
  maxSims: Map<string, number>,
): LandscapeNode[] {
  const out = [...nodes];
  const dir = f.dir;
  const byTitle = (a: LandscapeNode, b: LandscapeNode) =>
    a.title.localeCompare(b.title);
  const emptyLast = (v: string) => (v ? 0 : 1);

  out.sort((a, b) => {
    switch (f.sort) {
      case 'title':
        return dir === 'asc' ? byTitle(a, b) : byTitle(b, a);
      case 'journal': {
        const ea = emptyLast(a.journal), eb = emptyLast(b.journal);
        if (ea !== eb) return ea - eb; // untyped journal always last
        const c = a.journal.localeCompare(b.journal);
        return dir === 'asc' ? c : -c;
      }
      case 'year':
        return cmpNullableNum(a.year, b.year, dir);
      case 'citation_count':
        // Citation count unavailable app-wide: stable order preserved.
        return cmpNullableNum(a.citation_count, b.citation_count, dir);
      case 'similarity': {
        const sa = maxSims.get(a.id) ?? null;
        const sb = maxSims.get(b.id) ?? null;
        return cmpNullableNum(sa, sb, dir);
      }
      case 'recently_discovered': {
        // ISO timestamps compare lexicographically.
        const ca = a.created_at || '';
        const cb = b.created_at || '';
        if (!ca && !cb) return 0;
        if (!ca) return 1;
        if (!cb) return -1;
        const c = ca < cb ? -1 : ca > cb ? 1 : 0;
        return dir === 'asc' ? c : -c;
      }
      case 'relevance':
      default: {
        if (!f.keyword.trim()) return 0; // stable: discovery order
        const c = relevanceScore(a, f.keyword) - relevanceScore(b, f.keyword);
        // Equal scores keep original order (stable sort).
        return dir === 'asc' ? c : -c;
      }
    }
  });
  return out;
}

export function applyAll(
  data: LandscapeData, f: LandscapeFilters,
): FilterResult & { maxSims: Map<string, number> } {
  const filtered = applyFilters(data, f);
  const maxSims = maxSimilarityMap(data.edges);
  filtered.nodes = sortNodes(filtered.nodes, f, maxSims);
  return { ...filtered, maxSims };
}

// ---------------- summary / honesty notes ----------------

export function hasActiveFilters(f: LandscapeFilters): boolean {
  return Boolean(
    f.keyword.trim() || f.yearFrom || f.yearTo || f.journals.length
    || f.author.trim() || f.excludeRetracted || f.pubTypes.length
    || f.fullText.length || f.sources.length
    || f.relationships.length !== DEFAULT_RELATIONSHIPS.length
    || f.minSim > -1);
}

/** Clear every FILTER; sorting is a view preference, not a filter. */
export function clearedFilters(f: LandscapeFilters): LandscapeFilters {
  return { ...DEFAULT_FILTERS, sort: f.sort, dir: f.dir };
}

/** Chips like "Filters: 2024–2026 · Nature Neuroscience · confirmation
 *  bias" — only the filters actually active. */
export function activeChips(f: LandscapeFilters): string[] {
  const chips: string[] = [];
  if (f.yearFrom && f.yearTo) chips.push(`${f.yearFrom}–${f.yearTo}`);
  else if (f.yearFrom) chips.push(`From ${f.yearFrom}`);
  else if (f.yearTo) chips.push(`Up to ${f.yearTo}`);
  chips.push(...f.journals);
  if (f.keyword.trim()) chips.push(f.keyword.trim());
  if (f.author.trim()) chips.push(`Author: ${f.author.trim()}`);
  if (f.excludeRetracted) chips.push('Exclude retracted');
  chips.push(...f.pubTypes);
  const ftLabels: Record<FullTextKind, string> = {
    free: 'Free full text', local: 'Full text available', metadata: 'Metadata only',
  };
  chips.push(...f.fullText.map(k => ftLabels[k]));
  chips.push(...f.sources.map(sourceLabel));
  if (f.relationships.length !== DEFAULT_RELATIONSHIPS.length) {
    chips.push(...f.relationships.map(r =>
      r === 'semantic_similarity' ? 'semantic similarity' : r));
  }
  if (f.minSim > -1) chips.push(`similarity ≥ ${f.minSim.toFixed(2)}`);
  return chips;
}

/** Truthful notes about what the current filters/sort can and cannot
 *  say — shown next to the results, never hidden. */
export function honestyNotes(
  all: LandscapeNode[], f: LandscapeFilters,
  maxSims: Map<string, number>,
): string[] {
  const notes: string[] = [];
  if (f.sort === 'citation_count'
    && all.every(n => n.citation_count == null)) {
    notes.push('Citation count unavailable for these papers — order unchanged.');
  }
  if (f.sort === 'similarity') {
    const missing = all.filter(n => !maxSims.has(n.id)).length;
    if (missing > 0) {
      notes.push(`${missing} paper${missing === 1 ? '' : 's'} have no semantic-similarity score (shown last).`);
    }
  }
  if (f.sort === 'relevance' && !f.keyword.trim()) {
    notes.push('No keyword entered — relevance shows the original discovery order.');
  }
  if (f.excludeRetracted) {
    const unknown = all.filter(n => n.retracted === null).length;
    if (unknown > 0) {
      notes.push(`Retraction status unavailable for ${unknown} paper${unknown === 1 ? '' : 's'} — not excluded.`);
    }
  }
  if (f.pubTypes.length > 0) {
    const unknown = all.filter(n => (n.pub_types ?? []).length === 0).length;
    if (unknown > 0) {
      notes.push(`Publication type unavailable for ${unknown} paper${unknown === 1 ? '' : 's'} (excluded while a type filter is active).`);
    }
  }
  if ((f.yearFrom || f.yearTo)) {
    const unknown = all.filter(n => n.year == null).length;
    if (unknown > 0) {
      notes.push(`${unknown} paper${unknown === 1 ? '' : 's'} have no recorded year (excluded by the year filter).`);
    }
  }
  return notes;
}

/** Per-node display helpers shared by List/Split/Detail. */
export function retractionLabel(
  retracted: boolean | null,
): { text: string; tone: 'danger' | 'ok' | 'muted' } {
  if (retracted === true) return { text: 'Retracted (PubMed publication type)', tone: 'danger' };
  if (retracted === false) return { text: 'Not retracted (PubMed publication type)', tone: 'ok' };
  return { text: 'Retraction status unavailable', tone: 'muted' };
}

export function citationLabel(n: LandscapeNode): string {
  return n.citation_count == null ? 'Citation count unavailable' : String(n.citation_count);
}

export function fullTextLabel(n: LandscapeNode): { free: boolean; local: boolean; meta: boolean } {
  return {
    free: Boolean(freeFullTextUrl(n)),
    local: !n.metadata_only,
    meta: n.metadata_only,
  };
}
