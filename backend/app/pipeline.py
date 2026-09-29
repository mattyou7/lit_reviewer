"""PDF ingestion pipeline: reuses src/pdf + src/chunking, persists to SQLite.

Flow: stored PDF -> extract_pdf -> split_into_sections -> chunk_all_sections
      -> validate -> manifest -> DB rows + paper status.

Statuses: pending | parsing | chunking | complete | partial | error.
Warnings are recorded, never hidden.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .database import REPO_ROOT, connect

# Existing pipeline (source of truth, do not reimplement).
from src.pdf.extract import extract_pdf
from src.chunking.sectioner import split_into_sections, summarize_sections
from src.chunking.chunker import (
    CHARS_PER_TOKEN,
    OVERLAP_TOKENS,
    TARGET_TOKENS,
    chunk_all_sections,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def paper_dir(paper_id: str) -> Path:
    d = REPO_ROOT / "data" / "papers" / paper_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN) if text else 0


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def validate_chunks(chunks) -> tuple[list, list[str]]:
    """Return (valid_chunks, warnings). Drops empty/duplicate/pathological rows."""
    valid = []
    warnings: list[str] = []
    seen: set[str] = set()
    for c in chunks:
        text = (c.text or "").strip()
        if not text:
            warnings.append(f"empty chunk dropped: {c.chunk_id}")
            continue
        if not c.chunk_id or not c.section:
            warnings.append(f"chunk missing id/section dropped: {c.chunk_id!r}")
            continue
        h = _hash(text)
        if h in seen:
            warnings.append(f"duplicate chunk dropped: {c.chunk_id}")
            continue
        seen.add(h)
        # Pathological one-liners are only kept if typed content exists
        # (chunker already merges lines; a <30-char chunk is suspicious).
        if len(text) < 30:
            warnings.append(f"very short chunk kept but flagged: {c.chunk_id}")
        valid.append(c)
    return valid, warnings


def build_manifest(paper_id: str, chunks) -> list[dict]:
    manifest = []
    for c in chunks:
        text = c.text or ""
        manifest.append({
            "paper_id": paper_id,
            "chunk_id": c.chunk_id,
            "section": c.section,
            "subsection": c.subsection or "",
            "token_estimate": _estimate_tokens(text),
            "char_count": len(text),
            "source_start": c.source_start or "",
            "source_end": c.source_end or "",
            "text_hash": _hash(text),
        })
    return manifest


def _set_status(paper_id: str, status: str, warnings: list[str] | None = None):
    conn = connect()
    try:
        if warnings is None:
            conn.execute(
                "UPDATE papers SET extraction_status=?, updated_at=? WHERE id=?",
                (status, _now(), paper_id),
            )
        else:
            conn.execute(
                "UPDATE papers SET extraction_status=?, parsing_warnings_json=?,"
                " updated_at=? WHERE id=?",
                (status, json.dumps(warnings), _now(), paper_id),
            )
        conn.commit()
    finally:
        conn.close()


def _persist(paper_id: str, sections: dict, chunks, manifest: list[dict]):
    conn = connect()
    try:
        conn.execute("DELETE FROM paper_chunks WHERE paper_id=?", (paper_id,))
        conn.execute("DELETE FROM paper_sections WHERE paper_id=?", (paper_id,))
        now = _now()
        for name, items in sections.items():
            conn.execute(
                "INSERT INTO paper_sections (id, paper_id, name, items_json,"
                " created_at) VALUES (?, ?, ?, ?, ?)",
                (f"{paper_id}:{name}", paper_id, name,
                 json.dumps(items, default=str), now),
            )
        for c, m in zip(chunks, manifest):
            conn.execute(
                """INSERT INTO paper_chunks (id, paper_id, chunk_id, section,
                   subsection, text, source_start, source_end, token_estimate,
                   char_count, text_hash, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"{paper_id}:{c.chunk_id}", paper_id, c.chunk_id, c.section,
                 c.subsection or "", c.text, c.source_start or "",
                 c.source_end or "", m["token_estimate"], m["char_count"],
                 m["text_hash"], now),
            )
        conn.commit()
    finally:
        conn.close()


