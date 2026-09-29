"""Ingestion tests: real PDF -> sections -> chunks -> manifest -> DB."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    monkeypatch.setenv("LIT_REVIEW_DB", str(db))
    # Isolate local file storage per test run.
    import backend.app.pipeline as pl
    monkeypatch.setattr(pl, "paper_dir",
                        lambda pid: Path(tmp_path / "papers" / pid).mkdir(
                            parents=True, exist_ok=True) or
                        Path(tmp_path / "papers" / pid))
    from backend.app.database import init_db
    from backend.app.main import app
    init_db(db)
    return TestClient(app)


def _make_pdf(path: Path):
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    # Separate text blocks (distinct y positions) so the block-level
    # sectioner sees each heading as its own block, like real PyMuPDF output.
    lines = ["Abstract", "Some abstract text about decision making.",
             "Introduction", "Background on visual decisions.",
             "Methods", "Participants",
             "Twelve adults participated in the task.",
             "Results", "Accuracy improved with training.",
             "References", "[1] Someone et al."]
    y = 72
    for line in lines:
        page.insert_text((72, y), line)
        y += 36
    doc.save(str(path))
    doc.close()


def test_upload_ingests_pdf(client):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as t:
        tpath = t.name
    try:
        _make_pdf(Path(tpath))
        with open(tpath, "rb") as f:
            r = client.post(f"/api/projects/{pid}/papers/upload",
                            files={"file": ("test.pdf", f,
                                             "application/pdf")})
    finally:
        os.unlink(tpath)
    assert r.status_code == 200, r.text
    body = r.json()
    paper_id = body["id"]
    assert body["status"] in ("complete", "partial")
    assert body["pages"] == 1
    assert body["chunks"] >= 1

    r = client.get(f"/api/papers/{paper_id}/processing-status")
    assert r.json()["extraction_status"] in ("complete", "partial")

    r = client.get(f"/api/papers/{paper_id}/sections")
    names = [s["name"] for s in r.json()]
    assert "methods" in names or "abstract" in names

    r = client.get(f"/api/papers/{paper_id}/chunks")
    chunks = r.json()
    assert len(chunks) >= 1
    c = chunks[0]
    assert c["chunk_id"] and c["section"] and c["text"]
    assert c["text_hash"]  # manifest-grade provenance


def test_upload_rejects_non_pdf(client):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    r = client.post(f"/api/projects/{pid}/papers/upload",
                    files={"file": ("x.txt", b"hello", "text/plain")})
    assert r.status_code == 422


def test_chunk_validation_dedupes():
    from backend.app.pipeline import validate_chunks
    from src.chunking.schema import Chunk
    chunks = [
        Chunk(paper_id="p", section="methods", chunk_id="methods_001",
              text="real content here with enough length", source_start="3",
              source_end="3"),
        Chunk(paper_id="p", section="methods", chunk_id="methods_002",
              text="real content here with enough length", source_start="3",
              source_end="3"),
        Chunk(paper_id="p", section="x", chunk_id="x_001", text="   "),
    ]
    valid, warnings = validate_chunks(chunks)
    assert len(valid) == 1
    assert any("duplicate" in w for w in warnings)
    assert any("empty" in w for w in warnings)
