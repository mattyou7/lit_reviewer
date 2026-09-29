"""Chunking property tests: boundaries, paragraphs, size, overlap,
duplication, coverage, provenance, IDs, determinism, manifest,
backend-vs-direct consistency, config authority.

Synthetic fixtures always run. Real-PDF tests run when the PDFs are
available (env LIT_REVIEW_TEST_PDF / _2, else ~/Downloads defaults).
"""
import os
from pathlib import Path

import pytest

from src.chunking.chunker import (
    CHARS_PER_TOKEN,
    OVERLAP_TOKENS,
    TARGET_TOKENS,
    _build_paragraphs,
    chunk_all_sections,
)
from src.chunking.sectioner import split_into_sections


# ============================================================
# Fixtures
# ============================================================

def _block(text, page=1, btype="paragraph", bid=None):
    return {"block_id": bid or f"p{page}_b1", "page": page,
            "text": text, "type": btype,
            "bbox": [0.0, 0.0, 100.0, 100.0], "block_no": 1}


def _pages(groups):
    """groups: list of (page_no, [blocks])."""
    out = []
    for page_no, blocks in groups:
        out.append({"page": page_no,
                    "width": 600.0, "height": 800.0,
                    "blocks": blocks,
                    "text": "\n\n".join(b["text"] for b in blocks)})
    return out


def _para(words, n=50):
    return " ".join([words] * n)


def norm(t):
    return " ".join(t.split())


# ============================================================
# 1. Section boundaries
# ============================================================

def test_section_boundaries():
    pages = _pages([(1, [
        _block("Introduction", bid="p1_b1"),
        _block("Intro body alpha. " * 20, bid="p1_b2"),
        _block("Methods", bid="p1_b3"),
        _block("Methods body beta. " * 20, bid="p1_b4"),
    ])])
    sections = split_into_sections(pages)
    assert set(sections) == {"front_matter", "introduction", "methods"}
    chunks = chunk_all_sections(sections, paper_id="p")
    by_id = {c.chunk_id: c for c in chunks}
    assert by_id["introduction_001"].section == "introduction"
    assert by_id["methods_001"].section == "methods"
    assert "beta" not in by_id["introduction_001"].text
    assert "alpha" not in by_id["methods_001"].text


# ============================================================
# 2. Subsection boundaries
# ============================================================

def test_subsection_boundaries():
    pages = _pages([(8, [
        _block("Methods", bid="p8_b1"),
        _block("Participants", bid="p8_b2"),
        _block("Twelve adults took part. " * 10, bid="p8_b3"),
        _block("Task", bid="p8_b4"),
        _block("Observers judged motion. " * 10, bid="p8_b5"),
    ])])
    sections = split_into_sections(pages)
    chunks = chunk_all_sections(sections, paper_id="p")
    subs = {c.chunk_id: c.subsection for c in chunks}
    assert subs["methods_participants_001"] == "participants"
    assert subs["methods_task_001"] == "task"
    # Heading text itself is metadata, not chunk body.
    part = [c for c in chunks
            if c.chunk_id == "methods_participants_001"][0]
    assert "Twelve adults took part." in part.text
    assert "\nParticipants" not in part.text


# ============================================================
# 3. Paragraph reconstruction
# ============================================================

def test_paragraph_reconstruction():
    blocks = [_block(f"Block {i} content here. " * 10,
                     bid=f"p1_b{i}") for i in range(1, 6)]
    pages = _pages([(1, blocks)])
    sections = split_into_sections(pages)
    chunks = chunk_all_sections(sections, paper_id="p")
    # Five small blocks -> one chunk, not five chunks.
    assert len(chunks) == 1
    # Every block preserved whole inside the chunk.
    for b in blocks:
        assert norm(b["text"]) in norm(chunks[0].text)


# ============================================================
# 4. Chunk size bounds
# ============================================================

