"""Small storage layer over sqlite3. Stable prefixed IDs."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from .database import connect


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


# ---------------- projects ----------------

def create_project(name: str, description: str = "") -> dict:
    conn = connect()
    try:
        pid = _new_id("proj")
        now = _now()
        conn.execute(
            "INSERT INTO projects (id, name, description, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (pid, name, description, now, now),
        )
        conn.commit()
        return get_project(pid)
    finally:
        conn.close()


def get_project(pid: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_projects() -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute("SELECT * FROM projects ORDER BY created_at ASC").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------- papers (metadata only in Phase 1) ----------------

ALLOWED_DISCOVERY = {
    "direct_import", "user_import", "citation", "cited_by", "pubmed_query",
    "arxiv_query", "semantic_similarity", "user_added",
    # Automatic one-seed landscape discovery (Phase: seed -> discovery).
    "citation_discovery", "cited_by_discovery", "semantic_discovery",
}

# Discovery routes that create LANDSCAPE nodes automatically. These
# papers are NOT added to the researcher's project collection — adding
# one is always an explicit decision ([Add to Project]).
AUTO_DISCOVERY_TYPES = {
    "citation_discovery", "cited_by_discovery", "semantic_discovery",
}


def create_paper(project_id: str, data: dict) -> dict:
    if get_project(project_id) is None:
        raise KeyError(f"unknown project: {project_id}")
    dtype = data.get("discovery_source_type", "direct_import")
    if dtype not in ALLOWED_DISCOVERY:
        raise ValueError(f"invalid discovery_source_type: {dtype}")
    conn = connect()
    try:
        paper_id = _new_id("paper")
        now = _now()
        conn.execute(
            """INSERT INTO papers (id, project_id, title, authors_json, journal,
               year, doi, pmid, arxiv_id, abstract, source_pdf_path,
               discovery_source_type, extraction_status, in_project, pdf_url,
               pub_types_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)""",
            (
                paper_id, project_id, data.get("title", "UNSET"),
                json.dumps(data.get("authors", [])),
                data.get("journal", ""), data.get("year"),
                data.get("doi", ""), data.get("pmid", ""),
                data.get("arxiv_id", ""), data.get("abstract", ""),
                data.get("source_pdf_path", ""), dtype,
                # Collection membership: automatic discoveries enter the
                # Landscape only; explicit uploads/imports enter the
                # project collection. Researcher decides, never silent.
                0 if dtype in AUTO_DISCOVERY_TYPES else 1,
                data.get("pdf_url", ""),
                json.dumps(data.get("pub_types", []) or []),
                now, now,
            ),
        )
        conn.commit()
        return get_paper(paper_id)
    finally:
        conn.close()


def _paper_row_to_dict(d: dict) -> dict:
    d["authors"] = json.loads(d.pop("authors_json", "[]"))
    d["parsing_warnings"] = json.loads(d.pop("parsing_warnings_json", "[]"))
    d["pub_types"] = json.loads(d.pop("pub_types_json", "[]"))
    d["in_project"] = bool(d.get("in_project", 1))
    return d


def get_paper(paper_id: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        if row is None:
            return None
        return _paper_row_to_dict(dict(row))
    finally:
        conn.close()


def list_papers(project_id: str) -> list[dict]:
    """EVERY paper in the project's Landscape scope (seed + discovered +
    imported). Used by landscape/similarity/discovery — NOT the Library."""
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM papers WHERE project_id = ? ORDER BY created_at ASC",
            (project_id,),
        ).fetchall()
        return [_paper_row_to_dict(dict(r)) for r in rows]
    finally:
        conn.close()


def list_collection_papers(project_id: str) -> list[dict]:
    """The project COLLECTION (Library): only papers the researcher
    explicitly added. Landscape discoveries are excluded until an
    explicit [Add to Project]."""
    return [p for p in list_papers(project_id) if p["in_project"]]


def set_paper_in_project(paper_id: str, in_project: bool) -> dict:
    """Explicit project-collection membership change. Touches only the
    membership flag — provenance, landscape nodes, and edges are never
    modified or deleted here."""
    if get_paper(paper_id) is None:
        raise KeyError(f"unknown paper: {paper_id}")
    conn = connect()
    try:
        conn.execute(
            "UPDATE papers SET in_project = ?, updated_at = ? WHERE id = ?",
            (1 if in_project else 0, _now(), paper_id))
        conn.commit()
    finally:
        conn.close()
    return get_paper(paper_id)


def list_sections(paper_id: str) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT name, items_json FROM paper_sections WHERE paper_id = ?"
            " ORDER BY rowid ASC",
            (paper_id,),
        ).fetchall()
        return [{"name": r["name"], "items": json.loads(r["items_json"])}
                for r in rows]
    finally:
        conn.close()


def list_chunks(paper_id: str) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT chunk_id, section, subsection, text, source_start,"
            " source_end, token_estimate, char_count, text_hash"
            " FROM paper_chunks WHERE paper_id = ? ORDER BY rowid ASC",
            (paper_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


# ---------------- evidence ----------------

def get_evidence(evidence_id: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM paper_evidence WHERE id = ?", (evidence_id,)
        ).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def _evidence_id(paper_id: str, chunk_id: str, category: str, index: int,
                   model_name: str, prompt_version: str,
                   schema_version: str) -> str:
    """Deterministic, version-scoped evidence ID.

    The scope (model, prompt, schema) is part of the ID so re-extracting
    a chunk under new versions never collides with older rows; old rows
    stay intact for audit instead of being silently destroyed.
    """
    import re as _re
    model_slug = _re.sub(r"[^A-Za-z0-9]+", "-", model_name).strip("-")[:40]
    return (f"{paper_id}:{chunk_id}:{category}:{index:03d}"
            f":{model_slug}:{prompt_version}:{schema_version}")


def save_evidence_items(paper_id: str, chunk_id: str, items: list[dict],
                        model_name: str, prompt_version: str,
                        schema_version: str) -> int:
    """Replace this chunk's items for the given versions (idempotent retry)."""
    conn = connect()
    try:
        conn.execute(
            "DELETE FROM paper_evidence WHERE paper_id=? AND chunk_id=?"
            " AND model_name=? AND prompt_version=? AND schema_version=?",
            (paper_id, chunk_id, model_name, prompt_version, schema_version),
        )
        now = _now()
        for i, it in enumerate(items):
            conn.execute(
                """INSERT INTO paper_evidence (id, paper_id, chunk_id, category,
                   text, section, subsection, page_start, page_end,
                   location_status, status, schema_version, model_name,
                   prompt_version, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"{_evidence_id(paper_id, chunk_id, it['category'], i, model_name, prompt_version, schema_version)}",
                 paper_id, chunk_id, it["category"], it["text"],
                 it.get("section", ""), it.get("subsection", ""),
                 it.get("page_start"), it.get("page_end"),
                 it.get("location_status", "known"), it.get("status",
                                                             "explicit"),
                 schema_version, model_name, prompt_version, now),
            )
        conn.commit()
        return len(items)
    finally:
        conn.close()


def record_chunk_extraction(paper_id: str, chunk_id: str, status: str,
                            error: str, model_name: str, prompt_version: str,
                            schema_version: str, *,
                            failure_type: str = "",
                            raw_output: str = ""):
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO chunk_extractions (paper_id, chunk_id, status, error,
               model_name, prompt_version, schema_version, attempt_count,
               failure_type, raw_output, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
               ON CONFLICT (paper_id, chunk_id, model_name, prompt_version,
                            schema_version)
               DO UPDATE SET status=excluded.status, error=excluded.error,
                             attempt_count=chunk_extractions.attempt_count+1,
                             failure_type=excluded.failure_type,
                             raw_output=excluded.raw_output,
                             updated_at=excluded.updated_at""",
            (paper_id, chunk_id, status, error, model_name, prompt_version,
             schema_version, failure_type, raw_output[:4000], _now()),
        )
        conn.commit()
    finally:
        conn.close()


