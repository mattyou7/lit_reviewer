"""External discovery orchestration: search -> explicit import.

The researcher decides what enters the project: search only retrieves
and persists results; import requires an explicit call naming one
result. No ranking, no recommendations, no autonomous expansion.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from . import embeddings, landscape, metadata, references, store
from .database import connect
from src.search.arxiv import search_arxiv
from src.search.common import SearchError
from src.search.pubmed import search_pubmed

SEARCH_FNS = {"pubmed": search_pubmed, "arxiv": search_arxiv}
SOURCE_TYPES = {"pubmed": "pubmed_query", "arxiv": "arxiv_query"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    import uuid
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# ---------------- searches ----------------

def run_search(project_id: str, source: str, query: str,
               max_results: int = 20,
               year_min: int | None = None,
               year_max: int | None = None) -> dict:
    """Run a search and persist it with its results. Raises SearchError
    on invalid input or provider failure (also persisted as error)."""
    if store.get_project(project_id) is None:
        raise KeyError(f"unknown project: {project_id}")
    if source not in SEARCH_FNS:
        raise SearchError(f"unknown source: {source}")
    if not query or not query.strip():
        raise SearchError("empty query")
    search_id = _new_id("search")
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO searches
               (id, project_id, source, query, max_results, result_count,
                status, error, created_at)
               VALUES (?, ?, ?, ?, ?, 0, 'pending', '', ?)""",
            (search_id, project_id, source, query.strip(), max_results,
             _now()))
        conn.commit()
    finally:
        conn.close()
    try:
        if source == "pubmed":
            results = SEARCH_FNS[source](query.strip(), max_results,
                                         year_min, year_max)
        else:
            results = SEARCH_FNS[source](query.strip(), max_results)
    except SearchError as e:
        _set_search_status(search_id, "error", str(e))
        raise
    _store_results(search_id, source, results)
    _set_search_status(search_id, "complete", "")
    return get_search(search_id)


def _set_search_status(search_id: str, status: str, error: str):
    conn = connect()
    try:
        conn.execute("UPDATE searches SET status=?, error=? WHERE id=?",
                     (status, error, search_id))
        conn.commit()
    finally:
        conn.close()


