"""Evidence -> paper-level synthesis orchestration.

Input is structured evidence (never raw paper text). One model call when
the evidence fits the configured context budget, otherwise hierarchical
per-field-group calls with a deterministic merge (no second LLM pass, so
provenance stays exact). Failed synthesis never touches chunk evidence.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

from . import store
from .database import REPO_ROOT, connect
from .extraction import get_backend
from src.teacher.backend import ModelUnavailable, load_teacher_config
from src.teacher.extraction import extract_json as parse_json_strict
from src.teacher.extraction import ExtractionError
from src.teacher.prompt import (
    EXTRACTION_SCHEMA_VERSION,
    PROMPT_VERSION as EXTRACTION_PROMPT_VERSION,
    SYNTHESIS_PROMPT_VERSION,
    SYNTHESIS_SCHEMA_VERSION,
    SYNTHESIS_SYSTEM_PROMPT,
)
from src.teacher.synthesis import (
    SYNTHESIS_FIELDS,
    SynthesisError,
    build_synthesis_input,
    build_synthesis_prompt,
    check_document,
    estimate_tokens,
    field_evidence_category,
    normalize_evidence,
    resolve_item_sources,
    validate_synthesis,
)

CONFIG_PATH = REPO_ROOT / "config" / "pipeline.yaml"


def load_context_budget() -> tuple[int, int]:
    """(max_total_context_tokens, teacher max_tokens) from config."""
    total, gen = 8000, 2500
    try:
        import yaml  # type: ignore
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        total = int((cfg.get("resource_policy", {}) or {}).get(
            "max_total_context_tokens", total))
        gen = int((cfg.get("teacher", {}) or {}).get("max_tokens", gen))
    except Exception:
        pass
    return total, gen


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _append_warnings(paper_id: str, new: list[str]):
    paper = store.get_paper(paper_id)
    warnings = list(paper.get("parsing_warnings", []) or [])
    warnings.extend(new)
    conn = connect()
    try:
        conn.execute(
            "UPDATE papers SET parsing_warnings_json=?, updated_at=?"
            " WHERE id=?",
            (json.dumps(warnings), _now(), paper_id),
        )
        conn.commit()
    finally:
        conn.close()


def _model_name(backend) -> str:
    try:
        cfg_model = load_teacher_config()["model"]
    except Exception:
        cfg_model = "Qwen/Qwen3-1.7B-MLX-8bit"
    return getattr(backend, "model_id", None) or cfg_model


def _pack_field_batches(synthesis_input: dict,
                        input_budget: int,
                        fields: list | None = None) -> list[list[str]]:
    """Greedily pack fields so each batch's evidence JSON fits budget."""
    fields = fields or SYNTHESIS_FIELDS
    batches: list[list[str]] = []
    current: list[str] = []
    current_tokens = 0
    meta_tokens = estimate_tokens(json.dumps(synthesis_input["paper"])) + \
        estimate_tokens(json.dumps(synthesis_input["sections"])) + 200
    for field in fields:
        cat = field_evidence_category(field)
        field_tokens = sum(
            estimate_tokens(json.dumps(e, ensure_ascii=False))
            for e in synthesis_input["evidence"]
            if e["category"] == cat)
        if current and \
                meta_tokens + current_tokens + field_tokens > input_budget:
            batches.append(current)
            current, current_tokens = [], 0
        current.append(field)
        current_tokens += field_tokens
    if current:
        batches.append(current)
    return batches


def _batch_input(synthesis_input: dict, batch: list[str]) -> dict:
    """Restrict evidence to the batch's field categories.

    Without this, every "hierarchical" call would still carry the full
    evidence payload and the context budget would be silently exceeded.
    """
    cats = {field_evidence_category(f) for f in batch}
    return {
        "paper": synthesis_input["paper"],
        "sections": synthesis_input["sections"],
        "evidence": [e for e in synthesis_input["evidence"]
                     if e["category"] in cats],
    }


def _call_model(backend, prompt: str) -> str:
    try:
        return backend.extract(prompt)
    except ModelUnavailable:
        raise
    except Exception as e:
        raise ModelUnavailable(f"teacher generation failed: {e}")


