/**Typed API client for the LiiT backend (FastAPI, same origin config via VITE_API_BASE).*/
const BASE = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

/**Turn a failed response into an Error carrying the API's own detail
 * message (FastAPI {"detail": "..."} bodies) rather than raw JSON.*/
async function toApiError(r: Response): Promise<Error> {
  const text = await r.text().catch(() => "");
  let detail = "";
  try {
    const j = JSON.parse(text);
    if (typeof j?.detail === "string") detail = j.detail;
    else if (j?.detail != null) detail = JSON.stringify(j.detail);
  } catch {
    /* body is not JSON — fall through to raw text */
  }
  if (detail) return new Error(`API ${r.status}: ${detail}`);
  return new Error(`API ${r.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch (e) {
    throw new Error(`Cannot reach LiiT backend at ${BASE}. Is it running?`);
  }
  if (!r.ok) throw await toApiError(r);
  return r.json() as Promise<T>;
}

export interface Project { id: string; name: string; description: string; created_at: string; updated_at: string; }
export interface ApiPaper {
  id: string; project_id: string; title: string; authors: string[];
  journal: string; year: number | null; doi: string; pmid: string;
  arxiv_id: string; abstract: string; source_pdf_path: string;
  discovery_source_type: string; source_paper_id: string; query_id: string;
  extraction_status: string; parsing_warnings: string[];
  /** Project-collection membership: true only when explicitly added. */
  in_project: boolean;
  /** Free full-text link recorded by the source ("" = none known). */
  pdf_url: string;
  /** Publication types from the source ([] = unavailable). */
  pub_types: string[];
  created_at: string; updated_at: string;
}
export interface Chunk { chunk_id: string; section: string; subsection: string; text: string; source_start: string; source_end: string; }
export interface Section { name: string; items: { page: number; text: string; subsection: string | null }[]; }
export interface EvidenceItem {
  id: string; paper_id: string; chunk_id: string; category: string; text: string;
  section: string; subsection: string; page_start: number | null; page_end: number | null;
  location_status: string; status: string;
}
/** `GET /papers/{id}/extraction-status` — latest-attempt extraction state
 * per current chunk (read-only; never runs extraction).*/
export interface ExtractionRunStatus {
  paper_id: string;
  run: 'not_run' | 'complete' | 'partial' | 'failed';
  chunks_total: number; succeeded: number; failed: number;
  not_attempted: number; error: string;
}
export interface SynthesisSource {
  evidence_id: string; chunk_id: string; section: string; subsection: string;
  page_start: number | null; page_end: number | null; location_status: string;
}
export interface SynthesisItem { text: string; evidence_ids: string[]; sources: SynthesisSource[]; }
export interface PaperSynthesis {
  paper_id: string; synthesis_status: string;
  synthesis: Record<string, SynthesisItem[]>;
  error: string; schema_version: string; model_name: string; prompt_version: string;
}
export interface PaperReference {
  id: string; title: string; authors: string[]; year: number | null; journal: string;
  doi: string; pmid: string; arxiv_id: string; source_page: number | null;
  resolution_status: string; resolved_paper_id: string; raw_text: string;
}
export interface DiscoveryItem { type: string; query: string; source_paper_id: string; search_id: string; external_id: string; source: string; }
export interface LandscapeNode {
  id: string; type: string; title: string; authors: string[]; year: number | null;
  journal: string; doi: string; pmid: string; arxiv_id: string;
  discovery_source: string; discovery: DiscoveryItem[]; metadata_only: boolean;
  embedding_status: string; concepts: string[]; methods: string[];
  /** Project-collection membership: discovered != added-to-project. */
  in_project: boolean;
  abstract: string;
  /** Free full-text link when the source recorded one ("" = none known). */
  pdf_url: string;
  /** Publication types from the source ([] = unavailable). */
  pub_types: string[];
  /** True/False when the source typed the record, null = unavailable
   *  (never assumed "not retracted"). */
  retracted: boolean | null;
  /** No citation-count source exists: always null, never a fake 0. */
  citation_count: number | null;
  created_at: string;
}
export interface LandscapeEdge { source: string; target: string; relationship: string; status: string; similarity: number | null; mechanism?: string; }
export interface LandscapeData { project_id: string; nodes: LandscapeNode[]; edges: LandscapeEdge[]; }
/** One discovery channel of the automatic build (honest counts/errors). */
export interface LandscapeChannel {
  channel: string; source: string; status: string; detail: string;
  query: string; search_id: string; retrieved: number; created: number;
  edged: number; below_threshold: number; duplicates: number;
  excluded_self: number; skipped: number; unresolved: number;
  resolved: number; edges: number; error: string; errors: string[];
}
/** Truthful state of the automatic one-seed landscape build. */
export interface LandscapeStatus {
  project_id: string; seed_paper_id: string;
  status: 'idle' | 'running' | 'complete' | 'error';
  step: string; channels: LandscapeChannel[]; policy: Record<string, number>;
  error: string; started_at: string; updated_at: string;
}
export interface SearchResultItem {
  external_id: string; source: string; pmid: string; doi: string; arxiv_id: string;
  title: string; authors: string[]; journal: string; year: number | null;
  abstract: string; pdf_url: string; rank: number; discovery_source: { type: string; query: string };
  /** Publication types as reported by the source ([] = unavailable). */
  pub_types: string[];
}
export interface SearchResponse {
  search_id: string; project_id: string; source: string; query: string;
  result_count: number; status: string; error: string; results: SearchResultItem[];
}
export interface SearchHistoryItem {
  id: string; project_id: string; source: string; query: string; max_results: number;
  result_count: number; status: string; error: string; created_at: string;
}
export interface ImportResponse {
  paper_id: string; created: boolean; discovery_source_type: string;
  embedding: { status: string } | null; references_resolved: number;
  similarity_computed: number; similarity_skipped: string[]; warnings: string[];
}
/** Bulk [Add to Project]: membership only, with honest counts. */
export interface CollectionAddResponse {
  project_id: string; project_name: string;
  added: number; already_in_project: number; not_found: string[];
}

/** Response of the ingest pipeline (upload / process). Backend statuses:
 * pending | parsing | chunking | complete | partial | error.*/
export interface IngestResult {
  paper_id: string; status: string; pages: number;
  sections: string[]; chunks: number; warnings: string[];
}
export interface ProcessingStatus {
  paper_id: string; extraction_status: string;
  parsing_warnings: string[]; source_pdf_path: string;
}
/** POST /extract and /synthesize return 200 with stats; status is
 * complete | partial | error — failures live in `warnings`, not HTTP.*/
export interface ExtractionStats {
  paper_id: string; status: string; chunks_total: number; succeeded: number;
  failed: number; skipped_cached: number; evidence_items: number;
  json_failures: number; provenance_failures: number; repair_attempts: number;
  repair_successes: number; model: string; prompt_version: string;
  schema_version: string; duration_seconds: number; warnings: string[];
}
export interface SynthesisStats {
  paper_id: string; status: string; cached: boolean; model: string;
  prompt_version: string; schema_version: string; model_calls: number;
  repair_attempts: number; input_tokens: number; fields_populated: number;
  duration_seconds: number; hierarchical: boolean; warnings: string[];
}

/** One stored vector row of `GET /papers/{id}/embedding-status`. */
export interface StoredEmbedding {
  model_name: string; embedding_version: string; dim: number;
  source_repr: string; source_hash: string; created_at: string;
}
/** Backend stage status is pending | complete | error (paper_processing). */
export interface EmbeddingStatusData {
  paper_id: string; status: string; error: string; embeddings: StoredEmbedding[];
}
/** `POST /papers/{id}/embeddings` — 200 even on failure; check `status`
 * and `warnings` (model/representation errors are reported there). */
export interface EmbeddingStats {
  paper_id: string; status: string; cached: boolean; model: string;
  embedding_version: string; dim: number; duration_seconds: number;
  warnings: string[];
}
export interface SimilarityPair {
  paper_a: string; paper_b: string; similarity: number;
  embedding_model: string; embedding_version: string; created_at: string;
}
/** `GET /projects/{id}/similarity` computes+stores missing pairs first;
 * `skipped` lists pairs whose embeddings are missing (never fabricated). */
export interface ProjectSimilarityData {
  project_id: string; pairs: SimilarityPair[]; computed: number;
  skipped: string[][];
}

/**One contextual-tutor ask (`POST /api/tutor/explain`, beta): the
 * researcher's verbatim selection + bounded context from the current
 * paper. Never triggered automatically; nothing is stored.*/
export interface TutorAsk {
  paper_id: string;
  text: string;
  context?: string;
  section?: string;
  subsection?: string;
  page?: number | null;
  evidence_id?: string;
}
export interface TutorExplain {
  paper_id: string;
  status: "ok" | "insufficient" | "error" | "unavailable";
  explanation: string;
  error: string;
  model: string;
  prompt_version: string;
  duration_seconds: number;
  section: string;
  subsection: string;
  page: number | null;
  evidence_id: string;
  truncated: boolean;
}

export const api = {
  health: () => req<{ status: string }>("/api/health"),
  listProjects: () => req<Project[]>("/api/projects"),
  createProject: (name: string, description = "") =>
    req<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name, description }) }),
  listPapers: (projectId: string) => req<ApiPaper[]>(`/api/projects/${projectId}/papers`),
  /** Explicit [Add to Project]: membership only — provenance, nodes,
   *  and edges are preserved. Idempotent. */
  addToCollection: (projectId: string, paperId: string) =>
    req<ApiPaper>(`/api/projects/${projectId}/papers/${paperId}/collection`, { method: "POST" }),
  /** Remove project membership only — the Landscape node, provenance,
   *  and edges are never destroyed. */
  removeFromCollection: (projectId: string, paperId: string) =>
    req<ApiPaper>(`/api/projects/${projectId}/papers/${paperId}/collection`, { method: "DELETE" }),
  /** Bulk [Add to Project]; reports added / already / not-found. */
  bulkAddToCollection: (projectId: string, paperIds: string[]) =>
    req<CollectionAddResponse>(`/api/projects/${projectId}/collection`, {
      method: "POST", body: JSON.stringify({ paper_ids: paperIds }),
    }),
  getPaper: (paperId: string) => req<ApiPaper>(`/api/papers/${paperId}`),
  /** Re-run the PDF ingest pipeline (parse → chunk → metadata → references).
   * 422 when the paper has no stored PDF.*/
  processPaper: (paperId: string) =>
    req<IngestResult>(`/api/papers/${paperId}/process`, { method: "POST" }),
  /** Not started automatically by ingest — the researcher triggers it.*/
  extractPaper: (paperId: string, body = {}) =>
    req<ExtractionStats>(`/api/papers/${paperId}/extract`, { method: "POST", body: JSON.stringify(body) }),
  listEvidence: (paperId: string, params = "") =>
    req<EvidenceItem[]>(`/api/papers/${paperId}/evidence${params}`),
  /** Read-only latest-attempt state per current chunk (never a trigger).*/
  extractionStatus: (paperId: string) =>
    req<ExtractionRunStatus>(`/api/papers/${paperId}/extraction-status`),
  uploadPaper: async (projectId: string, file: File): Promise<ApiPaper & IngestResult> => {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${BASE}/api/projects/${projectId}/papers/upload`, { method: "POST", body: form });
    if (!r.ok) throw await toApiError(r);
    return r.json();
  },
  processingStatus: (paperId: string) =>
    req<{ extraction_status: string; parsing_warnings: string[] }>(`/api/papers/${paperId}/processing-status`),
  listSections: (paperId: string) => req<Section[]>(`/api/papers/${paperId}/sections`),
  listChunks: (paperId: string) => req<Chunk[]>(`/api/papers/${paperId}/chunks`),
  getMetadata: (paperId: string) => req(`/api/papers/${paperId}/metadata`),
  listReferences: (paperId: string) => req<PaperReference[]>(`/api/papers/${paperId}/references`),
  listCitations: (paperId: string) => req(`/api/papers/${paperId}/citations`),
  /** Hash-skips regeneration unless the representation changed (or `force`). */
  embedPaper: (paperId: string, body = {}) =>
    req<EmbeddingStats>(`/api/papers/${paperId}/embeddings`, { method: "POST", body: JSON.stringify(body) }),
  embeddingStatus: (paperId: string) => req<EmbeddingStatusData>(`/api/papers/${paperId}/embedding-status`),
  /** Computes and stores missing cosine pairs (O(N²)), then returns all. */
  projectSimilarity: (projectId: string) => req<ProjectSimilarityData>(`/api/projects/${projectId}/similarity`),
  landscape: (projectId: string) => req<LandscapeData>(`/api/landscape/${projectId}`),
  /** Truthful automatic-build state: idle | running + step | complete/error. */
  landscapeStatus: (projectId: string) => req<LandscapeStatus>(`/api/projects/${projectId}/landscape/status`),
  /** Explicit retry of the automatic build after a surfaced error. */
  discoverLandscape: (projectId: string, seedPaperId = '') =>
    req<LandscapeStatus>(`/api/projects/${projectId}/discover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed_paper_id: seedPaperId }),
    }),
  searchPubmed: (projectId: string, body = {}) =>
    req<SearchResponse>(`/api/projects/${projectId}/search/pubmed`, { method: "POST", body: JSON.stringify(body) }),
  searchArxiv: (projectId: string, body = {}) =>
    req<SearchResponse>(`/api/projects/${projectId}/search/arxiv`, { method: "POST", body: JSON.stringify(body) }),
  searchHistory: (projectId: string) => req<SearchHistoryItem[]>(`/api/projects/${projectId}/searches`),
  getSearch: (searchId: string) => req<SearchResponse>(`/api/search/${searchId}`),
  importResult: (body = {}) =>
    req<ImportResponse>(`/api/search/import`, { method: "POST", body: JSON.stringify(body) }),
  discovery: (paperId: string) => req<{ paper_id: string; discovery: DiscoveryItem[] }>(`/api/papers/${paperId}/discovery`),
  getSynthesis: (paperId: string) => req<PaperSynthesis>(`/api/papers/${paperId}/synthesis`),
  /** Not started automatically — requires chunk-level evidence first.*/
  synthesizePaper: (paperId: string, body = {}) =>
    req<SynthesisStats>(`/api/papers/${paperId}/synthesize`, { method: "POST", body: JSON.stringify(body) }),
  /** Contextual tutor (beta): explained only when the researcher asks.*/
  explain: (body: TutorAsk) =>
    req<TutorExplain>("/api/tutor/explain", { method: "POST", body: JSON.stringify(body) }),
  attachPdf: async (paperId: string, file: File): Promise<ApiPaper> => {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${BASE}/api/papers/${paperId}/pdf`, { method: "POST", body: form });
    if (!r.ok) throw await toApiError(r);
    return r.json();
  },
};
