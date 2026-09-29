# LiiT MVP Final Report — 2026-09-23

Pass/fail verdicts only; every number below comes from a command actually
executed on 2026-09-23 against isolated databases.

> **Headline (Phases 0–14, executed 2026-09-23): ONE SEED PAPER →
> AUTOMATIC DISCOVERY → MULTI-PAPER LANDSCAPE.** A single PDF upload now
> triggers bounded first-degree discovery (references, PubMed cited-by,
> local semantic similarity) and grows the multi-paper Landscape with
> typed provenance and no LLM ranking. See **§8** for the dedicated
> check's results, the 102 → 103 → 113 test reconciliation, the
> similarity-floor calibration, and the AND-first-3 seed-query policy.

## 1. Scope and changes

Changes made to complete the functional MVP (Phases 1–12):

| File | Change |
| --- | --- |
| `docs/MVP_RUNBOOK.md` | Phase 1 runbook: 13 topics, real commands/ports only; added the arXiv check line, the exact isolated-DB backend command, and the `pipeline_check` failure-fixture prep (isolated copy only). |
| `docs/MVP_ACCEPTANCE_TEST.md` | Phase 10 checklist (48 items), all flipped `[x]` after execution; evidence pointers to this report. |
| `Liit/mvp_check.mjs` | New real-user e2e: full 21-step workflow through the real upload UI + real backend (72 checks). Deadline-based polling (`pollUntil`) instead of unbounded waits; synthesis gated on the enabled button; check 33's text match fixed (trailing `\b` could never match concatenated JSX `textContent`). |
| `Liit/mvp_check_arxiv.mjs` | New arXiv-branch e2e (20 checks): search-only, no import, no LLM; same polling helpers. |
| `Liit/pipeline_check.mjs` | Harness hardening only: `waitForFunction` → deadline polling, `clickText` now waits/retries for rows rendering on independent fetches, and the `384d · model` row text is polled (it lands one `refresh()` after the stats line). |
| `Liit/landscape_check.mjs` | Same harness hardening (`pollUntil`, retrying `clickText`). |
| `backend/app/routers/ingest.py` | Ghost-paper fix: new `_validate_upload(file)` rejects non-PDF (422, same message) and >100 MB (413) **before** `create_paper`, so rejected uploads leave no orphan rows. |
| `docs/MVP_FINAL_REPORT_2026-09-23.md` | This report. |

No features were removed or redesigned; no app endpoint was duplicated;
no expensive LLM call was auto-triggered by opening a paper.

## 2. How to launch

```bash
cd "/Users/mathewcherian/Desktop/lit review assistant/lit review assistant"

# Backend on :8000 (omit LIT_REVIEW_DB to use the research DB data/lit_review.db)
LIT_REVIEW_DB=/tmp/liit_demo.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000

# Frontend on :8443 (separate terminal; already running in this session)
cd Liit && npm run dev -- --port 8443 --strictPort
```

Open http://127.0.0.1:8443/ — full details in `docs/MVP_RUNBOOK.md`.

## 3. Self-test steps (exact commands)

All commands run from the repo root unless noted. Every test uses a
throwaway database; `data/lit_review.db` is never written.

```bash
# 1. Backend tests (isolated DB)
LIT_REVIEW_DB=/tmp/liit_pytest.db .venv/bin/python -m pytest backend/tests -q

# 2. Frontend typecheck + production build
cd Liit
npx tsc --noEmit
npm run build
cd ..

# 3. Fresh isolated DB for the real-user e2e, start backend on it
cp data/lit_review.db /tmp/liit_mvp_e2e_2026-09-23.db   # or start empty: schema auto-creates
LIT_REVIEW_DB=/tmp/liit_mvp_e2e_2026-09-23.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000

# 4. With the frontend on :8443, run the UI checks (Liit/):
cd Liit
node mvp_check.mjs          # real-user workflow e2e (exit 0 = pass)
node mvp_check_arxiv.mjs    # arXiv branch (run before steps 5-6; they reset the DB)

# 5. Fresh research-DB copy + failure fixture, then the pipeline check
cd ..
kill $(lsof -ti :8000)
cp data/lit_review.db /tmp/liit_pipeline_check.db
sqlite3 /tmp/liit_pipeline_check.db \
  "UPDATE papers SET source_pdf_path='data/papers/paper_ff3962b4/original.pdf.missing' WHERE id='paper_ff3962b4';"
LIT_REVIEW_DB=/tmp/liit_pipeline_check.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd Liit && node pipeline_check.mjs

# 6. Fresh copy again, then the landscape check
cd ..
kill $(lsof -ti :8000)
cp data/lit_review.db /tmp/liit_landscape_check.db
LIT_REVIEW_DB=/tmp/liit_landscape_check.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd Liit && node landscape_check.mjs
```