def test_chunk_size_bounds():
    paras = [_para("word", 130) for _ in range(6)]  # ~195 tok each
    items = [{"page": 1, "text": p, "subsection": None,
              "is_heading": False, "type": "paragraph",
              "block_id": f"p1_b{i}", "unit": "block"}
             for i, p in enumerate(paras)]
    chunks = chunk_all_sections({"results": items}, paper_id="p",
                                target_tokens=400, overlap_tokens=60)
    sizes = [len(c.text) // CHARS_PER_TOKEN for c in chunks]
    assert len(chunks) == 5  # sliding window of 2 with 1-para overlap
    assert all(300 <= s <= 440 for s in sizes)  # target + join slack
    # Giant single paragraph stays whole (flagged downstream, not split).
    giant = [{"page": 1, "text": _para("big", 1000), "subsection": None,
              "is_heading": False, "type": "paragraph",
              "block_id": "p1_b9", "unit": "block"}]
    chunks = chunk_all_sections({"results": giant}, paper_id="p",
                                target_tokens=400, overlap_tokens=60)
    assert len(chunks) == 1


# ============================================================
# 5. Overlap at text level
# ============================================================

def test_overlap_text_level():
    # Distinct ~60-tok paragraphs ("sent0 " * 40 = 240 chars).
    paras = [_para(f"sent{i}", 40) for i in range(6)]
    items = [{"page": 1, "text": p, "subsection": None,
              "is_heading": False, "type": "paragraph",
              "block_id": f"p1_b{i}", "unit": "block"}
             for i, p in enumerate(paras)]
    chunks = chunk_all_sections({"results": items}, paper_id="p",
                                target_tokens=250, overlap_tokens=60)
    assert len(chunks) >= 2
    for prev, nxt in zip(chunks, chunks[1:]):
        prev_paras = prev.text.split("\n\n")
        nxt_paras = nxt.text.split("\n\n")
        # Overlap tail is paragraph-granular: last para(s) of prev
        # reappear first in nxt, identical text.
        assert prev_paras[-1] == nxt_paras[0]
        shared = [k for k in range(1, min(len(prev_paras),
                                          len(nxt_paras)) + 1)
                  if prev_paras[-k:] == nxt_paras[:k]]
        assert shared, "consecutive chunks share no paragraph overlap"


# ============================================================
# 6-7. No unintended duplication + text coverage
# ============================================================

def test_no_unintended_duplication_and_coverage():
    paras = [_para(f"unique{i}", 80) for i in range(10)]
    items = [{"page": 1 + i // 5, "text": p, "subsection": None,
              "is_heading": False, "type": "paragraph",
              "block_id": f"b{i}", "unit": "block"}
             for i, p in enumerate(paras)]
    chunks = chunk_all_sections({"methods": items}, paper_id="p",
                                target_tokens=300, overlap_tokens=60)
    locs: dict = {}
    for idx, c in enumerate(chunks):
        for p in c.text.split("\n\n"):
            locs.setdefault(norm(p), []).append(idx)
    for h, idxs in locs.items():
        assert len(idxs) <= 2, f"paragraph in >2 chunks: {idxs}"
        if len(idxs) == 2:
            assert idxs[1] - idxs[0] == 1, "non-consecutive duplicate"
    haystack = norm("\n".join(c.text for c in chunks))
    for p in paras:
        assert norm(p) in haystack, "source paragraph lost"


# ============================================================
# 8. Provenance
# ============================================================

def test_provenance_pages():
    items = [
        {"page": 3, "text": _para("a", 30), "subsection": None,
         "is_heading": False, "type": "paragraph", "block_id": "b1",
         "unit": "block"},
        {"page": 5, "text": _para("b", 30), "subsection": None,
         "is_heading": False, "type": "paragraph", "block_id": "b2",
         "unit": "block"},
    ]
    chunks = chunk_all_sections({"results": items}, paper_id="p")
    assert len(chunks) == 1
    assert chunks[0].source_start == "3"
    assert chunks[0].source_end == "5"


def test_unknown_provenance_when_page_missing():
    paras = _build_paragraphs(
        [{"text": "orphan text", "is_heading": False}])  # no page key
    assert paras[0][1] is None and paras[0][2] is None


# ============================================================
# 9-10. Deterministic IDs + rerun
# ============================================================

def test_deterministic_ids_and_rerun():
    pages = _pages([(1, [
        _block("Methods", bid="p1_b1"),
        _block("Participants", bid="p1_b2"),
        _block(_para("x", 500), bid="p1_b3"),
        _block(_para("y", 500), bid="p1_b4"),
        _block(_para("z", 500), bid="p1_b5"),
    ])])
    sections = split_into_sections(pages)
    run_a = chunk_all_sections(sections, paper_id="p")
    run_b = chunk_all_sections(sections, paper_id="p")
    assert [(c.chunk_id, c.text, c.source_start, c.source_end)
            for c in run_a] == \
           [(c.chunk_id, c.text, c.source_start, c.source_end)
            for c in run_b]
    ids = [c.chunk_id for c in run_a]
    assert len(set(ids)) == len(ids)
    assert ids[0] == "methods_participants_001"


# ============================================================
# 11. Manifest consistency
# ============================================================

def test_manifest_consistency():
    import hashlib
    from backend.app.pipeline import build_manifest
    pages = _pages([(2, [_block("Results", bid="p2_b1"),
                         _block(_para("r", 300), bid="p2_b2")])])
    sections = split_into_sections(pages)
    chunks = chunk_all_sections(sections, paper_id="paper_007")
    manifest = build_manifest("paper_007", chunks)
    assert len(manifest) == len(chunks)
    for c, m in zip(chunks, manifest):
        assert m["chunk_id"] == c.chunk_id
        assert m["section"] == c.section
        assert m["char_count"] == len(c.text)
        assert m["token_estimate"] == max(1, len(c.text) // CHARS_PER_TOKEN)
        assert m["text_hash"] == hashlib.sha256(
            c.text.encode()).hexdigest()[:16]


# ============================================================
# 12. Backend vs direct consistency
# ============================================================

def test_backend_matches_direct_chunking(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    db = tmp_path / "test.db"
    monkeypatch.setenv("LIT_REVIEW_DB", str(db))
    import backend.app.pipeline as pl
    monkeypatch.setattr(
        pl, "paper_dir",
        lambda pid: Path(tmp_path / "papers" / pid).mkdir(
            parents=True, exist_ok=True) or Path(tmp_path / "papers" / pid))
    from backend.app.database import init_db, get_db_path
    from backend.app.main import app
    init_db(db)
    client = TestClient(app)

    import fitz
    pdf = tmp_path / "t.pdf"
    doc = fitz.open()
    page = doc.new_page()
    y = 72
    for line in ["Abstract", "Brief abstract text here.",
                 "Methods", "Methods body text here. " * 30,
                 "References", "[1] Someone et al."]:
        page.insert_text((72, y), line)
        y += 40
    doc.save(str(pdf))
    doc.close()

    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    with open(pdf, "rb") as f:
        body = client.post(f"/api/projects/{pid}/papers/upload",
                           files={"file": ("t.pdf", f,
                                            "application/pdf")}).json()
    paper_id = body["id"]
    stored = client.get(f"/api/papers/{paper_id}").json()["source_pdf_path"]

    from src.pdf.extract import extract_pdf
    direct = chunk_all_sections(
        split_into_sections(extract_pdf(stored)), paper_id=paper_id)
    persisted = client.get(f"/api/papers/{paper_id}/chunks").json()
    assert [(c.chunk_id, c.text) for c in direct] == \
           [(c["chunk_id"], c["text"]) for c in persisted]
    assert get_db_path() == db  # did not touch the real database


# ============================================================
# 13. Config authority
# ============================================================

def test_config_matches_chunker():
    import yaml
    root = Path(__file__).resolve().parents[2]
    with open(root / "config" / "pipeline.yaml") as f:
        cfg = yaml.safe_load(f)
    assert cfg["chunking"]["target_tokens"] == TARGET_TOKENS
    assert cfg["chunking"]["overlap_tokens"] == OVERLAP_TOKENS


# ============================================================
# 14. Progress-guarantee regression (hang fix)
# ============================================================

def test_large_tail_paragraph_terminates():
    # Tokens are len//4: "s "*200 = 100 tok; "m "*3400 = 1700 tok.
    paras = [_para("s", 200), _para("m", 3400), _para("n", 3400)]
    items = [{"page": 1, "text": p, "subsection": None,
              "is_heading": False, "type": "paragraph",
              "block_id": f"b{i}", "unit": "block"}
             for i, p in enumerate(paras)]
    chunks = chunk_all_sections({"results": items}, paper_id="p",
                                target_tokens=1800, overlap_tokens=150)
    assert len(chunks) == 2
    assert norm(paras[0]) in norm(chunks[0].text)
    assert norm(paras[1]) in norm(chunks[0].text)
    assert norm(paras[2]) in norm(chunks[1].text)


# ============================================================
# Real-PDF integration
# ============================================================

PDF1 = Path(os.environ.get(
    "LIT_REVIEW_TEST_PDF",
    str(Path.home() / "Downloads" / "s41467-025-61010-x.pdf")))
PDF2 = Path(os.environ.get(
    "LIT_REVIEW_TEST_PDF_2",
    str(Path.home() / "Downloads"
        / "history_dependent_biases_in_perceptual_decisions.pdf")))


def _real_pipeline(pdf, paper_id):
    from src.pdf.extract import extract_pdf
    pages = extract_pdf(str(pdf))
    sections = split_into_sections(pages)
    chunks = chunk_all_sections(sections, paper_id=paper_id)
    return pages, sections, chunks


def _assert_real_properties(pages, sections, chunks, required_sections):
    assert len(pages) >= 10
    assert required_sections <= set(sections)
    assert 5 <= len(chunks) <= 80
    ids = [c.chunk_id for c in chunks]
    assert len(set(ids)) == len(ids)
    sizes = [len(c.text) // CHARS_PER_TOKEN for c in chunks]
    assert max(sizes) <= TARGET_TOKENS * 3, f"max chunk {max(sizes)}"
    # Full coverage.
    haystacks = {}
    for c in chunks:
        haystacks.setdefault(c.section, []).append(c.text)
    for name, items in sections.items():
        hay = norm("\n".join(haystacks.get(name, [])))
        for p, _, _ in _build_paragraphs(items):
            assert norm(p) in hay, f"lost paragraph in {name}"
    # Valid provenance.
    for c in chunks:
        s, e = int(c.source_start), int(c.source_end)
        assert 1 <= s <= e <= len(pages)


@pytest.mark.skipif(not PDF1.exists(), reason=f"missing {PDF1}")
def test_real_paper_sections_and_chunks():
    pages, sections, chunks = _real_pipeline(PDF1, "paper_001")
    assert len(pages) == 15
    _assert_real_properties(
        pages, sections, chunks,
        {"results", "discussion", "methods", "references"})


@pytest.mark.skipif(not PDF2.exists(), reason=f"missing {PDF2}")
def test_real_paper_two():
    pages, sections, chunks = _real_pipeline(PDF2, "paper_002")
    _assert_real_properties(
        pages, sections, chunks,
        {"introduction", "results", "methods", "references"})
