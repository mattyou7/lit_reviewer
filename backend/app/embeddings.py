"""Paper embedding orchestration. Deterministic, idempotent, local.

Representation (compact, never the raw paper):
  title + abstract + structured synthesis item texts (capped).

Change detection via source hash: same (model, version, hash) is never
regenerated unless forced. Failures are recorded per-paper and never
invalidate chunks/evidence/synthesis.
"""
from __future__ import annotations

import hashlib
import time
from datetime import datetime, timezone

import numpy as np

from . import store
from .database import connect
from .metadata import set_stage
from src.embeddings.backends import (
    EmbeddingBackend,
    TransformerEmbeddingBackend,
    load_embedding_config,
)

_backend: EmbeddingBackend | None = None

REPR_CAP = 8000


def get_backend() -> EmbeddingBackend:
    global _backend
    if _backend is None:
        _backend = TransformerEmbeddingBackend()
    return _backend


def set_backend(backend: EmbeddingBackend | None):
    """Test hook: inject a backend (or reset to lazy transformer)."""
    global _backend
    _backend = backend


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_representation(paper_id: str) -> tuple[str, str]:
    """(text, source_descr). Synthesis pinned to current versions."""
    paper = store.get_paper(paper_id)
    from src.teacher.prompt import (
        EXTRACTION_SCHEMA_VERSION,
        PROMPT_VERSION as EXTRACTION_PROMPT_VERSION,
        SYNTHESIS_PROMPT_VERSION,
        SYNTHESIS_SCHEMA_VERSION,
    )
    from src.teacher.backend import load_teacher_config
    try:
        model = load_teacher_config()["model"]
    except Exception:
        model = "Qwen/Qwen3-1.7B-MLX-8bit"
    synth = store.get_synthesis(paper_id, model, SYNTHESIS_PROMPT_VERSION,
                                SYNTHESIS_SCHEMA_VERSION)
    parts = [paper.get("title", ""), paper.get("abstract", "")]
    descr = "title+abstract"
    if synth and synth["synthesis_status"] == "complete":
        texts = []
        for items in synth["synthesis"].values():
            texts.extend(it["text"] for it in items)
        parts.append("\n".join(texts))
        descr += f"+synthesis_{SYNTHESIS_PROMPT_VERSION}"
    text = "\n\n".join(p for p in parts if p)[:REPR_CAP]
    return text, descr


def _source_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def get_embedding(paper_id: str, model_name: str,
                  embedding_version: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT paper_id, model_name, model_version, embedding_version,"
            " source_repr, source_hash, dim, vector, created_at"
            " FROM paper_embeddings WHERE paper_id=? AND model_name=?"
            " AND embedding_version=?",
            (paper_id, model_name, embedding_version)).fetchone()
        if row is None:
            return None
        d = dict(row)
        d["vector"] = np.frombuffer(d["vector"],
                                    dtype=np.float32).copy()
        return d
    finally:
        conn.close()


def run_paper_embedding(paper_id: str,
                        force: bool = False) -> dict:
    paper = store.get_paper(paper_id)
    if paper is None:
        raise KeyError(f"unknown paper: {paper_id}")
    backend = get_backend()
    model_name = backend.model_id
    embedding_version = backend.version
    started = time.monotonic()
    try:
        text, descr = build_representation(paper_id)
        if not text.strip():
            raise ValueError("empty representation (no title/abstract)")
        source_hash = _source_hash(text)
        existing = get_embedding(paper_id, model_name, embedding_version)
        if existing and existing["source_hash"] == source_hash and not force:
            set_stage(paper_id, "embeddings", "complete")
            return {"paper_id": paper_id, "status": "complete",
                    "cached": True, "model": model_name,
                    "embedding_version": embedding_version,
                    "dim": existing["dim"],
                    "duration_seconds": round(time.monotonic() - started, 2),
                    "warnings": []}
        vec = backend.encode([text])[0].astype(np.float32)
        conn = connect()
        try:
            conn.execute(
                """INSERT INTO paper_embeddings
                   (paper_id, model_name, model_version, embedding_version,
                    source_repr, source_hash, dim, vector, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (paper_id, model_name, embedding_version)
                   DO UPDATE SET source_repr=excluded.source_repr,
                                 source_hash=excluded.source_hash,
                                 dim=excluded.dim, vector=excluded.vector,
                                 created_at=excluded.created_at""",
                (paper_id, model_name, "",
                 embedding_version, descr, source_hash, int(vec.shape[0]),
                 vec.tobytes(), _now()),
            )
            conn.commit()
        finally:
            conn.close()
        set_stage(paper_id, "embeddings", "complete")
        return {"paper_id": paper_id, "status": "complete",
                "cached": False, "model": model_name,
                "embedding_version": embedding_version,
                "dim": int(vec.shape[0]),
                "duration_seconds": round(time.monotonic() - started, 2),
                "warnings": []}
    except Exception as e:
        set_stage(paper_id, "embeddings", "error",
                  f"{type(e).__name__}: {e}")
        return {"paper_id": paper_id, "status": "error", "cached": False,
                "model": model_name, "embedding_version": embedding_version,
                "dim": 0, "duration_seconds": round(time.monotonic() - started, 2),
                "warnings": [f"embeddings: {e}"]}
