# API (Phase 1)

Base: `http://127.0.0.1:8000`

| Method | Path | Notes |
|---|---|---|
| GET | /api/health | liveness |
| POST | /api/projects | `{name, description}` -> 201 |
| GET | /api/projects | list |
| GET | /api/projects/{id} | 404 if unknown |
| POST | /api/projects/{id}/papers | paper metadata only; 404 unknown project, 422 bad `discovery_source_type` |
| GET | /api/projects/{id}/papers | list for project |
| GET | /api/papers/{id} | 404 if unknown |
| POST | /api/projects/{id}/papers/upload | multipart PDF -> ingest (sections/chunks/manifest); 422 non-PDF, 413 >100MB |
| POST | /api/papers/{id}/process | re-run pipeline on stored PDF |
| GET | /api/papers/{id}/processing-status | status pending\|parsing\|chunking\|complete\|partial\|error + warnings |
| GET | /api/papers/{id}/sections | detected sections with page provenance |
| GET | /api/papers/{id}/chunks | validated chunks with source_start/source_end |
| POST | /api/papers/{id}/extract | run teacher extraction `{force, limit, chunk_ids}` -> stats |
| GET | /api/papers/{id}/evidence | validated evidence; filters `?section=&subsection=&category=` |
| GET | /api/papers/{id}/extraction-status | latest-attempt chunk state (read-only): `run` not_run\|complete\|partial\|failed + succeeded/failed/not_attempted + first error |
| POST | /api/papers/{id}/synthesize | run paper synthesis `{force}` -> stats (idempotent) |
| GET | /api/papers/{id}/synthesis | structured synthesis with evidence IDs + resolved sources |
| GET | /api/papers/{id}/metadata | resolved metadata with per-field source + candidates |
| POST | /api/papers/{id}/metadata | re-run metadata extraction from stored PDF |
| GET | /api/papers/{id}/references | extracted references with resolution status |
| POST | /api/papers/{id}/references | re-run reference extraction + resolution |
| GET | /api/papers/{id}/citations | outgoing + incoming citation edges |
| POST | /api/papers/{id}/embeddings | generate paper embedding `{force}` (local MiniLM) |
| GET | /api/papers/{id}/embedding-status | embedding status + stored versions |
| GET | /api/papers/{id}/similarity | stored similarity pairs for this paper |
| POST | /api/projects/{id}/embeddings | embed all papers `{force}` |
| GET | /api/projects/{id}/similarity | compute-store missing pairs, return all (O(N²)) |
| GET | /api/landscape/{project_id} | landscape DATA: paper nodes + cites/semantic_similarity edges |
| POST | /api/projects/{id}/search/pubmed | PubMed search `{query, max_results, year_min?, year_max?}` — retrieval only |
| POST | /api/projects/{id}/search/arxiv | arXiv search `{query, max_results}` — retrieval only |
| GET | /api/projects/{id}/searches | search history for a project |
| GET | /api/search/{search_id} | search record with ranked results |
| POST | /api/search/import | explicitly import one result `{project_id, search_id, external_id}` |
| GET | /api/papers/{id}/discovery | typed discovery trail for a paper |
| POST | /api/papers/{id}/pdf | attach a PDF to a metadata-only paper, run ingestion |
| POST | /api/tutor/explain | contextual tutor `{paper_id, text, context?, section?, subsection?, page?, evidence_id?}` -> `ok\|insufficient\|error\|unavailable` + explanation, model, duration, `truncated`; selection bounded to 6000 chars / context to 2500; 404 unknown paper or foreign/unknown `evidence_id`, 422 empty selection; nothing persisted, never auto-triggered |

Search results are retrieval results. The system does not assign scientific relevance or recommend papers.

The tutor endpoint above is implemented (beta, single general-explanation
mode); any endpoints not listed here arrive in later phases.