def _store_results(search_id: str, source: str, results: list):
    conn = connect()
    try:
        conn.execute("DELETE FROM search_results WHERE search_id=?",
                     (search_id,))
        now = _now()
        seen = set()
        rank = 0
        for r in results:
            if r.external_id in seen:
                continue
            seen.add(r.external_id)
            conn.execute(
                """INSERT INTO search_results
                   (search_id, rank, external_id, source, pmid, doi,
                    arxiv_id, title, authors_json, journal, year, abstract,
                    pdf_url, pub_types_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (search_id, rank, r.external_id, source, r.pmid, r.doi,
                 r.arxiv_id, r.title, json.dumps(r.authors), r.journal,
                 r.year, r.abstract, r.pdf_url,
                 json.dumps(getattr(r, "pub_types", []) or []), now))
            rank += 1
        conn.execute("UPDATE searches SET result_count=? WHERE id=?",
                     (rank, search_id))
        conn.commit()
    finally:
        conn.close()


def list_searches(project_id: str) -> list[dict]:
    if store.get_project(project_id) is None:
        raise KeyError(f"unknown project: {project_id}")
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM searches WHERE project_id=? ORDER BY created_at ASC",
            (project_id,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_search(search_id: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM searches WHERE id=?",
                           (search_id,)).fetchone()
        if row is None:
            return None
        out = dict(row)
        out["search_id"] = out["id"]
        rows = conn.execute(
            "SELECT * FROM search_results WHERE search_id=?"
            " ORDER BY rank ASC", (search_id,)).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["authors"] = json.loads(d.pop("authors_json", "[]"))
            d["pub_types"] = json.loads(d.pop("pub_types_json", "[]"))
            d["discovery_source"] = {"type": f"{d['source']}_query",
                                     "query": out["query"]}
            results.append(d)
        out["results"] = results
        return out
    finally:
        conn.close()


# ---------------- discovery provenance ----------------

def record_discovery(paper_id: str, source_type: str, query: str = "",
                     source_paper_id: str = "", search_id: str = "",
                     external_id: str = ""):
    """Append-only: multiple sources accumulate, never overwritten."""
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO paper_discovery
               (paper_id, source_type, query, source_paper_id, search_id,
                external_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (paper_id, source_type, query, source_paper_id, search_id,
             external_id, _now()))
        conn.commit()
    finally:
        conn.close()


def list_discovery(paper_id: str) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM paper_discovery WHERE paper_id=?"
            " ORDER BY id ASC", (paper_id,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def discovery_items(paper_id: str, fallback_type: str = "") -> list[dict]:
    """Typed discovery trail for API responses. Falls back to the
    legacy single-column source (no fabricated history).

    `source` (PubMed/arXiv) is joined from the persisted search row the
    provenance points at — empty when the route was not a search
    (citation resolution, cited-by, user import). Never guessed."""
    rows = list_discovery(paper_id)
    if not rows and fallback_type:
        rows = [{"source_type": fallback_type, "query": "",
                 "source_paper_id": "", "search_id": "", "external_id": ""}]
    sources: dict[str, str] = {}
    conn = connect()
    try:
        for r in rows:
            sid = r.get("search_id", "")
            if sid and sid not in sources:
                row = conn.execute(
                    "SELECT source FROM searches WHERE id=?",
                    (sid,)).fetchone()
                sources[sid] = row["source"] if row else ""
    finally:
        conn.close()
    return [{"type": r["source_type"], "query": r["query"],
             "source_paper_id": r["source_paper_id"],
             "search_id": r["search_id"], "external_id": r["external_id"],
             "source": sources.get(r.get("search_id", ""), "")}
            for r in rows]


# ---------------- identity / dedup ----------------

def _norm_doi(doi: str) -> str:
    return (doi or "").strip().lower().rstrip(".,;)]}")


def find_paper_by_identity(project_id: str, pmid: str = "",
                           doi: str = "", arxiv_id: str = "") -> dict | None:
    """Deterministic identity: DOI -> PMID -> arXiv ID, project-scoped.
    Title/author fallback is not supported (references layer does not
    parse titles); unknown identifiers return None, never a guess."""
    papers = store.list_papers(project_id)
    if doi and (norm := _norm_doi(doi)):
        hits = [p for p in papers if _norm_doi(p.get("doi", "")) == norm]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            return None  # ambiguous: refuse to choose
    if pmid:
        hits = [p for p in papers if (p.get("pmid", "") or "") == pmid]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            return None
    if arxiv_id:
        needle = arxiv_id.lower()
        hits = [p for p in papers
                if (p.get("arxiv_id", "") or "").lower() == needle]
        if len(hits) == 1:
            return hits[0]
    return None


# ---------------- import ----------------

def _fill_missing(paper: dict, result: dict, source: str) -> list[str]:
    """Fill only empty paper fields from a search result, recording
    per-field provenance. Existing values (incl. prior extractions)
    are never overwritten. Returns filled field names."""
    filled = []
    mapping = {"title": result.get("title", ""),
               "authors": result.get("authors", []),
               "journal": result.get("journal", ""),
               "year": result.get("year"),
               "doi": result.get("doi", ""),
               "pmid": result.get("pmid", ""),
               "arxiv_id": result.get("arxiv_id", ""),
               "abstract": result.get("abstract", ""),
               "pdf_url": result.get("pdf_url", ""),
               "pub_types": result.get("pub_types", [])}
    updates, prov = {}, []
    for field, value in mapping.items():
        if value is None or value == "" or value == []:
            continue
        current = paper.get(field)
        empty = (current is None or current == "" or current == []
                 or current == "UNSET")
        if not empty:
            continue
        updates[field] = value
        prov.append((field, value))
        filled.append(field)
    if updates:
        metadata.update_paper_fields(paper["id"], updates)
        for field, value in prov:
            metadata.record_metadata(paper["id"], field, value, source)
    return filled


def import_result(project_id: str, search_id: str,
                  external_id: str) -> dict:
    """Explicitly import one search result. Creates or updates a paper,
    records provenance, embeds, re-resolves project references, and
    computes similarity against existing papers. Never imports
    anything not explicitly named."""
    if store.get_project(project_id) is None:
        raise KeyError(f"unknown project: {project_id}")
    search = get_search(search_id)
    if search is None or search["project_id"] != project_id:
        raise KeyError(f"unknown search: {search_id}")
    matches = [r for r in search["results"]
               if r["external_id"] == external_id]
    if not matches:
        raise KeyError(f"unknown result: {external_id}")
    result = matches[0]
    source = result["source"]
    dtype = SOURCE_TYPES[source]
    warnings: list[str] = []

    existing = find_paper_by_identity(
        project_id, result["pmid"], result["doi"], result["arxiv_id"])
    if existing is None:
        paper = store.create_paper(project_id, {
            "title": result["title"] or "UNSET",
            "authors": result["authors"],
            "journal": result["journal"],
            "year": result["year"],
            "doi": result["doi"],
            "pmid": result["pmid"],
            "arxiv_id": result["arxiv_id"],
            "abstract": result["abstract"],
            "pdf_url": result.get("pdf_url", ""),
            "pub_types": result.get("pub_types", []),
            "discovery_source_type": dtype,
        })
        for field in ("title", "authors", "journal", "year", "doi",
                      "pmid", "arxiv_id", "abstract"):
            value = paper.get(field)
            if value is None or value == "" or value == [] \
                    or value == "UNSET":
                continue
            metadata.record_metadata(paper["id"], field, value, source)
        created = True
    else:
        paper = existing
        filled = _fill_missing(paper, result, source)
        if filled:
            warnings.append(f"filled missing fields: {sorted(filled)}")
        paper = store.get_paper(paper["id"])
        # Explicit import is a user action: "seed / imports are In
        # Project". Even when identity-dedup lands on a paper that
        # automatic discovery only surfaced (in_project=0), importing it
        # makes it a collection member. Membership only — the Landscape
        # node, relationships, and first-discovery provenance are kept.
        if not paper.get("in_project"):
            store.set_paper_in_project(paper["id"], True)
            paper = store.get_paper(paper["id"])
        created = False

    record_discovery(paper["id"], dtype, query=search["query"],
                     search_id=search_id, external_id=external_id)

    # Embedding: best effort, cached by (model, version, source hash).
    try:
        emb = embeddings.run_paper_embedding(paper["id"])
    except Exception as e:
        emb = {"paper_id": paper["id"], "status": "error",
               "warnings": [f"embeddings: {e}"]}
        warnings.extend(emb["warnings"])

    # References both ways: the new paper may cite project papers, and
    # project papers' unresolved references may now match it.
    resolved_total = 0
    try:
        for p in store.list_papers(project_id):
            if references.list_references(p["id"]):
                r = references.resolve_references(p["id"])
                resolved_total += r["resolved"]
    except Exception as e:
        warnings.append(f"reference re-resolution: {e}")

    # Similarity of the new paper against the rest (O(N), small N).
    sim_computed, sim_skipped = 0, []
    try:
        backend = embeddings.get_backend()
        for p in store.list_papers(project_id):
            if p["id"] == paper["id"]:
                continue
            r = landscape.compute_pair(paper["id"], p["id"],
                                       backend.model_id, backend.version)
            if r is None:
                sim_skipped.append(p["id"])
            else:
                landscape.store_pair(r)
                sim_computed += 1
    except Exception as e:
        warnings.append(f"similarity: {e}")

    return {"paper_id": paper["id"], "created": created,
            "discovery_source_type": dtype,
            "embedding": emb, "references_resolved": resolved_total,
            "similarity_computed": sim_computed,
            "similarity_skipped": sim_skipped, "warnings": warnings}