Exit code 0 from each `*_check.mjs` means every printed check passed.
Screenshots: `/tmp/liit_mvp_*.png`, `/tmp/liit_mvp_arxiv_*.png`,
`/tmp/liit_pipeline_*.png`, `/tmp/liit_landscape_*.png`.

## 4. Automated validation results (executed, not claimed)

| Test | Command | Result | Verdict |
| --- | --- | --- | --- |
| Backend tests | `pytest backend/tests -q` (isolated DB) | **102 passed** in 22.43 s (re-run after the ghost-paper fix) | **PASS** |
| Frontend typecheck | `npx tsc --noEmit` | exit 0, no diagnostics | **PASS** |
| Production build | `npm run build` | built successfully, 290.52 kB JS | **PASS** |
| Real-user e2e | `node mvp_check.mjs` | **72/72 checks**, `ALL CHECKS PASSED`, exit 0; timings `{"upload_s":0,"extract_s":262,"synthesize_s":52,"embed_s":0}` | **PASS** |
| arXiv branch e2e | `node mvp_check_arxiv.mjs` | **20/20 checks**, `ALL CHECKS PASSED`, exit 0 | **PASS** |
| Pipeline UI check | `node pipeline_check.mjs` | **34/34 checks**, `ALL CHECKS PASSED`, exit 0 | **PASS** |
| Landscape UI check | `node landscape_check.mjs` | **66/66 checks**, `ALL CHECKS PASSED`, exit 0 | **PASS** |

**Did the real e2e pass? YES** — `mvp_check.mjs` drove the real upload UI
against the real backend with a repo PDF and passed 72/72 (official run),
plus a separate arXiv run 20/20. Three earlier runs failed only on check
33's broken regex (harness bug), fixed as described in §1.

Isolation evidence: `data/lit_review.db` mtime is `Sep 22 18:23:59` (all
automated runs used `LIT_REVIEW_DB=/tmp/...`); `data/papers/` was diffed
against the pre-run baseline, the 8 run-created paper dirs were removed,
and the listing now matches the baseline exactly.

## 5. Real-user workflow evidence (what was observed in the UI)

From the official `mvp_check` run (real headless-Chrome UI, real backend):

- Upload → extraction `partial · 13/15 chunks · 33 items` (~4.4 min, busy
  state visible), processing stats `18 pages → 15 chunks (complete)`.
- Evidence tab: 33 items with provenance; Methods: `Method evidence · 9 items`.
- Synthesis `complete` with per-statement source provenance.
- Embedding `384d · sentence-transformers/all-MiniLM-L6-v2`; Landscape
  `2 nodes · 2 edges` (semantic `0.2474`/`0.3063` + citation `cites` edge).
- PubMed search → explicit `+ Import` → paper enters Library + Landscape
  (embedded at import), provenance `pubmed_query`.
- arXiv run: Library 2→3, Landscape 2→3 nodes, provenance `arxiv_query`,
  round-trip open/return.
- Failure honesty: non-PDF upload rejected with visible `only .pdf uploads
  supported` (422) + retry, zero orphan rows; pipeline check proved the
  `stored PDF missing` (422) path surfaces in the UI with no silent no-op;
  landscape check proved API-failure → honest error + working Retry.
- Zero unexpected JS/console errors in all four runs.

`pipeline_check`/`landscape_check` additionally verified: per-stage
running/complete/error states, cached evidence kept on failed runs
(`error · 0/15 chunks (13 already cached)`), stored similarity displayed
exactly (`0.12081029266119 → 0.1208`), citation edge `UNSET cites …`,
edge wording never "relevance", empty states exact
(`No papers in this landscape yet.`), and selection preserved across
Paper ↔ Landscape round trips.

## 6. Acceptance checklist

`docs/MVP_ACCEPTANCE_TEST.md`: **48/48 items `[x]` at MVP close**, every
one backed by an executed check named in §4 (startup/projects, ingestion,
analysis pipeline, reading experience, landscape, discovery incl. arXiv,
failure honesty, and the automated-validation section). Lines 84–95 of the
checklist (pytest, tsc, build, both pre-existing checks, both new e2e
checks, isolated-DB requirement) map one-to-one to the table in §4.
After the Phase 0–14 additions the checklist totals **59/59 items `[x]`**
(see §8) — still zero unchecked.

## 7. Remaining limitations

No MVP-blocking limitation remains: every acceptance item executed and
passed. Honest limitations that a user will notice:

