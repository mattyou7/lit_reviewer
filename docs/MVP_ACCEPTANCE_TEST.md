# LiiT MVP Acceptance Test

Concise checklist of the demonstrable MVP: the workflow a researcher can
perform end-to-end in the UI, with no API calls and no manual file paths.
Adapted to the actual implementation (each item maps to a real screen or
backend behavior in this repository).

Extended for Phases 0–14: **ONE SEED PAPER → AUTOMATIC DISCOVERY →
MULTI-PAPER LANDSCAPE** — upload a single seed PDF and first-degree
discovery (the seed's references, PubMed cited-by, local semantic
similarity) grows the multi-paper Landscape automatically (dedicated
section below).

Legend: `[ ]` not yet validated in this run · `[x]` validated by execution
(validation evidence in `docs/MVP_FINAL_REPORT_2026-09-23.md`).

## Startup and projects

- [x] LiiT starts (backend :8000, frontend :8443 — see `docs/MVP_RUNBOOK.md`)
- [x] Frontend reaches the backend (Settings health check / no connection error)
- [x] Project can be created in the UI and becomes the active project
- [x] An existing project can be selected/switched

## PDF ingestion

- [x] Local PDF can be uploaded through the Library **Upload PDF** control
      (file dialog, no path typing)
- [x] Upload shows a busy/progress state (`Uploading & processing…`)
- [x] Uploaded PDF appears in the Library with a status chip
- [x] The paper opens automatically after upload
- [x] PDF can be (re-)processed explicitly (**Re-run processing**) with real
      page/chunk stats
- [x] Processing errors are visible (status `Error` + warning text), never silent

## Paper analysis pipeline (all on demand, never auto-triggered)

- [x] Evidence can be extracted (**Extract evidence**, busy state → run stats)
- [x] Evidence is displayed with provenance (category, section, chunk id, page)
- [x] Synthesis can be generated (**Generate synthesis** → run stats)
- [x] Synthesis is displayed with per-statement source provenance
- [x] Embedding can be generated (**Update embedding** → `384d` vector)
- [x] Running/completed/error states are shown per stage, and failed runs keep
      previously cached results

## Paper reading experience

- [x] Overview shows the analysis-pipeline status rows
- [x] Full Text renders parsed sections with page numbers
- [x] Evidence tab renders extracted items
- [x] Synthesis tab renders structured fields
- [x] References tab renders the extracted reference list (or an honest empty state)
- [x] Methods tab renders method evidence (or an honest empty state)
- [x] Missing content shows "Not available yet"/honest empty states — no
      generated placeholders

## Landscape

- [x] Uploaded paper appears in Landscape as a node after embedding
- [x] Node selection works and the detail panel shows metadata (title, authors,
      year, journal, identifiers, status)
- [x] Provenance is visible with exact backend values
- [x] Semantic similarity appears (as a stored value) once a second embedded
      paper exists
- [x] Citation relationships appear when references resolve
- [x] Edge explanations state the relationship ("A cites B" / "Semantic
      similarity: <value>") and never say "relevance"
- [x] Paper ↔ Landscape navigation works and preserves project + selected node

## Discovery

- [x] PubMed search works from the UI
- [x] arXiv search works from the UI
- [x] Search results can be explicitly imported (**+ Import**, nothing
      auto-imports)
- [x] Imported paper appears in the Library
- [x] Imported paper appears in Landscape (embedded at import) with its
      provenance (`pubmed_query` / `arxiv_query` + query + external id)
- [x] Imported paper can be opened and returned from

## ONE SEED PAPER → AUTOMATIC DISCOVERY → MULTI-PAPER LANDSCAPE

- [x] Uploading **one** seed PDF automatically builds a multi-paper
      Landscape with no further user action — upload/attach-PDF is the
      only trigger (search imports and explicit re-processing do not)
- [x] Discovery is first degree only: every edge touches the seed — no
      recursive crawl; per-channel caps come from `config/pipeline.yaml`
- [x] All channels report honestly: `references` complete, `cited_by`
      skipped when the seed has no PMID (arXiv exposes no cited-by API —
      nothing is fabricated), `semantic_discovery` for PubMed **and**
      arXiv
- [x] Provenance typed and seed-linked: `user_import` for the seed;
      `citation_discovery` / `cited_by_discovery` / `semantic_discovery`
      for discoveries; a paper reachable by two routes is ONE node with
      both provenance rows (dedupe proven live: 2 dual-route nodes)
- [x] No LLM extraction/synthesis runs on discovered papers (metadata,
      abstract, references, embeddings only) — enforced by design and by
      test spies that fail if any model backend is touched
- [x] Semantic edges only at `cosine >= 0.30` (calibrated 2026-09-23:
      related 0.37–0.57 vs unrelated ≤0.22); sub-threshold candidates
      counted honestly; stored cosines shown as-is, never
      "recommended"/"relevant"
- [x] Busy states truthful: real phase names, no fake percentages; the
      run completes as `complete`/`landscape ready` even when a channel
      is honestly `partial`
- [x] Channel errors surface in an amber banner with the real messages +
      **Retry discovery** re-runs to completion (proven with an
      intentionally withheld HTTP fixture)
- [x] Real one-seed live run (real PubMed/arXiv): seed → **24 nodes /
      25 edges** (14 cites + 11 semantic), cosines 0.3644–0.6071 all
      clearing the floor, zero recommendation wording anywhere in the UI
- [x] Dedicated check `Liit/automatic_landscape_check.mjs` passes in
      both modes: **replay 15/15**, **live 14 pass + 1 replay-only
      skip** (exit 0 each), driven only through the real upload UI

## Failure honesty

- [x] Backend/API errors are visible in the UI with the real message
- [x] Error states offer Retry where a retry makes sense
- [x] No silent failures (a failed operation never looks like a success)
- [x] Empty states are exact and honest (`No papers in this landscape yet.`,
      `No semantic-similarity relationships are currently available.`, …)

## Automated validation (must be executed, not claimed)

- [x] Backend test suite: `LIT_REVIEW_DB=<isolated>.db .venv/bin/python -m pytest backend/tests -q`
- [x] Frontend typecheck: `npx tsc --noEmit` (in `Liit/`)
- [x] Frontend production build: `npm run build` (in `Liit/`)
- [x] Existing `Liit/pipeline_check.mjs` passes
- [x] Existing `Liit/landscape_check.mjs` passes
- [x] New real-user end-to-end check `Liit/mvp_check.mjs` passes
      (real UI upload → process → extract → synthesize → embed → Landscape →
      search → import → Landscape → open imported paper → Library)
      — validated in the MVP run; **not re-run in Phase 13** (its
      exact-count steps conflict with automatic discovery; see the final
      report §8 limitation)
- [x] New arXiv branch check `Liit/mvp_check_arxiv.mjs` passes
      (arXiv search from the UI, no import, no LLM)
- [x] New dedicated check `Liit/automatic_landscape_check.mjs` passes:
      **replay 15/15 checks** (incl. the intentionally withheld fixture →
      error banner + Retry re-run) and **live 14 pass + 1 replay-only
      skip** with real PubMed/arXiv traffic (exit 0 in both modes) —
      driving only the real upload UI
- [x] All of the above ran against isolated databases; `data/lit_review.db`
      (research data) was not modified
