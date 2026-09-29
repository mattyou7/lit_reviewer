"""Deterministic paper-metadata extraction. Local PDF only, no network.

Sources (priority order):
  1. user_supplied — values already present from explicit user input
     or earlier runs (never overwritten; origin recorded when known).
  2. pdf_metadata  — the PDF document info dict (title/author).
  3. pdf_text      — DOI / arXiv ID regexes over extracted text.

Only pdf_metadata/pdf_text values are written back, and only into
empty-or-UNSET fields. Missing values stay null/empty — never guessed.
Every written value gets a (paper_id, field, source) provenance row,
so conflicting sources are preserved, not silently merged.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from .database import connect
from . import store

DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Za-z0-9]+")
ARXIV_RE = re.compile(
    r"arXiv:\s*(\d{4}\.\d{4,5}(v\d+)?|[a-z\-]+/\d{7})(?![\d.])",
    re.IGNORECASE,
)

FIELDS = ("title", "authors", "journal", "year", "doi", "pmid",
          "arxiv_id", "abstract")

# Resolution priority for filling empty papers columns.
# "user_supplied" is the fallback label for pre-existing values whose
# origin was not recorded (explicit user input or earlier runs).
SOURCE_PRIORITY = ("pdf_metadata", "pdf_text")

REPLACEABLE = ("", "UNSET")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean_doi(raw: str) -> str:
    return raw.rstrip(".,;)]}").lower()


def read_pdf_metadata(pdf_path: str | Path) -> dict:
    """Title/author from the PDF document info dict. Empty when absent."""
    import fitz
    out: dict = {}
    try:
        doc = fitz.open(pdf_path)
    except Exception:
        return out
    try:
        info = doc.metadata or {}
    finally:
        doc.close()
    title = (info.get("title") or "").strip()
    # Real titles have substance; filenames/placeholders do not qualify.
    if len(title) >= 15 and " " in title:
        out["title"] = title
    author = (info.get("author") or "").strip()
    if author:
        out["authors"] = [a.strip() for a in
                          re.split(r"[;,]", author) if a.strip()]
    return out


def extract_text_metadata(full_text: str,
                          page_texts: list[str] | None = None) -> dict:
    """DOI / arXiv ID via regex. High precision, no guessing.

    Early pages first: publisher headers (with the paper's own DOI)
    live on page 1-2, while reference lists at the end contain other
    papers' DOIs. Full-text fallback preserves recall.
    """
    out: dict = {}
    ordered = page_texts if page_texts else [full_text]
    early = ordered[:2]
    late = ordered[2:]
    for scope in (early, late):
        if "doi" not in out:
            for text in scope:
                m = DOI_RE.search(text)
                if m:
                    out["doi"] = _clean_doi(m.group(0))
                    break
        if "arxiv_id" not in out:
            for text in scope:
                m = ARXIV_RE.search(text)
                if m:
                    out["arxiv_id"] = m.group(1)
                    break
        if "doi" in out and "arxiv_id" in out:
            break
    return out


def record_metadata(paper_id: str, field: str, value, source: str):
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO paper_metadata
               (paper_id, field, value, source, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (paper_id, field, source)
               DO UPDATE SET value=excluded.value,
                             updated_at=excluded.updated_at""",
            (paper_id, field,
             value if isinstance(value, str) else str(value),
             source, _now()),
        )
        conn.commit()
    finally:
        conn.close()