1. **Teacher-model JSON failures on some chunks.** The local 1.7 B teacher
   returns malformed JSON for ~2/15 chunks of the test paper, so a re-run
   can report `error · 0/15 chunks (13 already cached)`. This is displayed
   honestly, cached evidence is preserved, and pressing the button retries
   only the failed chunks (runbook §12). Quality limitation, not a blocker.
2. **Extraction/synthesis are synchronous** (~4.4–4.6 min for 15 chunks,
   ~50 s synthesis) — a busy state is shown, but the UI waits on one long
   request. Nothing times out at MVP scale.
3. **`pipeline_check` needs its documented fixture** (§3 step 5): the
   research data's stored PDF is present, so the missing-file error state
   must be recreated on the isolated copy. Documented in the runbook.
4. **Out of MVP scope by design** (Phase 9): arXiv is search-only (no
   import), embeddings/synthesis/extraction run only on explicit user
   action, similarity is labeled "semantic similarity" (never "relevance"),
   and auth/collaboration/recommendations/gap detection/LLM ranking/
   training/Tauri are not part of this MVP.

## 8. ONE SEED PAPER → AUTOMATIC DISCOVERY → MULTI-PAPER LANDSCAPE (Phases 0–14)

Everything in this section was executed on 2026-09-23 against isolated
databases; `data/lit_review.db` was never written.

### 8.1 What shipped

| File | Change |
| --- | --- |
| `src/teacher/backend.py` | Metal-crash fix: process-wide `_METAL_LOCK` serializes `mlx_lm.generate` (shared unlocked backend → two concurrent generates → SIGABRT). |
| `src/search/replay.py` | New HTTP record/replay layer (`LIIT_HTTP_RECORD_DIR` / `LIIT_HTTP_REPLAY_DIR`, `sha1(url).body` + `.url` sidecar; missing fixture → honest `SearchError`). |
| `src/search/pubmed.py`, `arxiv.py` | Replay wrap; PubMed cited-by (ELink `pubmed_citedin`); `search_pubmed` fetches esummary + efetch abstracts so candidates carry title+abstract; arXiv queries wrapped `all:"…"`. |
| `config/pipeline.yaml` | New `landscape:` policy block (`auto_discover`, per-channel caps, `similarity_min: 0.30`) with the measured calibration in the comment. |
| `backend/app/database.py` | New `landscape_runs` table; `paper_discovery.source_type` provenance column. |
| `backend/app/store.py` | `ALLOWED_DISCOVERY` += `citation_discovery`, `cited_by_discovery`, `semantic_discovery`. |
| `backend/app/discovery.py` | New pipeline: seed metadata → references → cited-by → semantic (PubMed, arXiv) → final local `resolve_references` + route recording; embed-on-create; deterministic AND-first-3 `seed_query`; per-channel reports; run-level status `complete` even when a channel is honestly `partial`. |
| `backend/app/routers/ingest.py` | Upload / attach-PDF schedule automatic discovery via `BackgroundTasks` after the response — **only** those two triggers. |
| `backend/app/routers/knowledge.py` | `GET /api/projects/{id}/landscape/status` + `POST /api/projects/{id}/discover` (Retry; 422 when no PDF seed). |
| `backend/app/search.py` | Discovery rows expose `discovery_items` + source join; each discovery channel persists a `searches` row. |
| `backend/app/landscape.py`, `schemas.py` | Edge `mechanism` field (from `citation_edges.source`) for cites edges. |
| `Liit/src/lib/api.ts`, `Liit/src/components/Landscape.tsx` | Building banner with real phase names (no percentages), seed badge + teal ring, provenance via-line, `via <mechanism>` after `A cites B`, amber channel-error banner + **Retry discovery**. |
| `Liit/automatic_landscape_check.mjs` | New dedicated 15-check e2e for exactly this flow, with a `LIVE=1` toggle distinguishing the live run from the replay run. |
| `Liit/fixtures/http/` | New recorded fixture set: 43 pairs recorded in one live pass; one reference-DOI fixture intentionally withheld for the replay check. |
| `backend/tests/test_discovery.py` | New 10 tests: deterministic `seed_query`, LLM spies (any model touch fails the test), dedupe/multi-route, floor policy, trigger seam, config caps. |
| `docs/MVP_RUNBOOK.md`, `docs/MVP_ACCEPTANCE_TEST.md`, `docs/MVP_FINAL_REPORT_2026-09-23.md`, `DATA_MODEL.md` | Phase 14 documentation of this flow (this §8, the runbook section, the acceptance section, the data-model slice). |

### 8.2 Commands (repo root; every DB isolated, throwaway)