def ingest_pdf(paper_id: str, pdf_path: str | Path) -> dict:
    """Run the full PDF->sections->chunks pipeline for a stored PDF.

    Never modifies the user's original: the stored copy at
    data/papers/<id>/original.pdf is the input.
    """
    pdf_path = Path(pdf_path)
    warnings: list[str] = []
    _set_status(paper_id, "parsing")
    try:
        pages = extract_pdf(str(pdf_path))
    except Exception as e:  # malformed / scanned / missing -> visible error
        warnings.append(f"PDF extraction failed: {type(e).__name__}: {e}")
        _set_status(paper_id, "error", warnings)
        return {"paper_id": paper_id, "status": "error",
                "pages": 0, "warnings": warnings}
    if not pages:
        warnings.append("no pages extracted (empty or scanned PDF?)")
        _set_status(paper_id, "error", warnings)
        return {"paper_id": paper_id, "status": "error",
                "pages": 0, "warnings": warnings}

    _set_status(paper_id, "chunking")
    sections = split_into_sections(pages)
    summary = summarize_sections(sections)
    if len(pages) and sum(len(v) for v in sections.values()) == 0:
        warnings.append("section detection produced no content")

    chunks = chunk_all_sections(sections, paper_id=paper_id)
    valid, vwarn = validate_chunks(chunks)
    warnings.extend(vwarn)
    manifest = build_manifest(paper_id, valid)
    _persist(paper_id, sections, valid, manifest)

    # Deterministic knowledge-layer stages. Each records its own
    # status; failures here never invalidate chunks/evidence.
    try:
        from . import metadata as _metadata
        page_texts = [p.get("text", "") for p in pages]
        ref_pages = {it.get("page")
                     for it in sections.get("references", [])
                     if it.get("page")}
        mining = _metadata.mining_texts(page_texts, ref_pages)
        _metadata.run_paper_metadata(
            paper_id, pdf_path, full_text="\n".join(mining),
            page_texts=mining)
    except Exception as e:  # pragma: no cover - defensive
        warnings.append(f"metadata stage failed: {e}")
    try:
        from . import references as _references
        ref_result = _references.run_paper_references(paper_id)
        warnings.extend(ref_result.get("warnings", []))
    except Exception as e:  # pragma: no cover - defensive
        warnings.append(f"references stage failed: {e}")

    # Write reproducible manifest + section summary to local files.
    # Token targets come from the chunker module (single authority).
    d = paper_dir(paper_id)
    (d / "chunk_manifest.json").write_text(
        json.dumps({"paper_id": paper_id,
                    "pages": len(pages),
                    "chunking": {"target_tokens": TARGET_TOKENS,
                                 "overlap_tokens": OVERLAP_TOKENS},
                    "sections": summary,
                    "chunks": manifest,
                    "warnings": warnings}, indent=2),
        encoding="utf-8",
    )

    # Equation-heavy or reference-only leftovers -> partial, not silent.
    status = "complete"
    empty = [m for m in manifest if m["char_count"] < 30]
    if warnings and (not valid or len(empty) > len(valid) / 2):
        status = "partial"
    elif warnings and not valid:
        status = "error"
    # Surface page/provenance gaps explicitly.
    unknown = [m["chunk_id"] for m in manifest if not m["source_start"]]
    if unknown:
        warnings.append(
            f"SOURCE LOCATION UNKNOWN for {len(unknown)} chunk(s): "
            + ", ".join(unknown[:5]))
        if status == "complete":
            status = "partial"
    _set_status(paper_id, status, warnings)
    return {"paper_id": paper_id, "status": status, "pages": len(pages),
            "sections": list(sections.keys()),
            "chunks": len(valid), "warnings": warnings}


def store_original_pdf(paper_id: str, src: Path, filename: str) -> Path:
    """Copy (never move) the uploaded PDF into local storage."""
    d = paper_dir(paper_id)
    dest = d / "original.pdf"
    shutil.copyfile(src, dest)
    try:
        stored = str(dest.relative_to(REPO_ROOT))
    except ValueError:
        stored = str(dest)  # test-isolated storage outside repo
    conn = connect()
    try:
        conn.execute(
            "UPDATE papers SET source_pdf_path=?, updated_at=? WHERE id=?",
            (stored, _now(), paper_id),
        )
        conn.commit()
    finally:
        conn.close()
    return dest


def resolve_pdf_path(stored: str) -> Path:
    p = Path(stored)
    if p.is_absolute():
        return p
    return REPO_ROOT / stored
