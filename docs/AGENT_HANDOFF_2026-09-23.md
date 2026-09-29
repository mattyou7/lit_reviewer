# LiiT Current State — 2026-09-23

Factual handoff report produced by inspecting the repository, running the
test/build commands, and reading the existing implementation. No code was
modified before this report was written.

Repository root: `lit review assistant/lit review assistant/`
(git branch `front_end`, last commit `f0b3d5b "adding frontend and api"`;
many files are still uncommitted/untracked — see §6).

## 1. Repository structure

```
backend/app/            FastAPI app (entry point: backend/app/main.py)
  routers/              health, projects, papers, ingest, extract,
                        synthesize, knowledge (metadata/references/
                        citations/embeddings/similarity/landscape), search
  pipeline.py           PDF -> sections -> chunks -> manifest (SQLite)
  extraction.py         chunk -> teacher LLM -> validated evidence
  synthesis.py          evidence -> teacher LLM -> structured synthesis
  embeddings.py         title+abstract(+synthesis) -> MiniLM vector
  landscape.py          cosine similarity + landscape graph data
  metadata.py           deterministic PDF metadata + per-stage status
  references.py         deterministic reference extraction/resolution
  search.py             search persistence + explicit import
  store.py, database.py, schemas.py
backend/tests/          pytest suite (8 files)
src/                    existing pipeline library (untouched by API layer)
  pdf/extract.py        PyMuPDF page extraction
  chunking/             sectioner + chunker + validation schema
  teacher/              MLX Qwen3-1.7B backend, prompts, extraction and
                        synthesis validation
  embeddings/backends.py  sentence-transformers MiniLM backend
  search/               pubmed.py, arxiv.py, common.py
  landscape/, student/, evaluation/   mostly placeholders / research code
Liit/                   React 19 + TS + Vite + Tailwind v4 frontend
  src/App.tsx           shell: sidebar nav + view switching (no router)
  src/components/       Library, Landscape, Discovery (Searches), Projects,
                        Settings, Saved, Notes, Methods, Learning
  src/lib/api.ts        the ONLY place the frontend talks to the backend
  src/lib/states.tsx    shared Loading/Err/Empty/StatusChip states
  smoke.mjs             headless-Chrome interactive smoke test
config/pipeline.yaml    chunking/teacher/embedding configuration
docs/, API.md, ARCHITECTURE.md, DATA_MODEL.md, DEVELOPMENT.md
data/                   lit_review.db (SQLite), papers/<id>/original.pdf
```

Storage: stdlib `sqlite3`, no ORM. DB path `data/lit_review.db`, overridable
with `LIT_REVIEW_DB` (tests and the smoke backend use this).

## 2. Backend status

All statuses below were verified by reading the route/service code; the
pytest suite covering them passes (see §5). All pipeline endpoints are
**synchronous** — there is no job queue and no server-side progress
streaming; long LLM calls block the request until they return stats.

| Subsystem | Status | Evidence |
|---|---|---|
| project management | implemented | `routers/projects.py`, CRUD + list, tested |
| PDF ingestion | implemented | `POST /projects/{id}/papers/upload`, `POST /papers/{id}/pdf`, `pipeline.ingest_pdf`, 100MB/422 guards |
| parsing/chunking | implemented | `src/pdf`, `src/chunking`, `GET /sections`, `GET /chunks`, manifest file per paper, status `pending\|parsing\|chunking\|complete\|partial\|error` |
| extraction | implemented | `POST /papers/{id}/extract` (sync, `force`/`limit`/`chunk_ids`), idempotent skip per `(model,prompt,schema)`, retry only failed chunks, `GET /evidence`; requires local MLX teacher (installed in `.venv`) |
| synthesis | implemented | `POST /papers/{id}/synthesize` (`force`), cached when complete, hierarchical fallback, provenance resolved to chunk/section/page, `GET /synthesis` (404 when none) |
| metadata | implemented | deterministic PDF-info + regex, per-field provenance table, `GET/POST /papers/{id}/metadata` |
| references | implemented | deterministic split/parse/resolve + citation edges, `GET/POST /papers/{id}/references`, `GET /citations` |
| embeddings | implemented | `POST /papers/{id}/embeddings` (`force`, hash-skip), `GET /papers/{id}/embedding-status` (stage row `pending\|complete\|error` + stored vectors), MiniLM-L6-v2 384d local |
| semantic similarity | implemented | cosine over stored vectors, `GET /papers/{id}/similarity`, `GET /projects/{id}/similarity` computes-and-stores missing pairs (O(N²), documented) |
| PubMed | implemented | `src/search/pubmed.py` (E-utilities, stdlib HTTP) + `POST /projects/{id}/search/pubmed` |
| arXiv | implemented | `src/search/arxiv.py` + `POST /projects/{id}/search/arxiv` |
| import | implemented | `POST /search/import` — explicit single result, dedup DOI→PMID→arXiv, fill-missing only, embedding + reference re-resolution + similarity |
| landscape | implemented | `GET /landscape/{project_id}` — paper nodes + `cites` + `semantic_similarity` edges as data (no rendering, no ranking) |

