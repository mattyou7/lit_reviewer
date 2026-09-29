# Development

## Install / run backend / run tests

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
.venv/bin/python -m pytest backend/tests -v
.venv/bin/python -m uvicorn backend.app.main:app --reload --port 8000
```

## Import a PDF / run the ingestion pipeline

```bash
# via API (original PDF is copied to data/papers/<paper_id>/original.pdf):
curl -F "file=@paper.pdf" http://127.0.0.1:8000/api/projects/<proj_id>/papers/upload
curl http://127.0.0.1:8000/api/papers/<paper_id>/processing-status
curl http://127.0.0.1:8000/api/papers/<paper_id>/chunks
```

## Validate chunking quality (no LLM needed)

```bash
.venv/bin/python scripts/validate_chunks.py /path/to/paper.pdf paper_001
```

Reports sections, token stats, text-level overlap, duplication scan,
text coverage, provenance, suspicious headings, and determinism.
Exit non-zero on hard failures (loss/duplication/non-determinism).

## Frontend shell

```bash
cd Liit && pnpm install && pnpm dev   # Vite on $PORT; API base via VITE_API_BASE
```

## Import test paper / run extraction

Not yet (Phase 2: PDF ingestion). Existing prototype scripts
(`scripts/test_chunking.py`, `results/paper_001/`) remain untouched.