def _as_synthesis_error(e: Exception) -> SynthesisError:
    if isinstance(e, SynthesisError):
        return e
    kind = getattr(e, "kind", "json")
    if kind not in ("json", "schema", "provenance"):
        kind = "json"
    return SynthesisError(str(e), kind=kind)


def _salvage_items(data: dict, paper_id: str,
                   evidence_by_id: dict) -> tuple[dict, list[str]]:
    """Item-granular salvage of a parsed but invalid batch.

    Returns (valid_by_field, dropped_descriptions). Invalid items are
    discarded with visible reasons — never persisted, never guessed.
    Raises if nothing valid remains.
    """
    valid: dict = {}
    dropped: list[str] = []
    # Document-level violations fail the whole output: salvage only
    # rescues item-level failures from an otherwise sound document.
    check_document(data, paper_id)
    for field in SYNTHESIS_FIELDS:
        entries = data.get(field)
        if not isinstance(entries, list):
            continue
        kept = []
        for i, entry in enumerate(entries):
            try:
                part = validate_synthesis(
                    {"schema_version": SYNTHESIS_SCHEMA_VERSION,
                     field: [entry]}, paper_id, evidence_by_id)
            except SynthesisError as se:
                dropped.append(f"{field}[{i}]: {se}")
                continue
            kept.extend(part.get(field, []))
        if kept:
            valid[field] = kept
    if not any(valid.values()):
        raise SynthesisError("no valid items to salvage")
    return valid, dropped