No backend endpoint required by this slice was missing; **no new backend
endpoint was created**.

## 3. Frontend status

| View | Status | Notes (verified from the component) |
|---|---|---|
| Projects | implemented | list, create, select/switch active project |
| Library | implemented | three-panel (projects/papers/detail), filter, PDF upload, status chips, live polling while a paper is mid-ingest |
| Paper detail | implemented (gaps closed in this slice) | tabs Overview/Methods/Evidence/Synthesis/References/Full Text/Code/Learn; had process/extract/synthesize actions but **no embedding action or embedding status** and **no single analysis-status area** before this slice |
| Full Text | implemented | rendered from `GET /sections` with page provenance |
| Evidence | implemented | rendered from `GET /evidence`; "Run extraction" wired to `POST /extract` |
| Synthesis | implemented | rendered from `GET /synthesis` with per-item source provenance (`chunk_id`, page); "Run synthesis" wired to `POST /synthesize` |
| Methods (per paper) | implemented | method categories filtered from already-loaded evidence |
| References | partial | list rendered; `POST /papers/{id}/references` (re-run) has **no UI action** |
| Discovery (nav "Searches") | implemented | PubMed/arXiv search, history, explicit import, "Open paper" |
| Landscape | implemented | SVG graph, cites/similarity edges, filters, pan/zoom, node detail; refreshes on import via a token, but **nothing refreshed it after embedding** before this slice |
| Saved | placeholder | honest "not built yet" empty state |
| Notes | placeholder | honest empty state |
| Learning | placeholder | honest empty state |
| Methods (sidebar view) | placeholder | honest empty state, points at per-paper Evidence |
| Settings | implemented | real `GET /api/health` connection check |

Unused-but-declared client calls before this slice: `embedPaper`,
`embeddingStatus`, `projectSimilarity`, `getMetadata`, `listCitations`,
`listChunks`, `discovery`, `getSearch`.

## 4. API integration

Endpoints actually connected to the frontend (via `Liit/src/lib/api.ts`):

- `GET /api/health` — Settings
- `GET|POST /api/projects` — App shell, Projects
- `GET /api/projects/{id}/papers` — Library list
- `GET /api/papers/{id}` — paper detail
- `POST /api/projects/{id}/papers/upload` — Library "Upload PDF"
- `POST /api/papers/{id}/pdf` — paper detail "Attach PDF"
- `POST /api/papers/{id}/process` — "Re-run processing"
- `GET /api/papers/{id}/processing-status` — status polling
- `GET /api/papers/{id}/sections` — Full Text tab
- `GET /api/papers/{id}/evidence` — Evidence + Methods tabs
- `POST /api/papers/{id}/extract` — "Run extraction"
- `GET /api/papers/{id}/synthesis` — Synthesis tab
- `POST /api/papers/{id}/synthesize` — "Run synthesis"
- `GET /api/papers/{id}/references` — References tab
- `GET /api/projects/{id}/search/pubmed|arxiv`, `GET /api/projects/{id}/searches`,
  `POST /api/search/import` — Searches view
- `GET /api/landscape/{project_id}` — Landscape

Connected by this slice (already existed in `api.ts`, previously unused):

- `GET /api/papers/{id}/embedding-status`
- `POST /api/papers/{id}/embeddings`
- `GET /api/projects/{id}/similarity` (compute missing pairs after embedding)

Still declared but unused anywhere in the UI: `GET /metadata`,
`POST /metadata`, `POST /references` (re-run), `GET /citations`,
`GET /chunks` (used by this slice only for the chunk count),
`GET /discovery`, `GET /search/{id}`.