```bash
# 1. Backend tests
LIT_REVIEW_DB=/tmp/liit_pytest_final2.db .venv/bin/python -m pytest backend/tests -q

# 2. Frontend typecheck + production build
cd Liit && npx tsc --noEmit && npm run build && cd ..

# 3. LIVE one-seed run (real PubMed/arXiv; records every response)
LIT_REVIEW_DB=/tmp/liit_live_autodisc.db LIIT_HTTP_RECORD_DIR="$PWD/Liit/fixtures/http" \
  .venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd Liit && LIVE=1 node automatic_landscape_check.mjs && cd ..

# 4. REPLAY run (fixtures from disk; one reference-DOI fixture withheld)
kill $(lsof -ti :8000)
LIT_REVIEW_DB=/tmp/liit_replay_autodisc.db LIIT_HTTP_REPLAY_DIR="$PWD/Liit/fixtures/http" \
  .venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd Liit && node automatic_landscape_check.mjs && cd ..

# 5. Legacy checks on fresh research-DB copies (§3 steps 5-6, incl. the
#    documented .missing fixture for pipeline_check) — re-run today:
kill $(lsof -ti :8000)
cp data/lit_review.db /tmp/liit_pipeline_check.db
sqlite3 /tmp/liit_pipeline_check.db \
  "UPDATE papers SET source_pdf_path='data/papers/paper_ff3962b4/original.pdf.missing' WHERE id='paper_ff3962b4';"
LIT_REVIEW_DB=/tmp/liit_pipeline_check.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd Liit && node pipeline_check.mjs && cd ..
kill $(lsof -ti :8000)
cp data/lit_review.db /tmp/liit_landscape_check.db
LIT_REVIEW_DB=/tmp/liit_landscape_check.db .venv/bin/python -m uvicorn backend.app.main:app --port 8000 &
cd Liit && node landscape_check.mjs
```

### 8.3 Automated validation results (executed, not claimed)