def run_paper_synthesis(paper_id: str,
                        force: bool = False) -> dict:
    paper = store.get_paper(paper_id)
    if paper is None:
        raise KeyError(f"unknown paper: {paper_id}")
    backend = get_backend()
    model_name = _model_name(backend)

    existing = store.get_synthesis(paper_id, model_name,
                                   SYNTHESIS_PROMPT_VERSION,
                                   SYNTHESIS_SCHEMA_VERSION)
    if existing and existing["synthesis_status"] == "complete" and not force:
        return {"paper_id": paper_id, "status": "complete",
                "cached": True, "model": model_name,
                "prompt_version": SYNTHESIS_PROMPT_VERSION,
                "schema_version": SYNTHESIS_SCHEMA_VERSION,
                "model_calls": existing["model_calls"],
                "repair_attempts": 0,
                "input_tokens": existing["input_tokens"],
                "fields_populated": sum(
                    1 for v in existing["synthesis"].values() if v),
                "warnings": []}

    started = time.monotonic()
    warnings: list[str] = []

    evidence_rows = store.list_evidence(
        paper_id, model_name=model_name,
        prompt_version=EXTRACTION_PROMPT_VERSION,
        schema_version=EXTRACTION_SCHEMA_VERSION)
    if not evidence_rows:
        err = "synthesis: no chunk-level evidence available"
        if not (existing and existing["synthesis_status"] == "complete"):
            store.save_synthesis(paper_id, {}, "error", err, model_name,
                                 SYNTHESIS_PROMPT_VERSION,
                                 SYNTHESIS_SCHEMA_VERSION, 0, 0)
        else:
            err += " (previous complete synthesis preserved)"
        _append_warnings(paper_id, [err])
        return {"paper_id": paper_id, "status": "error", "cached": False,
                "model": model_name, "prompt_version": SYNTHESIS_PROMPT_VERSION,
                "schema_version": SYNTHESIS_SCHEMA_VERSION, "model_calls": 0,
                "repair_attempts": 0,
                "input_tokens": 0, "fields_populated": 0, "warnings": [err]}

    normalized = normalize_evidence(evidence_rows)
    sections = store.list_sections(paper_id)
    synthesis_input = build_synthesis_input(paper, sections, normalized)
    # Every known ID (canonical + merged) resolves to its stored row, so a
    # model citing a merged-away duplicate still validates.
    evidence_by_id: dict = {}
    for e in normalized:
        for eid in e.get("merged_ids", [e["id"]]):
            evidence_by_id[eid] = e

    total_budget, gen_tokens = load_context_budget()
    input_budget = total_budget - gen_tokens - 512
    full_tokens = estimate_tokens(json.dumps(synthesis_input,
                                             ensure_ascii=False))
    # Request only answerable fields (those with matching-category
    # evidence). Unanswerable fields must stay empty per the schema
    # contract; requesting them only invites cross-category citation.
    # The validator still accepts any properly cited field.
    answerable = [f for f in SYNTHESIS_FIELDS
                  if any(e["category"] == field_evidence_category(f)
                         for e in normalized)]
    if full_tokens <= input_budget:
        batches = [answerable]
        hierarchical = False
    else:
        batches = _pack_field_batches(synthesis_input, input_budget,
                                      answerable)
        hierarchical = True
        warnings.append(
            f"synthesis: evidence ({full_tokens} tok) exceeds single-call "
            f"budget ({input_budget} tok); using {len(batches)} "
            f"hierarchical field-group calls")

    merged: dict = {f: [] for f in SYNTHESIS_FIELDS}
    model_calls = 0
    repair_attempts = 0
    input_tokens = 0
    raw = ""

    def run_batch(batch, batch_input):
        """One batch incl. bounded repair; merges into merged."""
        nonlocal model_calls, repair_attempts, input_tokens, raw
        prompt = build_synthesis_prompt(batch_input,
                                        SYNTHESIS_SYSTEM_PROMPT, batch)
        input_tokens = max(input_tokens, estimate_tokens(prompt))
        raw = _call_model(backend, prompt)
        model_calls += 1
        try:
            data = parse_json_strict(raw)
            partial = validate_synthesis(data, paper_id, evidence_by_id)
        except (ExtractionError, SynthesisError) as e:
            # One bounded repair attempt (rewrite or continuation).
            # Pure prose (no brace) is not retried. Repair needs a
            # repair-capable backend; salvage below does not.
            repaired = False
            pre_repair = raw
            if hasattr(backend, "repair") and "{" in raw:
                truncated = not raw.rstrip().endswith("}")
                valid_ids = sorted(evidence_by_id)[:200]
                if truncated:
                    instruction = (
                        "Your previous response was cut off mid-output. "
                        "Output ONLY the continuation, starting exactly "
                        "where it stopped, completing the JSON object. "
                        "Do not repeat any part of the previous response. "
                        "Do not add new statements beyond completing the "
                        "interrupted structure. Cite ONLY evidence IDs "
                        "from this list:\n" + "\n".join(valid_ids))
                    system = ("You output only the continuation text. "
                              "No other text.")
                else:
                    instruction = (
                        "Your previous response failed validation with "
                        f"this error: {e}. Output ONLY the corrected "
                        "JSON object, no other text. Cite ONLY evidence "
                        "IDs from this list; never invent IDs or page "
                        "numbers:\n" + "\n".join(valid_ids))
                    system = None
                try:
                    repair_attempts += 1
                    pre_repair = raw
                    if truncated:
                        continuation = backend.repair(raw, instruction,
                                                      system)
                        model_calls += 1
                        raw = raw.rstrip() + continuation
                        warnings.append(
                            "synthesis: continuation repair attempted")
                    else:
                        raw = backend.repair(raw, instruction)
                        model_calls += 1
                    data = parse_json_strict(raw)
                    partial = validate_synthesis(data, paper_id,
                                                 evidence_by_id)
                    repaired = True
                except (ExtractionError, SynthesisError,
                        ModelUnavailable, Exception):
                    pass
            if not repaired:
                # Last resort: keep individually valid items, discard
                # the rest with visible reasons. Try the repaired
                # output first, then the pre-repair original.
                # Unparseable output cannot be salvaged and fails.
                salvaged = None
                dropped: list = []
                for candidate in dict.fromkeys([raw, pre_repair]):
                    try:
                        salvaged, dropped = _salvage_items(
                            parse_json_strict(candidate), paper_id,
                            evidence_by_id)
                        break
                    except (ExtractionError, SynthesisError):
                        continue
                if salvaged is None:
                    raise _as_synthesis_error(e)
                warnings.append(
                    "synthesis: salvaged valid items; dropped "
                    f"{len(dropped)} unsupported item(s): "
                    + "; ".join(dropped[:5]))
                partial = salvaged
        for f in batch:
            merged[f].extend(partial.get(f, []))

    def fail(e):
        kind = getattr(e, "kind", "error")
        err = f"synthesis: {kind}: {e}"
        has_partial = any(merged.values())
        # Multi-batch runs may have validated items from earlier
        # batches: persist them honestly as "partial", never as
        # complete. Single-batch failures stay "error".
        status = "partial" if has_partial else "error"
        payload = ({f: [{"text": it["text"],
                         "evidence_ids": it["evidence_ids"],
                         "sources": resolve_item_sources(it,
                                                         evidence_by_id)}
                        for it in items]
                    for f, items in merged.items()} if has_partial else {})
        # Never destroy a validated complete synthesis with a failed
        # rerun: keep last-good, record the fresh failure visibly.
        if not (existing and existing["synthesis_status"] == "complete"):
            store.save_synthesis(paper_id, payload, status, err, model_name,
                                 SYNTHESIS_PROMPT_VERSION,
                                 SYNTHESIS_SCHEMA_VERSION, input_tokens,
                                 model_calls, raw_output=raw)
        else:
            err += " (previous complete synthesis preserved)"
        _append_warnings(paper_id, [err])
        return {"paper_id": paper_id, "status": status, "cached": False,
                "model": model_name, "prompt_version": SYNTHESIS_PROMPT_VERSION,
                "schema_version": SYNTHESIS_SCHEMA_VERSION,
                "model_calls": model_calls, "repair_attempts": repair_attempts,
                "input_tokens": input_tokens,
                "fields_populated": sum(1 for v in payload.values() if v),
                "duration_seconds": round(time.monotonic() - started, 2),
                "hierarchical": hierarchical, "warnings": [err]}

    def is_truncation_failure(e) -> bool:
        return (getattr(e, "kind", "") == "json"
                and "{" in (raw or "")
                and not (raw or "").rstrip().endswith("}"))

    try:
        for batch in batches:
            batch_input = synthesis_input if not hierarchical \
                else _batch_input(synthesis_input, batch)
            run_batch(batch, batch_input)
    except (ModelUnavailable, SynthesisError) as e:
        # Single-call output truncated mid-JSON: fall back once to
        # field-group batches (shorter outputs per call). Bounded:
        # sub-batch failures are terminal, never recursive.
        if (not hierarchical and is_truncation_failure(e)):
            # Halve the packing budget so per-call outputs shrink;
            # reported honestly as hierarchical.
            fallback = _pack_field_batches(synthesis_input,
                                           input_budget // 2,
                                           answerable)
            if len(fallback) > 1:
                warnings.append(
                    "synthesis: single-call output truncated; falling "
                    f"back to {len(fallback)} field-group calls")
                hierarchical = True
                try:
                    for batch in fallback:
                        run_batch(batch, _batch_input(synthesis_input,
                                                      batch))
                except (ModelUnavailable, SynthesisError) as e2:
                    return fail(e2)
                # fall through to success path below
            else:
                return fail(e)
        else:
            return fail(e)

    with_sources = {}
    for field, items in merged.items():
        with_sources[field] = [
            {"text": it["text"], "evidence_ids": it["evidence_ids"],
             "sources": resolve_item_sources(it, evidence_by_id)}
            for it in items
        ]
    store.save_synthesis(paper_id, with_sources, "complete", "", model_name,
                         SYNTHESIS_PROMPT_VERSION, SYNTHESIS_SCHEMA_VERSION,
                         input_tokens, model_calls)
    if warnings:
        _append_warnings(paper_id, warnings)
    return {"paper_id": paper_id, "status": "complete", "cached": False,
            "model": model_name, "prompt_version": SYNTHESIS_PROMPT_VERSION,
            "schema_version": SYNTHESIS_SCHEMA_VERSION,
            "model_calls": model_calls, "repair_attempts": repair_attempts,
            "input_tokens": input_tokens,
            "fields_populated": sum(1 for v in with_sources.values() if v),
            "duration_seconds": round(time.monotonic() - started, 2),
            "hierarchical": hierarchical, "warnings": warnings}