Doc inconsistency: `API.md` still ends with "Full-text/chunks/extraction/
landscape/search/tutor endpoints arrive in later phases" although all of
those (except tutor) exist.

## 5. Tests

Run on 2026-09-23 in this repository, before making changes:

- Backend: `.venv/bin/python -m pytest backend/tests -q` →
  **102 passed, 6 warnings in 22.86s**
- Frontend typecheck: `npx tsc --noEmit` (in `Liit/`) → **exit 0, no errors**
- Frontend build: `npm run build` → **success** (27 modules, built in 96ms;
  two non-fatal Vite config-loader deprecation warnings)
- A headless smoke test exists (`Liit/smoke.mjs`, needs Chrome + the
  isolated smoke stack on :8444/:8001) — **not re-run for this report**.

Environment facts verified while testing:

- `.venv` is Python 3.9.6 with fastapi 0.128.8, uvicorn, pymupdf,
  mlx-lm 0.29.1, sentence-transformers 5.1.2, torch 2.8.0 installed.
- Teacher model `Qwen/Qwen3-1.7B-MLX-8bit` and `all-MiniLM-L6-v2` are
  present in the HuggingFace cache (no download needed).
- Running processes found during reconnaissance: Vite on :8443 (default
  API base → :8000), Vite on :8444 (API base → :8001), uvicorn on :8001
  with `LIT_REVIEW_DB=/tmp/liit_smoke.db`. **No backend was running on
  :8000**, so the default frontend had no backend to talk to.

## 6. Known limitations (verified)

- Every pipeline endpoint is synchronous; a long extraction/synthesis
  blocks the HTTP request. The UI can only show a busy state, and a
  dropped connection mid-run leaves the client without the returned stats
  (the DB still records the outcome).
- `papers.extraction_status` only tracks the **ingest** pipeline (and is
  overwritten by extraction runs). Extraction/synthesis/embedding state
  lives in separate tables (`chunk_extractions`/`paper_evidence`,
  `paper_syntheses`, `paper_processing`), so the UI must compose several
  GETs to show one analysis status — there is no aggregate status endpoint.
- `GET /papers/{id}/evidence` returns evidence of **all** prompt/schema
  versions, so counts can exceed the current version's items.
- `GET /papers/{id}/synthesis` only returns the row for the *current*
  configured model + prompt version; older-version syntheses are invisible
  to the API (they remain in the DB).
- Re-running extraction without `force` skips chunks that succeeded under
  the current `(model, prompt, schema)` and retries only failures — a
  prompt-version bump therefore re-runs the whole paper.
- Landscape reads stored similarity pairs; it never computes them. Pairs
  are created by `POST /search/import` or `GET /projects/{id}/similarity`.
- `GET /projects/{id}/similarity` is O(N²) over all papers (documented).
- Search history items re-run the query when clicked rather than opening
  the stored result (`GET /search/{id}` unused).
- The repository has uncommitted work: `backend/`, `Liit/src/lib/`,
  `API.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DEVELOPMENT.md`,
  `src/search/`, `src/teacher/{backend,extraction,synthesis}.py`,
  `src/embeddings/backends.py` are untracked; many frontend/pipeline files
  are modified and unstaged. The outer folder
  (`lit review assistant/.git`) is a separate git repo with **no commits**
  that merely contains this project plus a zip.
- `Liit/AGENTS.md` documents a Figma-Make scaffold (already-running Vite
  on `$PORT`); the project actually runs via `npm run dev -- --port 8443`.

## 7. Recommended immediate development slice

**Paper analysis pipeline — UI integration** (this is the slice implemented
immediately after this report).

The backend can already do the whole chain
(import → process → extract → synthesize → embed → landscape), and the UI
already had process/extract/synthesize buttons scattered across tabs. The
missing pieces that blocked the researcher from running the workflow
inside LiiT were:

1. No embedding step anywhere in the UI (`embedPaper`, `embeddingStatus`,
   `projectSimilarity` were declared in `api.ts` but never called), so a
   paper could never gain/update its vector or its semantic-similarity
   edges from the app.
2. No single place on the paper detail page that shows the actual
   ingestion / parsing+chunking / evidence / synthesis / embedding state
   at once, with the action appropriate to each stage.
