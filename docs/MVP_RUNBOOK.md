# LiiT MVP Runbook

Exact commands to launch LiiT locally and run the full demonstrable
workflow. Every command and port below was taken from this repository and
verified by running it (see `docs/MVP_FINAL_REPORT_2026-09-23.md`).

The headline flow is **ONE SEED PAPER → AUTOMATIC DISCOVERY →
MULTI-PAPER LANDSCAPE**: upload a single PDF and first-degree discovery
(the seed's reference list, PubMed cited-by, local semantic-similarity
search) builds the multi-paper Landscape automatically, with typed
provenance and no further user action (section 11 below).

Repository root for all commands unless stated otherwise:

```bash
cd "/Users/mathewcherian/Desktop/lit review assistant/lit review assistant"
```

Ports used by LiiT:

| Process | Port | Set by |
|---|---|---|
| Backend (FastAPI + uvicorn) | `8000` | `--port 8000` |
| Frontend (Vite dev server) | `8443` | `npm run dev -- --port 8443 --strictPort` |

The frontend calls the backend at `http://127.0.0.1:8000` by default
(`VITE_API_BASE` in `Liit/src/lib/api.ts` overrides it).

---

## 1. Prerequisites

- macOS on Apple Silicon — the teacher LLM runs through MLX (`mlx-lm`)
  and the embedding model through `sentence-transformers`.
