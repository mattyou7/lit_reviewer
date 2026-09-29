"""Chunk-level teacher extraction: prompt building, JSON + provenance validation.

Pure logic (no model, no DB). The application supplies authoritative
paper_id/chunk_id/section/pages; the model output is validated against them.
Invalid output never reaches the database — failures are returned as errors.
"""
from __future__ import annotations

import json
import re
from typing import Any

from .prompt import CATEGORIES, EXTRACTION_SCHEMA_VERSION

CHUNK_HEADER = (
    "chunk_id: {chunk_id}\nsection: {section}\nsubsection: {subsection}\n"
    "page_start: {page_start}\npage_end: {page_end}\n"
)


class ExtractionError(Exception):
    """Raised when model output fails JSON parsing or validation.

    kind: "json" (unparseable), "schema" (wrong shape/version/fields),
    or "provenance" (IDs or page locations do not match the chunk).
    """

    def __init__(self, message: str, kind: str = "schema"):
        super().__init__(message)
        self.kind = kind


def build_chunk_prompt(chunk: dict, system_prompt: str) -> str:
    """One focused chunk per prompt. Never the whole paper."""
    header = CHUNK_HEADER.format(
        chunk_id=chunk.get("chunk_id", ""),
        section=chunk.get("section", ""),
        subsection=chunk.get("subsection", "") or "",
        page_start=chunk.get("source_start") or "null",
        page_end=chunk.get("source_end") or "null",
    )
    return (
        f"{system_prompt}\n\n---\nPAPER CHUNK (use only this text):\n"
        f"{header}\n{chunk.get('text', '')}\n"
    )


def _strip_think_blocks(raw: str) -> str:
    """Remove Qwen3 <think> reasoning traces deterministically.

    The teacher is instructed to return JSON only, but Qwen3 may still
    emit <think>...</think> reasoning before/around the JSON. The trace
    is never evidence: it is the model's private scratch text, it can
    contain stray braces/quotes that break parsing, and it can be long.
    Closed blocks are removed; a trailing unclosed <think> block means
    generation was cut off mid-thought, so nothing after it can be
    trusted and it is dropped too.
    """
    text = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)
    if "<think>" in text and "</think>" not in text:
        text = text.split("<think>")[0]
    return text


def extract_json(raw: str) -> dict:
    """Parse raw model output. Tolerates think traces and code fences."""
    text = _strip_think_blocks(raw).strip()
    if text.startswith("```"):
        lines = text.splitlines()
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    if not text.startswith("{"):
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ExtractionError("output is not JSON (no object found)",
                                  kind="json")
        text = text[start:end + 1]
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ExtractionError(f"JSON parsing failed: {e}", kind="json")
    if not isinstance(data, dict):
        raise ExtractionError("top-level JSON must be an object")
    return data


def _to_int_or_none(value: Any, field: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ExtractionError(f"{field} must be int or null")
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    raise ExtractionError(f"{field} must be int or null, got {value!r}")


def _chunk_page(chunk: dict, key: str) -> int | None:
    raw = chunk.get(key)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        return int(str(raw).strip())
    except ValueError:
        return None


def validate_extraction(data: dict, chunk: dict) -> list[dict]:
    """Validate model output against the app-supplied chunk.

    Returns normalized evidence items. Raises ExtractionError on any
    schema or provenance violation. IDs and section info always come
    from the application, never the model.
    """
    version = data.get("schema_version")
    if version is None:
        raise ExtractionError("missing schema_version")
    if str(version) != EXTRACTION_SCHEMA_VERSION:
        raise ExtractionError(
            f"unsupported schema_version {version!r} "
            f"(expected {EXTRACTION_SCHEMA_VERSION})"
        )

    for key in ("paper_id", "chunk_id"):
        if key in data and data[key] not in (None, "", chunk.get(key, "")):
            if str(data[key]) != str(chunk.get(key, "")):
                raise ExtractionError(
                    f"model emitted wrong {key}: {data[key]!r}",
                    kind="provenance")

    allowed = set(CATEGORIES) | {"schema_version", "paper_id", "chunk_id"}
    unknown = [k for k in data if k not in allowed]
    if unknown:
        raise ExtractionError(f"unexpected fields: {sorted(unknown)}")

    chunk_section = (chunk.get("section") or "").strip().casefold()
    chunk_sub = (chunk.get("subsection") or "").strip().casefold()
    page_start = _chunk_page(chunk, "source_start")
    page_end = _chunk_page(chunk, "source_end")
    chunk_has_pages = page_start is not None and page_end is not None

    items: list[dict] = []
    for category in CATEGORIES:
        entries = data.get(category, [])
        if entries is None:
            continue
        if not isinstance(entries, list):
            raise ExtractionError(f"{category} must be a list")
        for i, entry in enumerate(entries):
            where = f"{category}[{i}]"
            if not isinstance(entry, dict):
                raise ExtractionError(f"{where} must be an object")
            text = entry.get("text", "")
            if not isinstance(text, str) or not text.strip():
                raise ExtractionError(f"{where} missing non-empty text")
            source = entry.get("source")
            if not isinstance(source, dict):
                raise ExtractionError(f"{where} missing source object")

            src_chunk = source.get("chunk_id")
            if src_chunk not in (None, "") and str(src_chunk) != str(
                    chunk.get("chunk_id")):
                raise ExtractionError(
                    f"{where} points at wrong chunk_id: {src_chunk!r}",
                    kind="provenance")

            for fkey, cval in (("section", chunk_section),
                               ("subsection", chunk_sub)):
                sval = source.get(fkey)
                if sval not in (None, "") and cval and \
                        str(sval).strip().casefold() != cval:
                    raise ExtractionError(
                        f"{where} {fkey} mismatch: {sval!r}",
                        kind="provenance")

            ps = _to_int_or_none(source.get("page_start"), f"{where}.page_start")
            pe = _to_int_or_none(source.get("page_end"), f"{where}.page_end")
            if ps is not None and pe is not None and ps > pe:
                raise ExtractionError(f"{where} page_start > page_end")
            if chunk_has_pages:
                for p in (ps, pe):
                    if p is not None and not (page_start <= p <= page_end):
                        raise ExtractionError(
                            f"{where} page {p} outside chunk pages "
                            f"{page_start}-{page_end}", kind="provenance")
                location = "known" if ps is not None else \
                    "SOURCE LOCATION UNKNOWN"
            else:
                if ps is not None or pe is not None:
                    raise ExtractionError(
                        f"{where} gives page numbers the chunk does not have",
                        kind="provenance")
                ps, pe = None, None
                location = "SOURCE LOCATION UNKNOWN"

            status = entry.get("status", "explicit")
            if status != "explicit":
                raise ExtractionError(
                    f"{where} status must be 'explicit', got {status!r}")

            items.append({
                "category": category,
                "text": text.strip(),
                "section": chunk.get("section", ""),
                "subsection": chunk.get("subsection", "") or "",
                "page_start": ps,
                "page_end": pe,
                "location_status": location,
                "status": "explicit",
            })
    return items
