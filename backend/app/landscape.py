"""Pairwise semantic similarity (cosine) + landscape data builder.

Similarity is deterministic arithmetic over stored embeddings — never
an LLM judgment. Scores are labeled "semantic_similarity", never
relevance. Pairwise cost is O(N^2); documented, fine for MVP scale.
"""
from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from . import store
from .database import connect
from .embeddings import get_backend


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom == 0:
        return 0.0
    return float(np.dot(a, b) / denom)


def compute_pair(paper_a: str, paper_b: str, model_name: str,
                 embedding_version: str) -> dict | None:
    """Cosine similarity for one ordered pair. None when an embedding
    is missing (reported as skipped, never fabricated)."""
    from .embeddings import get_embedding
    lo, hi = (paper_a, paper_b) if paper_a < paper_b else (paper_b, paper_a)
    a = get_embedding(lo, model_name, embedding_version)
    b = get_embedding(hi, model_name, embedding_version)
    if a is None or b is None:
        return None
    if a["dim"] != b["dim"]:
        return None
    return {"paper_a": lo, "paper_b": hi,
            "similarity": cosine(a["vector"], b["vector"]),
            "embedding_model": model_name,
            "embedding_version": embedding_version}


def store_pair(result: dict):
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO paper_similarity
               (paper_a, paper_b, similarity, embedding_model,
                embedding_version, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (paper_a, paper_b)
               DO UPDATE SET similarity=excluded.similarity,
                             embedding_model=excluded.embedding_model,
                             embedding_version=excluded.embedding_version,
                             created_at=excluded.created_at""",
            (result["paper_a"], result["paper_b"], result["similarity"],
             result["embedding_model"], result["embedding_version"],
             _now()),
        )
        conn.commit()
    finally:
        conn.close()


def compute_project_similarity(project_id: str) -> dict:
    """All pairs stored (no relevance threshold). Missing embeddings
    are reported as skipped."""
    if store.get_project(project_id) is None:
        raise KeyError(f"unknown project: {project_id}")
    backend = get_backend()
    papers = sorted(p["id"] for p in store.list_papers(project_id))
    pairs, computed, skipped = [], 0, []
    for i in range(len(papers)):
        for j in range(i + 1, len(papers)):
            r = compute_pair(papers[i], papers[j], backend.model_id,
                             backend.version)
            if r is None:
                skipped.append([papers[i], papers[j]])
            else:
                store_pair(r)
                computed += 1
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM paper_similarity WHERE paper_a IN"
            " (SELECT id FROM papers WHERE project_id=?)"
            " AND paper_b IN (SELECT id FROM papers WHERE project_id=?)"
            " ORDER BY paper_a, paper_b",
            (project_id, project_id)).fetchall()
        pairs = [dict(r) for r in rows]
    finally:
        conn.close()
    return {"project_id": project_id, "pairs": pairs, "computed": computed,
            "skipped": skipped}


def list_paper_similarity(paper_id: str) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT * FROM paper_similarity WHERE paper_a=? OR paper_b=?"
            " ORDER BY paper_a, paper_b", (paper_id, paper_id)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def embedding_status(paper_id: str) -> dict:
    conn = connect()
    try:
        stage = conn.execute(
            "SELECT status, error FROM paper_processing WHERE paper_id=?"
            " AND stage='embeddings'", (paper_id,)).fetchone()
        rows = conn.execute(
            "SELECT model_name, embedding_version, dim, source_repr,"
            " source_hash, created_at FROM paper_embeddings WHERE paper_id=?",
            (paper_id,)).fetchall()
        return {"paper_id": paper_id,
                "status": stage["status"] if stage else "pending",
                "error": stage["error"] if stage else "",
                "embeddings": [dict(r) for r in rows]}
    finally:
        conn.close()


def build_landscape(project_id: str) -> dict:
    """Landscape DATA (not visualization): paper nodes, cites edges,
    semantic_similarity edges. Concept/method content rides inside
    paper nodes from validated synthesis; no LLM graph generation."""
    if store.get_project(project_id) is None:
        raise KeyError(f"unknown project: {project_id}")
    from src.teacher.prompt import (
        SYNTHESIS_PROMPT_VERSION,
        SYNTHESIS_SCHEMA_VERSION,
    )
    from src.teacher.backend import load_teacher_config
    try:
        synth_model = load_teacher_config()["model"]
    except Exception:
        synth_model = "Qwen/Qwen3-1.7B-MLX-8bit"
    nodes = []
    for p in store.list_papers(project_id):
        synth = store.get_synthesis(p["id"], synth_model,
                                    SYNTHESIS_PROMPT_VERSION,
                                    SYNTHESIS_SCHEMA_VERSION)
        concepts, methods = [], []
        if synth and synth["synthesis_status"] == "complete":
            s = synth["synthesis"]
            for it in s.get("concepts", []) + s.get("terminology", []):
                concepts.append(it["text"])
            for key in ("methods", "computational_methods",
                        "statistical_methods"):
                methods.extend(it["text"] for it in s.get(key, []))
        emb = embedding_status(p["id"])
        from . import search as _search
        discovery = _search.discovery_items(
            p["id"], p.get("discovery_source_type", ""))
        has_pdf = bool(p.get("source_pdf_path"))
        has_chunks = bool(store.list_chunks(p["id"]))
        pub_types = p.get("pub_types") or []
        nodes.append({
            "id": p["id"], "type": "paper",
            "title": p.get("title", ""), "authors": p.get("authors", []),
            "year": p.get("year"), "journal": p.get("journal", ""),
            "doi": p.get("doi", ""), "pmid": p.get("pmid", ""),
            "arxiv_id": p.get("arxiv_id", ""),
            "abstract": p.get("abstract", ""),
            "discovery_source": p.get("discovery_source_type", ""),
            "discovery": discovery,
            "metadata_only": not (has_pdf or has_chunks),
            "embedding_status": emb["status"],
            "concepts": concepts, "methods": methods,
            # Project-collection membership (discovered != added).
            "in_project": bool(p.get("in_project", 1)),
            # PubMed publication types as stored by the search layer;
            # empty = no typed metadata (never assumed).
            "pub_types": pub_types,
            "retracted": (("Retracted Publication" in pub_types)
                          if pub_types else None),
            # Free full-text link when the source recorded one (arXiv).
            "pdf_url": p.get("pdf_url", ""),
            # No citation-count source exists in this app: reported as
            # null (unavailable), never a fabricated 0.
            "citation_count": None,
            "created_at": p.get("created_at", ""),
        })
    conn = connect()
    try:
        cites = conn.execute(
            "SELECT * FROM citation_edges WHERE source_paper_id IN"
            " (SELECT id FROM papers WHERE project_id=?)"
            " AND target_paper_id IN"
            " (SELECT id FROM papers WHERE project_id=?)",
            (project_id, project_id)).fetchall()
        sims = conn.execute(
            "SELECT * FROM paper_similarity WHERE paper_a IN"
            " (SELECT id FROM papers WHERE project_id=?)"
            " AND paper_b IN (SELECT id FROM papers WHERE project_id=?)",
            (project_id, project_id)).fetchall()
    finally:
        conn.close()
    edges = [{"source": r["source_paper_id"],
              "target": r["target_paper_id"],
              "relationship": "cites", "status": r["status"],
              "mechanism": r["source"]}
             for r in cites]
    edges += [{"source": r["paper_a"], "target": r["paper_b"],
               "relationship": "semantic_similarity",
               "similarity": r["similarity"], "mechanism": ""}
              for r in sims]
    return {"project_id": project_id, "nodes": nodes, "edges": edges}
