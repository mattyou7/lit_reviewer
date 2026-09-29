"""Paper-level synthesis: validated evidence -> structured representation.

Pure logic (no model, no DB). The model receives structured evidence
(never raw paper text) and returns items that reference evidence IDs.
Page numbers are NEVER trusted from the model: the application resolves
evidence IDs to stored source locations.

Version authority: SYNTHESIS_*_VERSION live in src/teacher/prompt.py
alongside the prompt text they version.
"""
from __future__ import annotations

import json
from typing import Any

from .prompt import SYNTHESIS_SCHEMA_VERSION

# Paper-level fields. "main_results" is synthesized from chunk-level
# "results" evidence; all other names match evidence categories.
SYNTHESIS_FIELDS = [
    "research_question",
    "hypotheses",
    "population_or_dataset",
    "task",
    "stimuli",
    "experimental_procedure",
    "methods",
    "computational_methods",
    "statistical_methods",
    "variables",
    "main_results",
    "author_interpretations",
    "limitations",
    "concepts",
    "terminology",
    "author_stated_future_work",
]

EVIDENCE_CATEGORY_FOR_FIELD = {
    "main_results": "results",
}


def field_evidence_category(field: str) -> str:
    return EVIDENCE_CATEGORY_FOR_FIELD.get(field, field)


class SynthesisError(Exception):
    """Raised when synthesis output fails validation.

    kind: "json" (unparseable), "schema" (wrong shape/version/fields),
    or "provenance" (bad paper_id, unknown/foreign evidence IDs,
    missing evidence, smuggled page numbers).
    """

    def __init__(self, message: str, kind: str = "schema"):
        super().__init__(message)
        self.kind = kind


def normalize_text(text: str) -> str:
    return " ".join(text.strip().casefold().split())


def normalize_evidence(items: list[dict]) -> list[dict]:
    """Conservative overlap normalization.

    Chunk overlap means adjacent chunks can yield the same underlying
    statement twice. Merge only exact duplicates (after case/whitespace
    normalization) within the same category. The surviving item keeps the
    first evidence ID as canonical and records every original ID in
    `merged_ids` so no provenance is lost. Genuinely distinct claims are
    never merged.
    """
    groups: dict = {}
    order: list = []
    for it in items:
        key = (it.get("category", ""), normalize_text(it.get("text", "")))
        if key not in groups:
            groups[key] = dict(it)
            groups[key]["merged_ids"] = [it["id"]]
            order.append(key)
        else:
            groups[key]["merged_ids"].append(it["id"])
    return [groups[k] for k in order]


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def build_synthesis_input(paper: dict, sections: list[dict],
                          evidence: list[dict]) -> dict:
    """Compact structured synthesis context (JSON, not raw prose)."""
    return {
        "paper": {
            "paper_id": paper["id"],
            "title": paper.get("title", ""),
            "authors": paper.get("authors", []),
            "year": paper.get("year"),
            "journal": paper.get("journal", ""),
        },
        "sections": [
            {"name": s["name"],
             "items": len(s.get("items", []))}
            for s in sections
        ],
        "evidence": [
            {"evidence_id": e["id"],
             "category": e["category"],
             "text": e["text"],
             "merged_ids": e.get("merged_ids", [e["id"]]),
             "source": {
                 "chunk_id": e.get("chunk_id", ""),
                 "section": e.get("section", ""),
                 "subsection": e.get("subsection", ""),
                 "page_start": e.get("page_start"),
                 "page_end": e.get("page_end"),
                 "location_status": e.get("location_status", "known"),
             }}
            for e in evidence
        ],
    }


def build_synthesis_prompt(synthesis_input: dict, system_prompt: str,
                           fields: list[str]) -> str:
    """Prompt for one synthesis call over the given fields only."""
    return (
        f"{system_prompt}\n\n---\nFIELDS TO FILL (only these):\n"
        f"{json.dumps(fields)}\n\n---\nVALIDATED EVIDENCE (JSON):\n"
        f"{json.dumps(synthesis_input, ensure_ascii=False)}\n"
    )


