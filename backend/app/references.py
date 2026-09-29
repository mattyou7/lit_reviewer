"""Deterministic reference extraction + resolution. No network, no LLM.

Pipeline per paper:
  references section items -> split into entries -> parse identifiers
  -> match against project papers (DOI, arXiv ID, normalized title)
  -> citation edges for confident matches.

Raw citation text is always preserved. Uncertain matches stay
'unresolved' or 'ambiguous' and never enter the graph.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone

from .database import connect
from . import store
from .metadata import DOI_RE, ARXIV_RE, set_stage

YEAR_RE = re.compile(r"\b(?:19|20)\d{2}\b")
REF_START_RE = re.compile(r"^\s*(?:\[\d+\]|\(\d+\)|\d{1,3}[.)\]])\s*")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_title(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def split_references(items: list[dict]) -> list[dict]:
    """Split references-section items into entries.

    A new entry starts at a line shaped like [12], (12), 12. or 12).
    Continuation lines accumulate. Returns [{raw_text, source_page}].
    """
    entries: list[dict] = []
    current: list[str] = []
    current_page = None
    for item in items:
        text = item.get("text", "") or ""
        page = item.get("page")
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            if REF_START_RE.match(stripped) and current:
                entries.append({"raw_text": " ".join(current).strip(),
                                "source_page": current_page})
                current, current_page = [], page
            if not current:
                current_page = page
            current.append(stripped)
    if current:
        entries.append({"raw_text": " ".join(current).strip(),
                        "source_page": current_page})
    return [e for e in entries if e["raw_text"]]


def parse_reference(raw: str) -> dict:
    """Extract machine identifiers. Title/authors/journal stay empty
    unless parsed — never guessed."""
    out = {"title": "", "authors": [], "year": None, "journal": "",
           "doi": "", "pmid": "", "arxiv_id": ""}
    m = DOI_RE.search(raw)
    if m:
        out["doi"] = m.group(0).rstrip(".,;)]}").lower()
    m = ARXIV_RE.search(raw)
    if m:
        out["arxiv_id"] = m.group(1)
    years = YEAR_RE.findall(raw)
    if years:
        # Last 4-digit year: publication year in most styles
        # (Nature trailing "(2020)"); recorded heuristically,
        # raw text always preserved.
        out["year"] = int(years[-1])
    return out


def _norm_doi(doi: str) -> str:
    return (doi or "").strip().lower().rstrip(".,;)]}")


def resolve_references(paper_id: str) -> dict:
    """Match references against papers in the same project.

    DOI/arXiv exact match -> resolved. Normalized title exact match
    against a single project paper -> resolved; multiple matches ->
    ambiguous. Everything else stays unresolved.
    """
    paper = store.get_paper(paper_id)
    if paper is None:
        raise KeyError(f"unknown paper: {paper_id}")
    project_papers = [p for p in
                      store.list_papers(paper["project_id"])
                      if p["id"] != paper_id]
    conn = connect()
    try:
        refs = conn.execute(
            "SELECT * FROM paper_references WHERE paper_id=?",
            (paper_id,)).fetchall()
        resolved = unresolved = ambiguous = 0
        for r in refs:
            status, target = "unresolved", ""
            doi = _norm_doi(r["doi"])
            if doi:
                hits = [p for p in project_papers
                        if _norm_doi(p.get("doi", "")) == doi and doi]
                if len(hits) == 1:
                    status, target = "resolved", hits[0]["id"]
                elif len(hits) > 1:
                    status = "ambiguous"
            if status == "unresolved" and r["arxiv_id"]:
                needle = r["arxiv_id"].lower()
                hits = [p for p in project_papers
                        if (p.get("arxiv_id", "") or "").lower() == needle]
                if len(hits) == 1:
                    status, target = "resolved", hits[0]["id"]
                elif len(hits) > 1:
                    status = "ambiguous"
            conn.execute(
                "UPDATE paper_references SET resolution_status=?,"
                " resolved_paper_id=? WHERE id=?",
                (status, target, r["id"]))
            if status == "resolved":
                resolved += 1
            elif status == "ambiguous":
                ambiguous += 1
            else:
                unresolved += 1
        conn.execute("DELETE FROM citation_edges WHERE source_paper_id=?",
                     (paper_id,))
        edges = 0
        for r in conn.execute(
                "SELECT resolved_paper_id FROM paper_references"
                " WHERE paper_id=? AND resolution_status='resolved'"
                " AND resolved_paper_id != ''", (paper_id,)).fetchall():
            if r["resolved_paper_id"] == paper_id:
                continue
            conn.execute(
                """INSERT OR IGNORE INTO citation_edges
                   (source_paper_id, target_paper_id, relationship,
                    source, status, created_at)
                   VALUES (?, ?, 'cites', 'reference_extraction',
                           'resolved', ?)""",
                (paper_id, r["resolved_paper_id"], _now()))
            edges += 1
        conn.commit()
    finally:
        conn.close()
    return {"paper_id": paper_id, "resolved": resolved,
            "unresolved": unresolved, "ambiguous": ambiguous, "edges": edges}


def run_paper_references(paper_id: str) -> dict:
    """Extract references from the references section, then resolve."""
    paper = store.get_paper(paper_id)
    if paper is None:
        raise KeyError(f"unknown paper: {paper_id}")
    try:
        sections = {s["name"]: s["items"]
                    for s in store.list_sections(paper_id)}
        items = sections.get("references", [])
        if not items:
            set_stage(paper_id, "references", "partial",
                      "no references section detected")
            return {"paper_id": paper_id, "status": "partial",
                    "references": 0, "resolved": 0, "unresolved": 0,
                    "ambiguous": 0, "edges": 0,
                    "warnings": ["no references section detected"]}
        entries = split_references(items)
        conn = connect()
        try:
            conn.execute("DELETE FROM paper_references WHERE paper_id=?",
                         (paper_id,))
            now = _now()
            for i, e in enumerate(entries):
                parsed = parse_reference(e["raw_text"])
                conn.execute(
                    """INSERT INTO paper_references
                       (id, paper_id, ref_index, raw_text, title,
                        authors_json, year, journal, doi, pmid, arxiv_id,
                        source_page, resolution_status, resolved_paper_id,
                        created_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (f"{paper_id}:ref:{i:03d}", paper_id, i,
                     e["raw_text"], parsed["title"],
                     json.dumps(parsed["authors"]), parsed["year"],
                     parsed["journal"], parsed["doi"], parsed["pmid"],
                     parsed["arxiv_id"], e["source_page"], "unresolved",
                     "", now),
                )
            conn.commit()
        finally:
            conn.close()
        result = resolve_references(paper_id)
        set_stage(paper_id, "references", "complete")
        return {"paper_id": paper_id, "status": "complete",
                "references": len(entries), **result, "warnings": []}
    except Exception as e:
        set_stage(paper_id, "references", "error",
                  f"{type(e).__name__}: {e}")
        return {"paper_id": paper_id, "status": "error", "references": 0,
                "resolved": 0, "unresolved": 0, "ambiguous": 0, "edges": 0,
                "warnings": [str(e)]}


def list_references(paper_id: str) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM paper_references WHERE paper_id=?"
            " ORDER BY ref_index ASC", (paper_id,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["authors"] = json.loads(d.pop("authors_json", "[]"))
            out.append(d)
        return out
    finally:
        conn.close()


def list_citations(paper_id: str) -> dict:
    """Outgoing + incoming citation edges. Citation is only citation."""
    conn = connect()
    try:
        out = conn.execute(
            "SELECT * FROM citation_edges WHERE source_paper_id=?",
            (paper_id,)).fetchall()
        inc = conn.execute(
            "SELECT * FROM citation_edges WHERE target_paper_id=?",
            (paper_id,)).fetchall()
        return {"outgoing": [dict(r) for r in out],
                "incoming": [dict(r) for r in inc]}
    finally:
        conn.close()