def set_stage(paper_id: str, stage: str, status: str, error: str = ""):
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO paper_processing
               (paper_id, stage, status, error, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (paper_id, stage)
               DO UPDATE SET status=excluded.status, error=excluded.error,
                             updated_at=excluded.updated_at""",
            (paper_id, stage, status, error, _now()),
        )
        conn.commit()
    finally:
        conn.close()


def _is_empty(value) -> bool:
    if value is None:
        return True
    if isinstance(value, list):
        return len(value) == 0
    return str(value).strip() in REPLACEABLE


def mining_texts(page_texts: list[str], ref_pages: set) -> list[str]:
    """Page texts for identifier mining, excluding bibliography pages.

    Reference lists are full of OTHER papers' DOIs; mining them as the
    paper's own identifiers is the dominant false-positive source.
    `page_texts` is 1-based page order; `ref_pages` holds 1-based
    reference-section page numbers.
    """
    return [t for i, t in enumerate(page_texts, start=1)
            if i not in ref_pages]


def run_paper_metadata(paper_id: str, pdf_path: str | Path | None = None,
                       full_text: str = "",
                       page_texts: list[str] | None = None) -> dict:
    """Extract + resolve metadata. Returns {field: {value, source}}."""
    paper = store.get_paper(paper_id)
    if paper is None:
        raise KeyError(f"unknown paper: {paper_id}")
    try:
        warnings: list = []
        found: dict[str, dict[str, object]] = {}
        if pdf_path is not None:
            for field, value in read_pdf_metadata(pdf_path).items():
                found.setdefault(field, {})["pdf_metadata"] = value
        if full_text or page_texts:
            for field, value in extract_text_metadata(
                    full_text, page_texts).items():
                found.setdefault(field, {})["pdf_text"] = value

        resolved: dict = {}
        updates: dict = {}
        # Same-source refresh: a value previously written by pdf_*
        # extraction may be corrected when re-extraction disagrees.
        # Anything else non-empty (explicit user input) is never touched.
        conn = connect()
        try:
            prior = {(r["field"], r["source"]): r["value"]
                     for r in conn.execute(
                         "SELECT field, source, value FROM paper_metadata"
                         " WHERE paper_id=?", (paper_id,)).fetchall()}
        finally:
            conn.close()
        for field in FIELDS:
            current = paper.get(field)
            prior_source = next(
                (src for src in ("pdf_metadata", "pdf_text")
                 if str(current) == str(prior.get((field, src), "\0"))),
                None)
            if not _is_empty(current) and prior_source is None:
                # Explicit or untracked value: keep it.
                continue
            value, source = "", "unknown"
            for src in ("pdf_metadata", "pdf_text"):
                if found.get(field, {}).get(src):
                    value, source = found[field][src], src
                    break
            if value == "" or value is None or value == []:
                if prior_source is not None:
                    # Same-source refresh: the source no longer
                    # supports this value (e.g. a references-section
                    # DOI excluded from mining). Clear it rather than
                    # keep a known-stale identifier.
                    updates[field] = (None if field == "year" else
                                      ([] if field == "authors" else ""))
                    _delete_provenance(paper_id, field)
                    warnings.append(
                        f"metadata: cleared stale {prior_source} value "
                        f"for {field}")
                continue
            record_metadata(paper_id, field, value, source)
            updates[field] = value
        if updates:
            _apply_updates(paper_id, updates)
        set_stage(paper_id, "metadata", "complete")
        resolved = get_metadata(paper_id)["fields"]
        return {"paper_id": paper_id, "status": "complete",
                "fields": resolved, "warnings": warnings}
    except Exception as e:
        set_stage(paper_id, "metadata", "error", f"{type(e).__name__}: {e}")
        return {"paper_id": paper_id, "status": "error",
                "fields": {}, "warnings": [str(e)]}


def _delete_provenance(paper_id: str, field: str):
    conn = connect()
    try:
        conn.execute("DELETE FROM paper_metadata WHERE paper_id=? AND field=?",
                     (paper_id, field))
        conn.commit()
    finally:
        conn.close()


def update_paper_fields(paper_id: str, updates: dict):
    """Public wrapper: write resolved metadata columns."""
    _apply_updates(paper_id, updates)


def _apply_updates(paper_id: str, updates: dict):
    import json as _json
    conn = connect()
    try:
        sets, params = [], []
        for field, value in updates.items():
            if field == "authors":
                sets.append("authors_json=?")
                params.append(_json.dumps(value))
            elif field == "pub_types":
                sets.append("pub_types_json=?")
                params.append(_json.dumps(value))
            else:
                sets.append(f"{field}=?")
                params.append(value)
        sets.append("updated_at=?")
        params.append(_now())
        params.append(paper_id)
        conn.execute(f"UPDATE papers SET {', '.join(sets)} WHERE id=?",
                     params)
        conn.commit()
    finally:
        conn.close()


def get_metadata(paper_id: str) -> dict | None:
    """Resolved metadata with per-field source + all recorded conflicts."""
    paper = store.get_paper(paper_id)
    if paper is None:
        return None
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT field, value, source FROM paper_metadata"
            " WHERE paper_id=? ORDER BY field, source",
            (paper_id,)).fetchall()
    finally:
        conn.close()
    by_field: dict = {}
    for r in rows:
        by_field.setdefault(r["field"], []).append(
            {"value": r["value"], "source": r["source"]})
    fields = {}
    for field in FIELDS:
        current = paper.get(field)
        recs = by_field.get(field, [])
        src = "unknown"
        for candidate in SOURCE_PRIORITY:
            if any(r["source"] == candidate for r in recs):
                src = candidate
                break
        else:
            if recs:
                src = recs[0]["source"]
            elif not _is_empty(current):
                src = "user_supplied"
        fields[field] = {"value": current, "source": src,
                         "candidates": recs}
    return {"paper_id": paper_id, "fields": fields}
