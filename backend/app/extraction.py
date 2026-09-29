"""Chunk -> teacher -> validated evidence orchestration.

One chunk per model call. Idempotent: chunks already successfully processed
with the same (model, prompt_version, schema_version) are skipped unless
forced. Retries target only failed chunks. Failures are recorded visibly.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone

from . import store
from .database import connect
from src.teacher.backend import (
    MLXTeacherBackend,
    ModelUnavailable,
    TeacherBackend,
    load_teacher_config,
)
from src.teacher.extraction import (
    ExtractionError,
    build_chunk_prompt,
    extract_json,
    validate_extraction,
)
from src.teacher.prompt import (
    EXTRACTION_SCHEMA_VERSION,
    PROMPT_VERSION,
    SYSTEM_PROMPT,
)

_backend: TeacherBackend | None = None


def get_backend() -> TeacherBackend:
    global _backend
    if _backend is None:
        _backend = MLXTeacherBackend()
    return _backend


def set_backend(backend: TeacherBackend | None):
    """Test hook: inject a fake backend (or reset to lazy MLX with None)."""
    global _backend
    _backend = backend


def _append_warnings(paper_id: str, new: list[str]):
    paper = store.get_paper(paper_id)
    warnings = list(paper.get("parsing_warnings", []) or [])
    warnings.extend(new)
    conn = connect()
    try:
        conn.execute(
            "UPDATE papers SET parsing_warnings_json=?, updated_at=?"
            " WHERE id=?",
            (json.dumps(warnings),
             datetime.now(timezone.utc).isoformat(), paper_id),
        )
        conn.commit()
    finally:
        conn.close()


def _set_status(paper_id: str, status: str):
    conn = connect()
    try:
        conn.execute(
            "UPDATE papers SET extraction_status=?, updated_at=? WHERE id=?",
            (status, datetime.now(timezone.utc).isoformat(), paper_id),
        )
        conn.commit()
    finally:
        conn.close()


def _fail(paper_id, chunk_id, error, model_name, failure_type, raw,
          stats, warnings):
    store.record_chunk_extraction(
        paper_id, chunk_id, "failed", error, model_name, PROMPT_VERSION,
        EXTRACTION_SCHEMA_VERSION, failure_type=failure_type,
        raw_output=raw or "")
    stats["failed"] += 1
    warnings.append(f"extraction: {chunk_id}: {error}")


def _mechanically_repairable(error_msg: str) -> bool:
    """Mechanical fixes only: missing version key or junk top-level keys.

    Bare strings, missing text, and provenance errors need scientific
    judgment to fix, so they are never repaired — they fail visibly.
    """
    m = error_msg.lower()
    return ("missing schema_version" in m
            or "unsupported schema_version" in m
            or "unexpected fields" in m)


def _repair_instruction(kind: str, error_msg: str) -> str:
    base = ("Repair the supplied output into the required JSON schema. "
            "Do not add new scientific information. Do not invent "
            "evidence. Do not change scientific content. Only correct "
            "formatting/schema problems. ")
    if kind == "schema":
        return (base + f"Specific problem to fix mechanically: {error_msg}. "
                "Add \"schema_version\": \"1.0\" as the first key if it is "
                "missing. Remove any unrecognized top-level keys. Keep all "
                "valid items unchanged.")
    return base + f"Specific problem: {error_msg}."


def _try_repair(backend, chunk, raw, error_msg, kind, paper_id,
                model_name, stats, warnings) -> bool:
    """One bounded repair attempt. True iff repaired output validates
    and is persisted. Pure prose (no brace) is never retried."""
    if "{" not in (raw or "") or not hasattr(backend, "repair"):
        return False
    if kind == "schema" and not _mechanically_repairable(error_msg):
        return False
    try:
        stats["repair_attempts"] += 1
        repaired_raw = backend.repair(
            raw, _repair_instruction(kind, error_msg))
        data = extract_json(repaired_raw)
        items = validate_extraction(data, chunk)
    except (ExtractionError, ModelUnavailable, Exception):
        return False
    n = store.save_evidence_items(
        paper_id, chunk["chunk_id"], items, model_name, PROMPT_VERSION,
        EXTRACTION_SCHEMA_VERSION)
    store.record_chunk_extraction(
        paper_id, chunk["chunk_id"], "success", "", model_name,
        PROMPT_VERSION, EXTRACTION_SCHEMA_VERSION)
    stats["evidence_items"] += n
    stats["repair_successes"] += 1
    warnings.append(
        f"extraction: {chunk['chunk_id']}: repaired after {kind} failure")
    return True


def run_paper_extraction(paper_id: str, force: bool = False,
                         limit: int | None = None,
                         chunk_ids: list[str] | None = None) -> dict:
    if store.get_paper(paper_id) is None:
        raise KeyError(f"unknown paper: {paper_id}")
    chunks = store.list_chunks(paper_id)
    if chunk_ids is not None:
        wanted = set(chunk_ids)
        chunks = [c for c in chunks if c["chunk_id"] in wanted]
    if limit is not None:
        chunks = chunks[:limit]
    if not chunks:
        _set_status(paper_id, "error")
        _append_warnings(paper_id, ["extraction: no chunks to process"])
        return {"paper_id": paper_id, "status": "error", "chunks_total": 0,
                "succeeded": 0, "failed": 0, "skipped_cached": 0,
                "evidence_items": 0, "json_failures": 0,
                "provenance_failures": 0, "warnings": ["no chunks"]}

    backend = get_backend()

    try:
        cfg_model = load_teacher_config()["model"]
    except Exception:
        cfg_model = "Qwen/Qwen3-1.7B-MLX-8bit"
    model_name = getattr(backend, "model_id", None) or cfg_model

    stats = {"paper_id": paper_id, "chunks_total": len(chunks),
             "succeeded": 0, "failed": 0, "skipped_cached": 0,
             "evidence_items": 0, "json_failures": 0,
             "provenance_failures": 0, "repair_attempts": 0,
             "repair_successes": 0,
             "model": model_name, "prompt_version": PROMPT_VERSION,
             "schema_version": EXTRACTION_SCHEMA_VERSION}
    warnings: list[str] = []
    started = time.monotonic()

    for chunk in chunks:
        chunk["paper_id"] = paper_id
        if not force:
            rec = store.get_chunk_extraction(
                paper_id, chunk["chunk_id"], model_name, PROMPT_VERSION,
                EXTRACTION_SCHEMA_VERSION)
            if rec and rec["status"] == "success":
                stats["skipped_cached"] += 1
                continue
        prompt = build_chunk_prompt(chunk, SYSTEM_PROMPT)
        try:
            raw = backend.extract(prompt)
        except ModelUnavailable as e:
            _fail(paper_id, chunk["chunk_id"], f"model: {e}", model_name,
                  "model", "", stats, warnings)
            continue
        except Exception as e:
            _fail(paper_id, chunk["chunk_id"], f"backend: {e}", model_name,
                  "model", "", stats, warnings)
            continue
        try:
            data = extract_json(raw)
        except ExtractionError as e:
            if _try_repair(backend, chunk, raw, str(e), "json",
                           paper_id, model_name, stats, warnings):
                stats["succeeded"] += 1
                continue
            _fail(paper_id, chunk["chunk_id"], f"json: {e}", model_name,
                  "json", raw, stats, warnings)
            stats["json_failures"] += 1
            continue
        try:
            items = validate_extraction(data, chunk)
        except ExtractionError as e:
            if e.kind == "provenance":
                _fail(paper_id, chunk["chunk_id"],
                      f"provenance: {e}", model_name, "provenance", raw,
                      stats, warnings)
                stats["provenance_failures"] += 1
                continue
            if _try_repair(backend, chunk, raw, str(e), "schema",
                           paper_id, model_name, stats, warnings):
                stats["succeeded"] += 1
                continue
            _fail(paper_id, chunk["chunk_id"], f"{e.kind}: {e}",
                  model_name, "schema", raw, stats, warnings)
            stats["json_failures"] += 1
            continue
        n = store.save_evidence_items(
            paper_id, chunk["chunk_id"], items, model_name, PROMPT_VERSION,
            EXTRACTION_SCHEMA_VERSION)
        store.record_chunk_extraction(
            paper_id, chunk["chunk_id"], "success", "", model_name,
            PROMPT_VERSION, EXTRACTION_SCHEMA_VERSION)
        stats["succeeded"] += 1
        stats["evidence_items"] += n

    stats["duration_seconds"] = round(time.monotonic() - started, 2)
    if stats["succeeded"] == stats["chunks_total"]:
        status = "complete"
    elif stats["succeeded"] > 0:
        status = "partial"
    else:
        status = "error"
    stats["status"] = status
    _set_status(paper_id, status)
    if warnings:
        _append_warnings(paper_id, warnings)
    stats["warnings"] = warnings
    return stats