| Test | Result | Verdict |
| --- | --- | --- |
| Backend tests (isolated DB) | **113 passed**, 6 warnings, 42.46 s | **PASS** |
| Frontend typecheck | `npx tsc --noEmit` exit 0, no diagnostics | **PASS** |
| Production build | `npm run build` ok — 294.31 kB JS (85.95 kB gz) + 18.09 kB CSS | **PASS** |
| Dedicated check, **LIVE** (real PubMed/arXiv) | **14 PASS + 1 SKIP** (check 15 is replay-only, skipped with a note), `ALL CHECKS PASSED`, exit 0 | **PASS** |
| Dedicated check, **REPLAY** (fixture set) | **15/15**, `ALL CHECKS PASSED`, exit 0 — incl. withheld-fixture banner + Retry | **PASS** |
| `pipeline_check.mjs` | every printed check PASS, exit 0 (35 PASS lines = 34 unique checks — the console-errors check prints twice, lines 130/268 — matching §4's 34/34) | **PASS** |
| `landscape_check.mjs` | **66/66**, `ALL CHECKS PASSED`, exit 0 | **PASS** |

**Test-count reconciliation 102 → 103 → 113:** 102 = MVP Phase 10
baseline (§4) → 103 = Metal-crash fix plus its regression test
(`test_teacher_serialization.py`, process-wide `_METAL_LOCK`) → 113 =
the automatic-discovery feature's new `backend/tests/test_discovery.py`
(10 tests) with `test_search.py::test_import_metadata_only` extended for
the new `source` field. Per-file totals today: synthesis 27, extraction
22, search 16, knowledge 15, chunking 15, discovery 10, ingest 3,
api 3, teacher 1 + 1 = **113**.

Isolation evidence: every run used `LIT_REVIEW_DB=/tmp/…`;
`data/papers/` was diffed against the pre-run baseline (5 run-created
dirs removed; listing restored 50 = 50); all `/tmp/liit_*` throwaway DBs
were deleted afterwards; `data/lit_review.db` was never opened for
write. `mvp_check.mjs`/`mvp_check_arxiv.mjs` were **not** re-run (see
§8.8) — no claim is made about them in this round.

### 8.4 Live-run evidence: one seed upload → multi-paper landscape

Seed `data/papers/paper_51af6fc3/original.pdf` (18 pp) uploaded through
the real UI (seed id `paper_58573c65`, provenance `user_import`); the
script's only other actions were observation.

Final state: **24 nodes · 25 edges** (14 cites + 11 semantic), UI counts
matching the API exactly.

| Channel | Status | Numbers |
| --- | --- | --- |
| `seed_metadata` | `skipped` | seed has no DOI/PMID/abstract — nothing to resolve, no HTTP (honest skip) |
| `references` | `complete` | retrieved 15, created 12, unresolved 3, **edges 14** |
| `cited_by:pubmed` | `skipped` | seed has no PMID; arXiv exposes no cited-by API — nothing fabricated |
| `semantic_discovery:pubmed` | `complete` | retrieved 10, created 10, edged 10, below floor 0 |
| `semantic_discovery:arxiv` | `complete` | retrieved 1, edged 1, below floor 0 |

- Stored cosines: **0.3644 – 0.6071** (11 values), every one ≥ 0.30.
- `edges: 14` vs `created: 12`: the final local `resolve_references`
  matched two further seed references against nodes that semantic
  discovery had already created → **2 dual-route nodes** (one node
  carrying both `citation_discovery` and `semantic_discovery`
  provenance rows) — dedupe-to-one-node with multi-route provenance
  observed live, with no duplicate edges (edge PKs).
- Truthful busy states: real phase names only (`resolving references |
  searching PubMed | searching arXiv`, `constructing relationships`,
  `embedding candidates`) — no percentages anywhere; run-level status
  `complete`.
- No LLM on discovered papers: check 11 verified all 23 discovered
  papers have no chunks/PDF/extraction/synthesis, and the unit spies on
  `extraction.get_backend` / `synthesis.get_backend` /
  `run_paper_extraction` / `run_paper_synthesis` fail if touched.
- No ranking/recommendation wording: checks 7 and 9b assert only
  `_discovery` route names and edge text `A cites B` + `via
  reference_extraction` with no "similarity"/"relevance" on cites
  edges; nothing is labeled "recommended".

### 8.5 Seed-query policy: AND-first-3 (decided with live evidence)

`seed_query` = the first **3** significant terms (title first, topped up
from the abstract; first-seen order — deterministic, metadata-only, no
scoring), joined with `AND`:

- PubMed: `"Term1"[Title/Abstract] AND "Term2"[Title/Abstract] AND "Term3"[Title/Abstract]`
- arXiv: `"Term1" AND "Term2" AND "Term3"` (client wraps `all:"…"`)

Evidence: AND over all 8 seed terms → 0 hits; the original OR query →
retrieved noise embedding ≤ 0.22 → zero semantic edges ever; AND-first-3
tested exactly as the pipeline builds it → PubMed 10/10 on-topic hits
clearing the floor, arXiv 1 hit (0.3644).

### 8.6 Similarity-floor calibration (why 0.30 stands; config unchanged)

Positives = the seed's own reference list (12 genuine first-degree
papers): **0.37–0.57, 12/12 clear**. Negatives = 20 live-retrieved but
unrelated candidates: **max 0.22, 0/20 clear**. The floor `0.30` sits in
the empty gap **[0.22, 0.37]**; sub-threshold candidates are counted
honestly (`below_threshold`), never silently dropped from the report.

### 8.7 Replay-run evidence: honest failure + Retry

43 fixture pairs were recorded in the one live pass; one reference-DOI
esearch fixture (`10.1152/jn.90629.2008`) was then deliberately withheld
(42 pairs remain). The replay run (fresh DB, no network) reported
`references: partial` with the real message `replay fixture missing: …`,
showed the amber banner (check 14: `api_errors=1 banner=true
retry=true`), and **Retry discovery** re-ran the build to `complete`
with a new `started_at` (check 15) — 23 nodes / 24 edges consistent
throughout.

### 8.8 Known limitations (honest)

1. **`mvp_check.mjs` was not executed in this round** — it is not in the
   required Phase 13 list, and its exact-count steps (fixed node/edge
   totals) conflict with automatic discovery, which now legitimately
   grows the graph on upload. The script was deliberately left
   unmodified rather than massaged; treat its §4 numbers as the MVP-run
   record.
2. **Cited-by and seed-metadata skip on this seed** (no PMID/DOI).
   Cited-by is implemented and unit-tested against PubMed ELink
   `pubmed_citedin`; arXiv has no cited-by API and none is invented.
   The alternative candidate seed had zero citers anyway, so a skip is
   the honest outcome either way.
3. **First `pipeline_check` attempt failed 1/34** solely because the
   documented `.missing` precondition (§3 step 5 / runbook §13) was
   skipped in setup; with the runbook followed exactly it passed fully —
   a setup omission, not a code regression.
4. Discovered papers never receive extraction/synthesis (by
   requirement): their nodes are metadata + abstract + references +
   embedding only.
5. §7's limitations (teacher JSON failures, synchronous long requests)
   still apply unchanged.