def get_chunk_extraction(paper_id: str, chunk_id: str, model_name: str,
                         prompt_version: str, schema_version: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM chunk_extractions WHERE paper_id=? AND chunk_id=?"
            " AND model_name=? AND prompt_version=? AND schema_version=?",
            (paper_id, chunk_id, model_name, prompt_version, schema_version),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_evidence(paper_id: str, section: str | None = None,
                  subsection: str | None = None,
                  category: str | None = None,
                  model_name: str | None = None,
                  prompt_version: str | None = None,
                  schema_version: str | None = None) -> list[dict]:
    query = ("SELECT id, paper_id, chunk_id, category, text, section,"
             " subsection, page_start, page_end, location_status, status,"
             " schema_version, model_name, prompt_version, created_at"
             " FROM paper_evidence WHERE paper_id=?")
    params: list = [paper_id]
    if section:
        query += " AND section=?"
        params.append(section)
    if subsection:
        query += " AND subsection=?"
        params.append(subsection)
    if category:
        query += " AND category=?"
        params.append(category)
    if model_name is not None:
        query += " AND model_name=?"
        params.append(model_name)
    if prompt_version is not None:
        query += " AND prompt_version=?"
        params.append(prompt_version)
    if schema_version is not None:
        query += " AND schema_version=?"
        params.append(schema_version)
    query += " ORDER BY rowid ASC"
    conn = connect()
    try:
        return [dict(r) for r in
                conn.execute(query, params).fetchall()]
    finally:
        conn.close()


def evidence_stats(paper_id: str) -> dict:
    conn = connect()
    try:
        total = conn.execute(
            "SELECT COUNT(*) c FROM paper_evidence WHERE paper_id=?",
            (paper_id,)).fetchone()["c"]
        by_status = conn.execute(
            "SELECT status, COUNT(*) c FROM chunk_extractions"
            " WHERE paper_id=? GROUP BY status",
            (paper_id,)).fetchall()
        return {"evidence_items": total,
                "chunk_states": {r["status"]: r["c"] for r in by_status}}
    finally:
        conn.close()


def extraction_run_status(paper_id: str) -> dict:
    """Latest-attempt extraction state per CURRENT chunk.

    `chunk_extractions` rows are versioned by (chunk, model, prompt,
    schema) — older rows stay for audit, and chunk ids can go stale
    after re-chunking — so only the newest row per current chunk counts.

    run: not_run (no attempts), complete (every current chunk's newest
    attempt succeeded), failed (every attempted chunk failed; nothing
    succeeded), partial (failures and/or chunks never attempted).
    `error` is a newest-attempt failure message, verbatim."""
    conn = connect()
    try:
        total = conn.execute(
            "SELECT COUNT(*) c FROM paper_chunks WHERE paper_id=?",
            (paper_id,)).fetchone()["c"]
        rows = conn.execute(
            """SELECT status, error FROM (
                   SELECT chunk_id, status, error,
                          ROW_NUMBER() OVER (
                              PARTITION BY chunk_id
                              ORDER BY updated_at DESC, rowid DESC) AS rn
                   FROM chunk_extractions
                   WHERE paper_id=? AND chunk_id IN (
                       SELECT chunk_id FROM paper_chunks WHERE paper_id=?)
               ) WHERE rn=1""",
            (paper_id, paper_id)).fetchall()
        succeeded = sum(1 for r in rows if r["status"] == "success")
        failed = sum(1 for r in rows if r["status"] == "failed")
        attempted = len(rows)
        other = attempted - succeeded - failed
        not_attempted = total - attempted
        if attempted == 0:
            run = "not_run"
        elif failed == 0 and other == 0 and not_attempted == 0:
            run = "complete"
        elif succeeded == 0 and other == 0 and not_attempted == 0:
            run = "failed"
        else:
            run = "partial"
        error = ""
        if failed:
            error = next((r["error"] for r in rows
                          if r["status"] == "failed" and r["error"]), "")
        return {"paper_id": paper_id, "run": run,
                "chunks_total": total, "succeeded": succeeded,
                "failed": failed, "not_attempted": not_attempted,
                "error": error}
    finally:
        conn.close()


# ---------------- synthesis ----------------

def save_synthesis(paper_id: str, synthesis: dict, status: str, error: str,
                   model_name: str, prompt_version: str,
                   schema_version: str, input_tokens: int,
                   model_calls: int, raw_output: str = "") -> dict:
    """Upsert by (paper, model, prompt, schema): idempotent regeneration."""
    import json as _json
    conn = connect()
    try:
        now = _now()
        sid = f"{paper_id}:synthesis:{model_name}:{prompt_version}:" \
              f"{schema_version}"
        conn.execute(
            """INSERT INTO paper_syntheses (id, paper_id, synthesis_json,
               synthesis_status, error, schema_version, model_name,
               prompt_version, input_tokens, model_calls, raw_output,
               created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (paper_id, model_name, prompt_version,
                            schema_version)
               DO UPDATE SET synthesis_json=excluded.synthesis_json,
                             synthesis_status=excluded.synthesis_status,
                             error=excluded.error,
                             input_tokens=excluded.input_tokens,
                             model_calls=excluded.model_calls,
                             raw_output=excluded.raw_output,
                             updated_at=excluded.updated_at""",
            (sid, paper_id, _json.dumps(synthesis), status, error,
             schema_version, model_name, prompt_version, input_tokens,
             model_calls, (raw_output or "")[:4000], now, now),
        )
        conn.commit()
        return get_synthesis(paper_id, model_name, prompt_version,
                             schema_version)
    finally:
        conn.close()


def get_synthesis(paper_id: str, model_name: str, prompt_version: str,
                  schema_version: str) -> dict | None:
    import json as _json
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM paper_syntheses WHERE paper_id=?"
            " AND model_name=? AND prompt_version=? AND schema_version=?",
            (paper_id, model_name, prompt_version, schema_version),
        ).fetchone()
        if row is None:
            return None
        d = dict(row)
        d["synthesis"] = _json.loads(d.pop("synthesis_json", "{}"))
        return d
    finally:
        conn.close()