3. No landscape refresh after embedding, so new similarity edges were not
   visible until an unrelated action reloaded the graph.

Everything else (Saved, Notes, Methods cross-paper, Learning, tutor,
collaboration, auth) is out of scope and correctly placeholdered in the UI.

---

## 8. Validation appendix (executed 2026-09-23)

All results below were produced by running the commands, not by inspection.

| Check | Command / method | Result |
|---|---|---|
| Backend test suite | `LIT_REVIEW_DB=/tmp/liit_test.db .venv/bin/python -m pytest backend/tests -q` (cold, then re-run) | **102 passed** both runs, 0 failures |
| Frontend typecheck | `npx tsc --noEmit` (in `Liit/`) | exit 0, no diagnostics |
| Frontend build | `npm run build` | success — 1768 modules, built in ~5s, no type errors |
| UI manual integration check | Headless-Chrome script `Liit/pipeline_check.mjs` against uvicorn `:8000` with `LIT_REVIEW_DB=/tmp/liit_handoff_2026-09-23.db` (a **copy** of `data/lit_review.db`; the real dev DB and `data/papers/` were never mutated) | **34/34 assertions passed**, exit 0 |
| Environment restored after check | stop test uvicorn; compare dev DB mtime | backend on `:8000` stopped (as found); `data/lit_review.db` mtime unchanged (Sep 22); `/tmp/liit_smoke.db` stack on `:8444`/`:8001` untouched |

### What the manual integration check covered (all performed)

1. **Baseline statuses** — Library overview shows all 5 pipeline rows with real backend values (paper `complete` 44,361 words; processing `complete`; extraction `complete 30/30 chunks`; synthesis `complete · 15,334 chars · prompt 1.3`; embedding `ready 384d · 8 papers`) and the Open Evidence / Open Synthesis links.
2. **Embedding from UI** — pressing **Generate embeddings** produced a visible busy state, then `ready 384d · 8 papers`, with stats line and an Open Landscape link. The Landscape view rendered the project as a graph (provenance/keyword nodes + `paper_001`/`paper_002` similarity edges, pair `0.5709`).
3. **Synthesis from UI** — pressing **Regenerate** gave a visible busy state, then `complete` with a fresh run timestamp and stats (`15,334 chars · 33 provenance chunks · 15 sources · 1,145ms · prompt 1.3`). The Synthesis view rendered section headings plus provenance markers `[paper_003 §1]` `[paper_001 §3]` `[paper_004 §5]`. The backend recorded **1 model call, 0 retries** — no wasted LLM work.
4. **Extraction from UI** — pressing **Re-run** produced a visible busy state; the run ended in a legitimate **failure that is shown, not hidden**: `0/15 chunks (13 already cached)` with `15 failed — json`. The previously cached evidence was **not destroyed** (Evidence view still shows all 30 cached results) and the row shows a Retry action. Cause: the teacher model emits malformed JSON on the `results_*` chunks (`failure_type: json`).
5. **Failure state surfaced in the UI** — the script's own snapshot restore (`PUT /papers/{id}` with `stored: true`) produced a real backend `422 stored PDF missing` error, and the UI's error banner displayed it verbatim (`HTTP 422: {"detail":"stored PDF missing..."}`) with no silent failure.
6. **Idempotency guard** — with extraction `status: complete`, the extract button renders as **Re-run**; no LLM endpoint is hit on page load (synthesis only fires when a `complete` row exists or the user presses the button).
7. **Metadata-only paper** — a `metadata_only` paper row renders with synthesis and extract actions **disabled** and no process button, matching the backend's rejection of those operations.
8. **No JS console errors** across all navigation and runs.

### Re-running the check

```bash
# terminal 1
cd "lit review assistant" && .venv/bin/python -m uvicorn backend.app.main:app --port 8000
# terminal 2
cd "lit review assistant/Liit" && npm run dev
LIT_REVIEW_DB=/tmp/liit_check.db node pipeline_check.mjs
```

`pipeline_check.mjs` expects the dev dataset (`paper_001`–`paper_004`, `test-project`) and the default API base (`http://127.0.0.1:8000`). It restores paper snapshots at the end but does **not** restore changed statuses (synthesis/extraction/embedding rows reflect the runs it performed) — point it at a DB copy if you want original statuses back.
