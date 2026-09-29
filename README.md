# LiiT

Local-first literature workspace for scientists: search PubMed/arXiv, import explicitly,
read with structured evidence, and explore citation/semantic landscapes. The researcher
decides what enters a project; the system never ranks, recommends, or judges science.

## What currently works

- PDF ingestion, extraction, synthesis, metadata, references, embeddings
- PubMed search, arXiv search, explicit paper import, landscape data
- Interactive Library (papers, metadata, evidence, synthesis, references, full text, PDF upload/attach)
- Interactive Searches (live retrieval, explicit import, history)
- Interactive Landscape (paper nodes, cites + semantic-similarity edges, pan/zoom/select/detail)
- Projects (create/switch), Settings (backend connection check)
- Placeholders only: Saved, Notes, Methods, Learning (no fake data, no fabricated explanations)

## Launch LiiT locally (verified)

Backend (repo root, port 8000):

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn backend.app.main:app --port 8000
```

Frontend (port 8443, talks to the backend above by default):

```bash
cd Liit
npm install
npm run dev -- --port 8443 --strictPort
# open http://127.0.0.1:8443/
# point at another backend with: VITE_API_BASE=http://host:port npm run dev
```

Headless interactive smoke test (needs Google Chrome, both servers running):

```bash
cd Liit
npm install   # includes puppeteer-core (dev)
node smoke.mjs
```

## MVP backend (Phase 1 done)

## Design

PDF → deterministic parsing → section-aware chunks → embedding model → small LLM → structured evidence → cross-section synthesis → landscape graph.

The LLM is not the graph engine. It supplies structured linguistic evidence. Citation extraction, metadata, chronology, similarity, and graph construction remain deterministic/application-controlled.

## Planned stages

1. Parse a seed paper and separate Abstract, Introduction, Methods, Results, Discussion.
2. Process each section independently with bounded context.
3. Keep section outputs linked by paper ID, section ID, chunk ID, and source location.
4. Synthesize section outputs with the Qwen3-1.7B teacher.
5. Distill the teacher outputs into a smaller student model (target: Qwen3-0.6B or another compact model).
6. Fine-tune the student on the landscape-extraction dataset.
7. Quantize the final student.
8. Benchmark quality, RAM, CPU, latency, and energy proxies; generate performance plots.

## Modularity / future hidden states

Every model stage exposes an optional `hidden_state` artifact. Hidden states are disabled by default and are stored separately from textual evidence. This lets us add representation-level features later without redesigning the pipeline.

## MVP backend (Phase 1 done)

- FastAPI + SQLite skeleton: `backend/app/` (projects + paper metadata).
- Docs: `ARCHITECTURE.md`, `API.md`, `DATA_MODEL.md`, `DEVELOPMENT.md`.
- Frontend shell: `Liit/` + typed client `Liit/src/lib/api.ts`.

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python -m pytest backend/tests -v
.venv/bin/python -m uvicorn backend.app.main:app --reload --port 8000
```

## Discovery (search → explicit import → landscape expansion)

- `POST /api/projects/{id}/search/pubmed|arxiv` retrieves ranked results
  (E-utilities / arXiv API, stdlib HTTP, persisted with the query).
- `POST /api/search/import` imports ONE explicitly named result:
  dedup by DOI → PMID → arXiv ID, missing-fields-only fill, provenance
  appended, embedding generated, references re-resolved, similarity
  computed vs existing papers. Metadata-only papers have no chunks/PDF.
- `GET /api/landscape/{project_id}` returns paper nodes + `cites` and
  `semantic_similarity` edges as data.

Search results are retrieval results. The system does not assign scientific relevance or recommend papers.

## Resource principle

The LLM should be on-demand, not continuously running. Parsing, metadata, references, embeddings, chronology, and graph construction should not require the LLM.
