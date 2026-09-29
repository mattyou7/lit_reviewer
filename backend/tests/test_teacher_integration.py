"""Real-model integration: Qwen3-1.7B via mlx-lm on the real test PDF.

Skipped unless mlx-lm is importable AND a test PDF is available
(LIT_REVIEW_TEST_PDF or ~/Downloads/s41467-025-61010-x.pdf).
Runs on at most 2 chunks to bound resource use.
"""
import os
from pathlib import Path

import pytest

PDF = Path(os.environ.get(
    "LIT_REVIEW_TEST_PDF",
    str(Path.home() / "Downloads" / "s41467-025-61010-x.pdf")))

mlx_available = False
try:
    import mlx_lm  # noqa: F401
    mlx_available = True
except ImportError:
    pass

needs_model = pytest.mark.skipif(
    not mlx_available, reason="mlx-lm not installed")
needs_pdf = pytest.mark.skipif(not PDF.exists(),
                               reason=f"test PDF not found: {PDF}")


@needs_model
@needs_pdf
def test_real_teacher_two_chunks(tmp_path, monkeypatch):
    monkeypatch.setenv("LIT_REVIEW_DB", str(tmp_path / "test.db"))
    from backend.app import extraction as ext_orch
    from backend.app import store
    from backend.app.database import init_db
    from backend.app.pipeline import ingest_pdf, store_original_pdf
    from src.teacher.backend import MLXTeacherBackend

    init_db(tmp_path / "test.db")
    proj = store.create_project("acceptance")
    paper = store.create_paper(proj["id"], {"title": PDF.name})
    dest = store_original_pdf(paper["id"], PDF, PDF.name)
    ingested = ingest_pdf(paper["id"], dest)
    assert ingested["chunks"] >= 1, ingested["warnings"]

    ext_orch.set_backend(MLXTeacherBackend())
    try:
        stats = ext_orch.run_paper_extraction(paper["id"], limit=2)
    finally:
        ext_orch.set_backend(None)
    print("\nEXTRACTION STATS:", stats)
    assert stats["chunks_total"] == 2
    # Every persisted item must point back at a real chunk.
    items = store.list_evidence(paper["id"])
    chunk_ids = {c["chunk_id"] for c in store.list_chunks(paper["id"])}
    assert all(i["chunk_id"] in chunk_ids for i in items)
    assert all(i["status"] == "explicit" for i in items)