- Python 3 (this repo's `.venv` is Python 3.9.6).
- Node.js + npm (verified with Node v26.8.1).
- Google Chrome at `/Applications/Google Chrome.app` — only needed for the
  automated headless checks (`Liit/*.mjs`), not for normal use.
- Disk for the local models (first run downloads them if they are not
  already in the HuggingFace cache):
  - teacher: `Qwen/Qwen3-1.7B-MLX-8bit` (`config/pipeline.yaml`)
  - embeddings: `sentence-transformers/all-MiniLM-L6-v2`

One-time setup:

```bash
# Python environment + API dependencies
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# Teacher-model runtime (MLX). scripts/setup_macos.sh also runs
# scripts/check_environment.py afterwards to verify the install.
.venv/bin/pip install mlx mlx-lm
#   — or: bash scripts/setup_macos.sh

# Frontend dependencies
cd Liit && npm install && cd ..
```

## 2. Backend startup

Terminal 1 (from the repository root):

```bash
.venv/bin/python -m uvicorn backend.app.main:app --port 8000
```

Expected output includes `Uvicorn running on http://127.0.0.1:8000`.

Verify:

```bash
curl http://127.0.0.1:8000/api/health
# {"status":"ok","service":"lit-review-assistant"}
```

Data location: SQLite at `data/lit_review.db` (this is the research
database). Override it with the `LIT_REVIEW_DB` environment variable —
see "Isolated demo database" below.

## 3. Frontend startup

Terminal 2 (from the repository root):

```bash
cd Liit
npm run dev -- --port 8443 --strictPort
```

Expected output includes `Local: http://localhost:8443/`.
`strictPort` makes Vite exit instead of silently moving to another port.

To point the frontend at a different backend:
`VITE_API_BASE=http://127.0.0.1:8001 npm run dev -- --port 8443 --strictPort`

## 4. URL to open

```
http://127.0.0.1:8443/
```

The sidebar shows the active project name under the LiiT logo. If the
backend is not running, the app shows
`Cannot reach the LiiT backend. Start it, then retry.` with a Retry
button — start Terminal 1 and press Retry.

## 5. Create a project

1. Click **Projects** in the sidebar.
2. Type a name into **New project name…** (press Enter or click **New project**).
3. The app switches to that project's empty Library:
   `Add a paper or search PubMed/arXiv.`

Each project keeps its own papers, searches, and Landscape.

## 6. Upload a PDF

1. Stay in **Library** (left column).
2. Click **Upload PDF** (enabled only when a project is active).
3. Pick a local `.pdf` file in the file dialog — no file path typing.
4. The button shows `Uploading & processing…` while the upload and the
   ingest pipeline run (upload is synchronous on the backend).
5. The new paper opens automatically as the paper detail view and appears
   in the Library list with its status chip.

Uploading (or **Attach PDF to this paper**) is also the *only* trigger
for automatic first-degree discovery — the Landscape starts building
right away (section 11). Search imports and explicit **Re-run
processing** do **not** trigger it.

## 7. Process it

Uploading already runs the ingest pipeline (parse → chunk → metadata →
references), and the **Overview → Analysis pipeline** rows show the real
backend state.

To re-run it explicitly:

1. Open the paper (Library list → click the paper).
2. On **Overview**, press **Re-run processing** (`Processing…` while busy).
3. The result line reports real stats:
   `Last processing run: N pages → M chunks (complete|partial)`.
4. The Processing row shows `N chunks · M sections` plus the status chip
   (`Pending / Parsing… / Chunking… / Complete / Partial / Error`).

## 8. Run extraction

1. On the paper's **Overview**, press **Extract evidence**
   (busy label `Extracting…`). The button is disabled until the paper has
   chunks, and nothing runs merely by opening the page.
2. Wait for `Last extraction run: <status> · X/N chunks (C already cached) · E items`.
   A first run over a full paper takes minutes (local LLM, one chunk at a time).
3. Open the **Evidence** tab to inspect the items: each card shows
   category, section, chunk id, and page provenance.

Re-runs are incremental: chunks that already succeeded for the current
(model, prompt, schema) are skipped and only failures are retried. Failed
runs never delete previously cached evidence.

### Read the Methods workspace (Library → paper → Methods)

After extraction, the **Methods** tab on the paper detail is the place to
read *what the authors actually did* — organized only from already-extracted
data (nothing is re-run by opening it):

1. Go to **Library** and click a paper (the sidebar **Methods** view is a
   per-project paper index: title, status chip, method-item count — open a
   paper from there to land directly on its Methods tab).
2. The **Methods** tab groups the paper's method-category evidence into
   fixed sections (Study/task, Participants/population/dataset,
   Stimuli/materials, Experimental design/procedure, Measures/variables,
   Methods, Computational methods/models, Statistical methods, Reported
   limitations), each header showing `Method evidence · N items`. Sections
   with no items are omitted.
3. Every item shows its provenance line
   `<section> [→ <subsection>] · p. <n> · <chunk_id>` — or the literal
   `SOURCE LOCATION UNKNOWN` when no page is recorded — plus an
   `evidence <id>` chip and an **Open in Evidence →** link that jumps to
   the highlighted card on the Evidence tab.
4. **Show source text** expands an item into `EXTRACTED INFORMATION` vs
   the verbatim `SOURCE TEXT` from the chunk (copy affordance; no quote is
   ever invented).
5. Items whose comparison/trade-off/rationale wording is attributable to
   the authors are chipped `AUTHOR-STATED` and also collected in a
   consolidated `AUTHOR-STATED — comparisons, trade-offs & rationale`
   block. LiiT never ranks or recommends; such wording only ever appears
   as attributed author text.
6. Honest states: a paper with no extraction shows *has not been run*
   (with the usual **Extract evidence** action, never auto-started), a
   metadata-only paper shows *has not been performed* with the action
   disabled, a partial run shows an amber banner with the real chunk
   counts (`GET /api/papers/{id}/extraction-status`), and a run that
   succeeded but produced no method items says so plainly.

### Learn in context (Library → paper → Full Text → Explain)

Learning (beta) explains text you select from the paper you are reading.
It never runs on its own — no call happens on open, upload, parsing,
extraction, synthesis, or discovery — and nothing is stored:

1. Open a paper and go to **Full Text**, then select any passage: a small
   **Explain** chip appears next to the selection (the selection is sent
   verbatim). The **Explain selection** toolbar button with no selection
   shows the honest hint instead of calling the tutor.
2. In **Methods**, every item has a **Learn** link: the tutor receives
   that extracted statement plus its verbatim source chunk and the
   evidence id.
3. A compact **Learning** panel opens over the paper: your `SELECTED TEXT`
   (quotation-styled, with section/subsection/page/evidence provenance and
   the paper title) beside the `EXPLANATION`, plus the local model and
   duration. Only one mode exists — **Explain** — because that is all the
   backend supports; there are no equation/code/method variants.
4. Honest states: `Explaining…` while the local model runs; the real
   error plus **Retry** if the call fails; `Learning is currently
   unavailable.` with the underlying reason when the MLX runtime cannot
   load; and an amber *available text does not contain enough
   information* notice when the selection itself is insufficient.
   **Explain again** re-asks with the same selection; **Close**/`Esc`
   returns to the paper.
5. Context stays bounded — the selection plus one surrounding paragraph
   (`POST /api/tutor/explain`, 6000/2500-char caps), never the whole
   paper — and switching papers drops the panel entirely.

## 9. Run synthesis

1. On **Overview**, press **Generate synthesis** (busy label
   `Synthesizing…`; disabled until evidence exists).
2. Wait for `Last synthesis run: complete · N fields populated`.
3. Open the **Synthesis** tab: structured fields (`research question`,
   `main results`, …) with a source line (`<chunk_id> p.<page>`) under
   every statement.

## 10. Generate embedding

1. On **Overview**, press **Update embedding** (busy label `Embedding…`).
2. Wait for `Last embedding run: complete · 384d` and the row
   `384d · sentence-transformers/all-MiniLM-L6-v2 · from …`.
3. The app then refreshes the project's stored similarity pairs
   (O(N²) over the project's papers) so new semantic-similarity edges
   reach Landscape; an `Open Landscape →` link appears in the run stats.

## 11. Open Landscape

1. Click **Landscape** in the sidebar.
2. Papers appear as nodes; edges are `cites` (solid, arrow) and
   `semantic similarity` (dashed).
3. Click a node → right panel shows metadata, identifiers, status,
   provenance (exact backend discovery values), relationships, and
   **Open Paper →**.
4. Hover/click an edge → explanation box:
   `Paper A cites Paper B` or `Semantic similarity: 0.1234` (stored value).
5. Filters (right panel): node search, edge-type checkboxes, minimum
   semantic similarity, publication year.

Honest empty states (not errors):
- `No papers in this landscape yet.`
- `Add more papers to explore relationships.` (single paper)
- `No semantic-similarity relationships are currently available.`

Discovery from the Landscape side: click **Search literature →** (or
sidebar **Searches**) → run a PubMed/arXiv search → press **+ Import** on
exactly the result you want. Nothing is imported automatically.

### ONE SEED PAPER → AUTOMATIC DISCOVERY → MULTI-PAPER LANDSCAPE

Uploading one seed PDF (section 6) automatically grows a multi-paper
Landscape, first degree only — every discovered paper connects to the
seed; nothing is crawled recursively.

- **Truthful building states.** While it runs the Landscape shows
  `Building landscape… <step>` with real phase names (`resolving
  references`, `searching PubMed`, `searching arXiv`, `constructing
  relationships`) — never fake percentages. The run finishes as
  `landscape ready` / `complete`.
- **Channels, with honest skips.** `references` (the seed's own
  reference list, DOI/arXiv resolved against PubMed, capped by
  `max_reference_resolutions`); `cited_by` (PubMed ELink
  `pubmed_citedin` — skipped when the seed has no PMID, and arXiv
  exposes no cited-by API, so none is ever invented);
  `semantic_discovery` from PubMed and arXiv (local
  `all-MiniLM-L6-v2` embeddings; a stored edge only when
  `cosine >= similarity_min`, sub-threshold candidates counted
  honestly).
- **Typed provenance.** The seed carries `user_import`; discoveries
  carry `citation_discovery`, `cited_by_discovery`, or
  `semantic_discovery` with the seed id/query. A paper reachable by two
  routes stays ONE node carrying both provenance rows (never
  duplicated).
- **No LLM on discovered papers.** Metadata, abstracts, references and
  embeddings only — extraction/synthesis remain explicit user actions.
- **Edge wording.** Cites edges read `A cites B` + `via <mechanism>`;
  semantic edges show the stored cosine value. Nothing is ever called a
  recommendation or "relevance".
- **Errors surface with Retry.** If a channel fails, an amber banner
  (`Discovery finished with channel errors`) lists the real messages
  with a **Retry discovery** button that re-runs the build; run status
  still completes truthfully (`partial` channels stay visible).
- **Policy knobs** live in `config/pipeline.yaml` under `landscape:`
  (`auto_discover: true`, `max_reference_resolutions: 15`,
  `max_cited_by: 10`, `max_candidates_pubmed: 10`,
  `max_candidates_arxiv: 10`, `similarity_min: 0.30` — calibrated
  2026-09-23: the seed's own reference list scores 0.37–0.57 with
  unrelated retrieved candidates ≤0.22, so 0.30 sits in the empty gap).

## 12. Stop the application

- Terminal 2 (frontend): `Ctrl+C`.
- Terminal 1 (backend): `Ctrl+C`.

Note: pipeline endpoints are synchronous. If you stop the backend while
an extraction/synthesis call is in flight, uvicorn finishes the in-flight
request first — press `Ctrl+C` a second time if it does not exit.

State lives in SQLite + `data/papers/`; stopping does not lose results.

## 13. Common errors and what they mean

| What you see | Meaning / fix |
|---|---|
| `Cannot reach LiiT backend at http://127.0.0.1:8000. Is it running?` or `Cannot reach the LiiT backend. Start it, then retry.` | Backend not running (or not on port 8000). Start Terminal 1, then press Retry. |
| uvicorn exits with `error while attempting to bind on address ... only one usage of each socket address` | Port 8000 is already taken (e.g. a previous uvicorn). Stop it (`lsof -nP -iTCP:8000 -sTCP:LISTEN`) or use another port. |
| Vite exits immediately: `Port 8443 is already in use` | `strictPort` is on — another dev server already holds 8443. Stop it, or run on a different port and open that URL. |
| `PDF upload failed: API 422: only .pdf uploads supported` | The selected file is not a `.pdf`. Choose a PDF. |
| `API 413: PDF exceeds 100MB` | Upload limit is 100 MB (`backend/app/routers/ingest.py`). |
| `Processing failed: API 422: no stored PDF to process` | This paper has no PDF (it was imported from a search). Use **Attach PDF to this paper** instead. |
| `Processing failed: API 422: stored PDF missing` | The stored file under `data/papers/<paper_id>/original.pdf` was deleted/moved. Re-attach the PDF. |
| `Extraction failed: ... mlx-lm ...` / teacher model errors | The MLX teacher runtime is missing in `.venv`. Run `.venv/bin/pip install mlx mlx-lm` and restart the backend. Model download happens on first use if the HuggingFace cache is empty. |
| `Last extraction run: error · 0/N chunks … N failed — json` | The teacher returned malformed JSON for those chunks. The failure is shown, cached evidence is preserved, and pressing the button again retries only the failed chunks. |
| Synthesis shows `Synthesis error` / `partial` with a message | The teacher did not return a valid structured synthesis; the message is the backend's own. Previously successful synthesis rows are not deleted by a failed re-run. |
| `Embedding failed: …` | `sentence-transformers` backend or the `all-MiniLM-L6-v2` model is unavailable; install requirements / let the model download, then press **Update embedding** again. |
| `PubMed search failed: API 422: …` (or a search that returns 0 results with an error) | NCBI rate-limiting (HTTP 429 is surfaced by the backend as 422) or network trouble. Wait ~15 s and run the search again; the backend already pauses between E-utilities requests. |
| `Landscape failed …` + **Retry** | Backend unreachable while loading the graph. Start the backend, press Retry — the app never shows an empty graph as if it had loaded. |
| `Building landscape… <step>` stays up | Automatic discovery is running (PubMed/arXiv/embedding are real network + CPU work). The banner shows the current phase name; if a channel fails you get the amber error banner below instead of a stuck spinner. |
| `Discovery finished with channel errors` + **Retry discovery** | One channel failed (e.g. a reference-DOI lookup); the message names it honestly. **Retry discovery** re-runs the whole build — this is proven by `automatic_landscape_check.mjs` using an intentionally withheld HTTP fixture. |
| `Project creation failed: …` / `Library failed …` | The API returned a real error (message is shown verbatim). Fix the cause and press Retry. |
| Backend log shows `404 ... GET /health` every few seconds | An external monitor polls `/health`; LiiT's endpoint is `/api/health`. Harmless. |

### Isolated demo database (recommended for demos and tests)

To demo or test without touching the research database, point the backend
at a separate file (the schema is created automatically on startup):

```bash
LIT_REVIEW_DB=/tmp/liit_demo.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000
```

The app itself does not depend on any pre-loaded project or data state:
a fresh database starts with zero projects and the workflow in sections
5–11 works from scratch with your own PDF.

### Automated end-to-end check (optional)

With both servers running (backend on an isolated DB copy):

```bash
cd Liit
node mvp_check.mjs        # full real-user MVP workflow through the UI
node mvp_check_arxiv.mjs  # arXiv discovery branch (search-only, no import)
node pipeline_check.mjs   # existing analysis-pipeline UI check
node landscape_check.mjs  # existing landscape interaction check
node automatic_landscape_check.mjs  # ONE SEED → AUTOMATIC DISCOVERY →
                                    # MULTI-PAPER LANDSCAPE (replay mode)
```

`methods_check.mjs` (the Methods-workspace check: sections, provenance,
source-text expansion, AUTHOR-STATED labelling, navigation, honest
not-analysed/partial states, recommendation-language scan) is the one
exception to the manual-backend rule below: it `VACUUM`s its own isolated
copy of the dev DB and **spawns its own backend on :8000** (fails fast if
the port is busy), so run it with only the frontend up:

```bash
cd Liit && node methods_check.mjs
```

`learning_check.mjs` (the contextual-Learning check: select → Explain,
paper association + verbatim text, bounded context, busy/error/retry
states, the Methods connection, no retained context across papers, exact
auto-trigger count) works the same way — its own isolated `VACUUM` copy
and its own backend on :8000 — but unlike the read-only checks it *does*
drive the local model (three real explanations), so allow a few minutes:

```bash
cd Liit && node learning_check.mjs
```

The backend for the other checks should run on a throwaway database, e.g.:

```bash
LIT_REVIEW_DB=/tmp/liit_mvp_e2e_2026-09-23.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000
```

`mvp_check.mjs` uploads `data/papers/paper_51af6fc3/original.pdf` by
default; use `MVP_PDF=/path/to/your.pdf` to run it with your own PDF.
Screenshots land in `/tmp/liit_mvp_*.png`.

`automatic_landscape_check.mjs` needs no pre-loaded data — it creates
its own project and uploads one seed PDF through the real UI. It has two
clearly distinguished modes:

```bash
# LIVE: real PubMed/arXiv traffic; every response is recorded as a fixture.
# (14 checks pass; check 15 skips — its subject only exists under replay.)
LIT_REVIEW_DB=/tmp/liit_live_autodisc.db \
  LIIT_HTTP_RECORD_DIR="$PWD/Liit/fixtures/http" \
  .venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd Liit && LIVE=1 node automatic_landscape_check.mjs

# REPLAY: the recorded fixture set, served from disk with no network.
# ONE reference-DOI fixture is intentionally withheld, so check 15 proves
# honest channel-error surfacing + the Retry button. (All 15 checks pass.)
kill $(lsof -ti :8000)
LIT_REVIEW_DB=/tmp/liit_replay_autodisc.db \
  LIIT_HTTP_REPLAY_DIR="$PWD/Liit/fixtures/http" \
  .venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd Liit && node automatic_landscape_check.mjs
```

`pipeline_check.mjs`'s failure-state step needs a paper whose stored PDF
is missing (the `stored PDF missing` error in section 12). The research
data normally has that file present, so recreate the missing-file state
on the **isolated copy only** (never on `data/lit_review.db`, and never
by deleting the real file):

```bash
cp data/lit_review.db /tmp/liit_pipeline_check.db
sqlite3 /tmp/liit_pipeline_check.db \
  "UPDATE papers SET source_pdf_path='data/papers/paper_ff3962b4/original.pdf.missing' WHERE id='paper_ff3962b4';"
LIT_REVIEW_DB=/tmp/liit_pipeline_check.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000
# then, with the frontend on :8443:
node pipeline_check.mjs
```

Each check script expects a backend whose data matches what it asserts
(e.g. `pipeline_check.mjs`/`landscape_check.mjs` exercise the existing
research projects), so copy the research DB fresh before each run —
scripts mutate their projects (embeddings, synthesis, extraction state).
