# Data model (Phase 1 implemented)

Implemented in SQLite (`backend/app/database.py`):

- `projects(id, name, description, created_at, updated_at)` — id `proj_<hex8>`
- `papers(id, project_id FK, title, authors_json, journal, year, doi, pmid,
  arxiv_id, abstract, source_pdf_path, discovery_source_type,
  source_paper_id, query_id, extraction_status='pending',
  parsing_warnings_json, created_at, updated_at)` — id `paper_<hex8>`

`discovery_source_type` enum (`ALLOWED_DISCOVERY` in
`backend/app/store.py`): direct_import, user_import, citation, cited_by,
pubmed_query, arxiv_query, semantic_similarity, user_added,
citation_discovery, cited_by_discovery, semantic_discovery.

Planned (not yet): paper_evidence, references, citations,
concepts, methods, approaches, repositories, searches, search_results,
landscape_nodes, landscape_edges, notes, saved_items, tutor_interactions,
discovery_sources.

Note: the contextual tutor (beta) intentionally stores nothing — there is
no `tutor_interactions` table and no chat history; an explanation exists
only in its `POST /api/tutor/explain` response.

Implemented in this round:

- `paper_sections(id, paper_id FK, name, items_json, created_at)`
- `paper_chunks(id, paper_id FK, chunk_id, section, subsection, text,
  source_start, source_end, token_estimate, char_count, text_hash, created_at)`
- Local files: `data/papers/<paper_id>/original.pdf` (copied, never moved)
  + `chunk_manifest.json` (pages, section summary, per-chunk provenance, warnings).

Implemented in the teacher-extraction slice:

- `paper_evidence(id, paper_id FK, chunk_id, category, text, section,
  subsection, page_start, page_end, location_status, status='explicit',
  schema_version, model_name, prompt_version, created_at)` — id is
  version-scoped (`paper:chunk:category:idx:model:prompt:schema`) so
  re-extraction never collides with older rows.
- `chunk_extractions(...)` additionally records `attempt_count`,
  `failure_type` (`model|json|schema|provenance`) and truncated
  `raw_output` per attempt for offline diagnosis.
- `chunk_extractions(paper_id, chunk_id, status, error, model_name,
  prompt_version, schema_version, updated_at)` — PK on
  (paper_id, chunk_id, model_name, prompt_version, schema_version);
  drives idempotent skip + targeted retry.
- Prompt/schema versions: `src/teacher/prompt.py`
  (`PROMPT_VERSION=1.4`, `EXTRACTION_SCHEMA_VERSION=1.0`, 16 categories;
  1.4 adds a worked few-shot example).

Implemented in the paper-synthesis slice:

- `paper_syntheses(id, paper_id FK, synthesis_json, synthesis_status,
  error, schema_version, model_name, prompt_version, input_tokens,
  model_calls, raw_output, created_at, updated_at)` — UNIQUE on
  (paper_id, model_name, prompt_version, schema_version); own status
  (`complete|partial|error`) so ingestion/extraction statuses are never
  overloaded; `raw_output` retains the failing model output for diagnosis.
- Synthesis input is normalized evidence (exact-duplicate overlap
  statements merged, all original IDs kept in `merged_ids`); the model
  cites evidence IDs and the app resolves them to stored chunk/section/
  page locations. Model-authored page numbers are rejected.
- Field↔category alignment is enforced: an item may only cite evidence
  whose category matches its field (`main_results` cites `results`).
- Only answerable fields (with matching-category evidence) are
  requested. Single-call truncation falls back once to field-group
  batches; validated batches persist as `partial`, never `complete`.
  Repair/salvage drops are recorded in warnings; failed reruns never
  overwrite a validated complete row.

Implemented in the knowledge/discovery slice:

- `paper_metadata(paper_id, field, value, source, updated_at)` PK
  (paper_id, field, source): per-field provenance; conflicts preserved,
  resolved by priority pdf_metadata > pdf_text, user values never
  overwritten; same-source refresh may correct/clear stale values.