def parse_synthesis_json(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.splitlines()[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise SynthesisError("output is not JSON (no object found)",
                                 kind="json")
        text = text[start:end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise SynthesisError(f"JSON parsing failed: {e}", kind="json")
    if not isinstance(data, dict):
        raise SynthesisError("top-level JSON must be an object")
    return data


def _coerce_field_list(value: Any, field: str) -> list:
    """Missing/null/"UNKNOWN" -> []. Anything else must be a list."""
    if value is None:
        return []
    if isinstance(value, str):
        if value.strip().casefold() == "unknown":
            return []
        raise SynthesisError(
            f"{field} must be a list (got string {value!r})")
    if isinstance(value, list):
        return value
    raise SynthesisError(f"{field} must be a list")


def check_document(data: dict, paper_id: str) -> None:
    """Document-level checks: version, paper identity, known fields.

    Violations here poison the whole document (wrong paper, unknown
    schema) and must fail it entirely — item salvage must never
    rescue items out of such output.
    """
    version = data.get("schema_version")
    if version is None:
        raise SynthesisError("missing schema_version")
    if str(version) != SYNTHESIS_SCHEMA_VERSION:
        raise SynthesisError(
            f"unsupported schema_version {version!r} "
            f"(expected {SYNTHESIS_SCHEMA_VERSION})")

    if "paper_id" in data and data["paper_id"] not in (None, ""):
        if str(data["paper_id"]) != str(paper_id):
            raise SynthesisError(
                f"model emitted wrong paper_id: {data['paper_id']!r}",
                kind="provenance")

    allowed = set(SYNTHESIS_FIELDS) | {"schema_version", "paper_id"}
    unknown = [k for k in data if k not in allowed]
    if unknown:
        raise SynthesisError(f"unexpected fields: {sorted(unknown)}")


def validate_synthesis(data: dict, paper_id: str,
                       evidence_by_id: dict) -> dict:
    """Validate model output. Returns normalized {field: [items]}.

    Item provenance comes ONLY from stored evidence: each item must cite
    >=1 evidence ID that exists and belongs to this paper. Any page
    numbers authored by the model are rejected, not trusted.
    """
    check_document(data, paper_id)

    out: dict = {}
    for field in SYNTHESIS_FIELDS:
        entries = _coerce_field_list(data.get(field), field)
        items = []
        for i, entry in enumerate(entries):
            where = f"{field}[{i}]"
            if not isinstance(entry, dict):
                raise SynthesisError(f"{where} must be an object")
            text = entry.get("text", "")
            if not isinstance(text, str) or not text.strip():
                raise SynthesisError(f"{where} missing non-empty text")
            eids = entry.get("evidence_ids")
            if not isinstance(eids, list) or not eids:
                raise SynthesisError(
                    f"{where} missing non-empty evidence_ids",
                    kind="provenance")
            for eid in eids:
                if eid not in evidence_by_id:
                    raise SynthesisError(
                        f"{where} cites unknown evidence ID {eid!r}",
                        kind="provenance")
                ev = evidence_by_id[eid]
                if str(ev.get("paper_id", "")) != str(paper_id):
                    raise SynthesisError(
                        f"{where} cites evidence from another paper: "
                        f"{eid!r}",
                        kind="provenance")
                expected_cat = field_evidence_category(field)
                actual_cat = ev.get("category", "")
                if actual_cat != expected_cat:
                    raise SynthesisError(
                        f"{where} cites {actual_cat!r} evidence for "
                        f"{field!r}: cite {expected_cat!r} evidence, "
                        f"or leave the field empty",
                        kind="provenance")
            for smuggled in ("page_start", "page_end", "pages", "source"):
                val = entry.get(smuggled)
                if val not in (None, "", [], {}):
                    raise SynthesisError(
                        f"{where} contains model-authored location "
                        f"{smuggled!r}: page numbers must come from "
                        f"stored evidence, not the model",
                        kind="provenance")
            items.append({"text": text.strip(),
                          "evidence_ids": list(eids)})
        out[field] = items
    return out


def resolve_item_sources(item: dict, evidence_by_id: dict) -> list[dict]:
    """Map an item's evidence IDs to stored source locations."""
    sources = []
    for eid in item["evidence_ids"]:
        ev = evidence_by_id[eid]
        sources.append({
            "evidence_id": eid,
            "chunk_id": ev.get("chunk_id", ""),
            "section": ev.get("section", ""),
            "subsection": ev.get("subsection", ""),
            "page_start": ev.get("page_start"),
            "page_end": ev.get("page_end"),
            "location_status": ev.get("location_status", "known"),
        })
    return sources
