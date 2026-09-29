"""Contextual tutor orchestration: one bounded selection -> one teacher call.

The tutor is NEVER triggered automatically (upload, parsing, extraction,
synthesis, embedding, and discovery never call it); the researcher asks
explicitly. Nothing is persisted: no history table, no database writes of
any kind. The SELECTED TEXT is the primary context; surrounding text is
bounded and its role is stated in the prompt; the whole paper is never
sent to the model.
"""
from __future__ import annotations

import re
import time

from .extraction import get_backend
from src.teacher.backend import ModelUnavailable, load_teacher_config
from src.teacher.extraction import _strip_think_blocks
from src.teacher.prompt import TUTOR_PROMPT_VERSION, TUTOR_SYSTEM_PROMPT

# Character bounds: selection primary, context secondary.
MAX_SELECTED_CHARS = 6000
MAX_CONTEXT_CHARS = 2500

_INSUFFICIENT = re.compile(r"(?i)^insufficient context\s*:?\s*")


def _bounded(text: str, limit: int) -> tuple[str, bool]:
    """Truncate honestly: returns (text, was_truncated). Long selections
    are cut for the prompt only — the API still receives them verbatim."""
    text = text or ""
    if len(text) <= limit:
        return text, False
    return text[:limit] + "\n[truncated for length]", True


def build_tutor_prompt(*, title: str, selected: str, context: str,
                       section: str, subsection: str, page: int | None,
                       evidence_line: str) -> str:
    """Pure prompt assembly. Roles of secondary material are explicit."""
    header = ["PAPER (orientation for the paper being read):",
              f"title: {title or 'Untitled'}"]
    if section:
        header.append(f"section: {section}")
    if subsection:
        header.append(f"subsection: {subsection}")
    if page is not None:
        header.append(f"page: {page}")
    parts = ["\n".join(header),
             "SELECTED TEXT (primary material — explain this; verbatim):",
             selected]
    if context:
        parts += ["",
                  "SURROUNDING CONTEXT (role: the paragraph around the"
                  " selection; secondary background only, never a"
                  " substitute for the selection):",
                  context]
    if evidence_line:
        parts += ["",
                  "EXTRACTED EVIDENCE (role: pointer to a statement already"
                  " extracted from this paper; metadata only):",
                  evidence_line]
    parts += ["", "Explain the SELECTED TEXT."]
    return "\n".join(parts)


def _evidence_line(evidence: dict | None) -> str:
    if not evidence:
        return ""
    loc = []
    if evidence.get("section"):
        loc.append(str(evidence["section"]))
    if evidence.get("subsection"):
        loc.append(str(evidence["subsection"]))
    if evidence.get("page_start") is not None:
        loc.append(f"p. {evidence['page_start']}")
    where = f" | {' / '.join(loc)}" if loc else ""
    return (f"{evidence.get('id', '')} | category:"
            f" {evidence.get('category', '')}{where}")


def run_explain(*, paper: dict, text: str, context: str, section: str,
                subsection: str, page: int | None,
                evidence: dict | None) -> dict:
    """Build the bounded prompt, run ONE teacher call, classify the
    outcome honestly. Never writes to the database."""
    selected, sel_cut = _bounded(text, MAX_SELECTED_CHARS)
    ctx, ctx_cut = _bounded(context, MAX_CONTEXT_CHARS)
    prompt = build_tutor_prompt(
        title=paper.get("title", ""), selected=selected, context=ctx,
        section=section, subsection=subsection, page=page,
        evidence_line=_evidence_line(evidence))
    try:
        model = load_teacher_config()["model"]
    except Exception:
        model = "Qwen/Qwen3-1.7B-MLX-8bit"
    out = {
        "paper_id": paper.get("id", ""),
        "status": "ok", "explanation": "", "error": "",
        "model": model, "prompt_version": TUTOR_PROMPT_VERSION,
        "duration_seconds": 0.0, "section": section,
        "subsection": subsection, "page": page,
        "evidence_id": (evidence or {}).get("id", ""),
        "truncated": sel_cut or ctx_cut,
    }
    started = time.monotonic()
    try:
        backend = get_backend()
        raw = backend.extract(prompt, system=TUTOR_SYSTEM_PROMPT)
    except ModelUnavailable as e:
        # Model runtime missing/could not load — surfaced verbatim so the
        # UI can show the real reason behind "Learning is unavailable".
        out["status"] = "unavailable"
        out["error"] = str(e)
    except Exception as e:  # noqa: BLE001 — the actual error goes to the UI
        out["status"] = "error"
        out["error"] = str(e) or type(e).__name__
    else:
        answer = _strip_think_blocks(raw or "").strip()
        m = _INSUFFICIENT.match(answer)
        if m:
            out["status"] = "insufficient"
            out["explanation"] = answer[m.end():].strip()
        elif not answer:
            out["status"] = "error"
            out["error"] = "the model returned an empty explanation"
        else:
            out["explanation"] = answer
    out["duration_seconds"] = round(time.monotonic() - started, 2)
    return out