- `paper_references(id, paper_id FK, ref_index, raw_text, ..., doi,
  arxiv_id, year, source_page, resolution_status, resolved_paper_id)`:
  raw always kept; identifiers deterministic (DOI/arXiv regex, heuristic
  year); resolution DOI/arXiv-exact or single title match within project.
- `citation_edges(source, target, relationship='cites',
  source='reference_extraction', status)` PK(source, target): citation
  means citation only, no agreement/support semantics.
- `paper_embeddings(paper_id, model_name, model_version,
  embedding_version, source_repr, source_hash, dim, vector BLOB)`:
  MiniLM-L6-v2 (384d, local CPU), L2-normalized; hash-skipped regen.
- `paper_similarity(paper_a, paper_b, similarity, ...)` PK ordered pair:
  cosine, stored for all pairs (no relevance threshold/ranking).
- `paper_processing(paper_id, stage, status, error)`: visible per-stage
  status for metadata/references/embeddings; failures never invalidate
  other stages.

Implemented in the discovery slice:

- `searches(id, project_id FK, source, query, max_results, result_count,
  status, error, created_at)` + `search_results(...)` ranked rows with
  external IDs (PMID/DOI/arXiv), metadata, abstract, pdf_url.
  UNIQUE(search_id, external_id); duplicates removed at store time.
- `paper_discovery(id, paper_id FK, source_type, query, source_paper_id,
  search_id, external_id, created_at)`: append-only multi-source trail
  (`user_import`, `pubmed_query`, `arxiv_query`, `citation`,
  `semantic_similarity`); legacy single-column source kept as fallback.
- Import = explicit single-result operation: dedup by DOI→PMID→arXiv
  (project-scoped, ambiguous refuses), fill-missing-fields only,
  provenance appended, embedding + reference re-resolution + similarity
  vs existing papers. Metadata-only papers carry no chunks/PDF;
  `POST /papers/{id}/pdf` attaches one later via the standard pipeline.

## Implemented in the automatic-landscape slice (ONE seed → discovery)

- `landscape_runs(project_id PK, seed_paper_id, status, step, report_json,
  error, started_at, updated_at)` — latest automatic build per project;
  truthful run state for the UI: `running` + real phase names in `step`
  (never percentages), run-level `status` reaches `complete` even when a
  channel is honestly `partial`, `report_json` holds the per-channel
  report (retrieved/created/edged/below_threshold/errors…).
- `paper_discovery` is the append-only provenance trail (its
  `source_type` column): seed = `user_import`; automatic discoveries =
  `citation_discovery` / `cited_by_discovery` / `semantic_discovery`,
  each row carrying `query`, `source_paper_id` (the seed) and `search_id`
  where a persisted search produced it. A paper found by two routes keeps
  ONE `papers` row with two `paper_discovery` rows (multi-route dedupe —
  observed live: 2 dual-route nodes).
- `citation_edges.source` doubles as the landscape edge `mechanism`
  (`reference_extraction` for resolved seed references,
  `pubmed_citedin` for citer→seed edges); semantic edges come from
  `paper_similarity` and carry the stored cosine with an empty mechanism
  (the value is never re-labeled).
- Discovery searches persist as `searches`/`search_results` rows;
  `search_id` links them back into `paper_discovery`.
- Policy lives in `config/pipeline.yaml` (`landscape:` block):
  `auto_discover`, `max_reference_resolutions: 15`, `max_cited_by: 10`,
  `max_candidates_pubmed: 10`, `max_candidates_arxiv: 10`,
  `similarity_min: 0.30` (calibrated 2026-09-23: related 0.37–0.57 vs
  unrelated ≤0.22).
- HTTP fixtures for the dedicated check: `Liit/fixtures/http/<sha1(url)>.body|.url`,
  written with `LIIT_HTTP_RECORD_DIR` (live run) and served from disk with
  `LIIT_HTTP_REPLAY_DIR` (replay run). A missing fixture is an honest
  channel error (`replay fixture missing: …`) surfaced in the UI banner
  with **Retry discovery**.
