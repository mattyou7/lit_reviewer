from __future__ import annotations

from dataclasses import asdict
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .schema import Chunk


# Rough approximation for English scientific text.
# We are deliberately using an approximation here because the actual
# tokenizer belongs to the LLM stage.
CHARS_PER_TOKEN = 4

TARGET_TOKENS = 1800
OVERLAP_TOKENS = 150


def _estimate_tokens(text: str) -> int:
    """Approximate token count."""
    return max(1, len(text) // CHARS_PER_TOKEN)


def _normalize_text(text: Any) -> str:
    """Convert supported text representations into clean text."""
    if text is None:
        return ""

    if isinstance(text, str):
        return text.strip()

    if isinstance(text, list):
        parts = []
        for item in text:
            value = _normalize_text(item)
            if value:
                parts.append(value)
        return "\n\n".join(parts).strip()

    if isinstance(text, dict):
        # Prefer explicit text fields.
        for key in ("text", "content", "body"):
            if key in text:
                return _normalize_text(text[key])

    return str(text).strip()


def _split_paragraphs(text: str) -> List[str]:
    """
    Split text into paragraph-like units.

    We deliberately preserve paragraphs rather than cutting every N
    characters because scientific sentences/equations often span lines.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    paragraphs = []

    for block in text.split("\n\n"):
        block = " ".join(line.strip() for line in block.splitlines())
        block = " ".join(block.split())

        if block:
            paragraphs.append(block)

    return paragraphs


def _tail_for_overlap(paragraphs: List[str], max_tokens: int) -> List[str]:
    """
    Return the final paragraphs that fit approximately within the
    requested overlap size.
    """
    selected = []
    tokens = 0

    for paragraph in reversed(paragraphs):
        n = _estimate_tokens(paragraph)

        if selected and tokens + n > max_tokens:
            break

        selected.append(paragraph)
        tokens += n

        if tokens >= max_tokens:
            break

    return list(reversed(selected))


def _chunk_subsection(
    text: str,
    target_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> List[str]:
    """
    Chunk one subsection while preserving paragraph boundaries.
    """
    paragraphs = _split_paragraphs(text)

    if not paragraphs:
        return []

    chunks: List[str] = []
    current: List[str] = []
    current_tokens = 0

    i = 0

    while i < len(paragraphs):
        paragraph = paragraphs[i]
        paragraph_tokens = _estimate_tokens(paragraph)

        # If this is the first paragraph and it is already larger than
        # the target, keep it intact rather than destroying it.
        if not current and paragraph_tokens > target_tokens:
            chunks.append(paragraph)

            overlap = _tail_for_overlap(
                [paragraph],
                overlap_tokens,
            )

            current = overlap
            current_tokens = sum(_estimate_tokens(p) for p in current)

            i += 1
            continue

        # Normal accumulation.
        if (
            current
            and current_tokens + paragraph_tokens > target_tokens
        ):
            chunks.append("\n\n".join(current))

            overlap = _tail_for_overlap(
                current,
                overlap_tokens,
            )

            current = overlap
            current_tokens = sum(
                _estimate_tokens(p) for p in current
            )

            continue

        current.append(paragraph)
        current_tokens += paragraph_tokens
        i += 1

    if current:
        final_text = "\n\n".join(current)

        # Avoid creating a duplicate chunk consisting entirely of
        # overlap from the previous chunk.
        if not chunks or final_text != chunks[-1]:
            chunks.append(final_text)

    return chunks


def _extract_subsections(
    section_name: str,
    section_data: Any,
) -> List[Tuple[str, Optional[str], str, Optional[str], Optional[str]]]:
    """
    Convert the various section representations into:

        section,
        subsection,
        text,
        source_start,
        source_end

    The function is intentionally tolerant because the sectioner has
    evolved through several representations.
    """

    results = []

    # ------------------------------------------------------------
    # Case 1:
    # section_data is simply a string
    # ------------------------------------------------------------
    if isinstance(section_data, str):
        text = _normalize_text(section_data)

        if text:
            results.append(
                (
                    section_name,
                    None,
                    text,
                    None,
                    None,
                )
            )

        return results

    # ------------------------------------------------------------
    # Case 2:
    # section_data is a list
    # ------------------------------------------------------------
    if isinstance(section_data, list):

        # A list may contain subsection dictionaries.
        for item in section_data:

            if isinstance(item, dict):

                subsection = (
                    item.get("subsection")
                    or item.get("name")
                    or item.get("heading")
                    or item.get("title")
                )

                text = (
                    item.get("text")
                    or item.get("content")
                    or item.get("body")
                    or ""
                )

                source_start = (
                    item.get("source_start")
                    or item.get("start")
                )

                source_end = (
                    item.get("source_end")
                    or item.get("end")
                )

                text = _normalize_text(text)

                if text:
                    results.append(
                        (
                            section_name,
                            subsection,
                            text,
                            source_start,
                            source_end,
                        )
                    )

            else:
                text = _normalize_text(item)

                if text:
                    results.append(
                        (
                            section_name,
                            None,
                            text,
                            None,
                            None,
                        )
                    )

        return results

    # ------------------------------------------------------------
    # Case 3:
    # section_data is a dictionary
    # ------------------------------------------------------------
    if isinstance(section_data, dict):

        # Explicit subsection container.
        subsection_data = (
            section_data.get("subsections")
            or section_data.get("children")
        )

        if subsection_data is not None:

            if isinstance(subsection_data, dict):

                for subsection_name, subsection_value in subsection_data.items():

                    text = _normalize_text(subsection_value)

                    if text:
                        results.append(
                            (
                                section_name,
                                str(subsection_name),
                                text,
                                None,
                                None,
                            )
                        )

                return results

            if isinstance(subsection_data, list):

                for item in subsection_data:

                    if isinstance(item, dict):

                        subsection = (
                            item.get("subsection")
                            or item.get("name")
                            or item.get("heading")
                            or item.get("title")
                        )

                        text = (
                            item.get("text")
                            or item.get("content")
                            or item.get("body")
                            or ""
                        )

                        source_start = (
                            item.get("source_start")
                            or item.get("start")
                        )

                        source_end = (
                            item.get("source_end")
                            or item.get("end")
                        )

                        text = _normalize_text(text)

                        if text:
                            results.append(
                                (
                                    section_name,
                                    subsection,
                                    text,
                                    source_start,
                                    source_end,
                                )
                            )

                    else:
                        text = _normalize_text(item)

                        if text:
                            results.append(
                                (
                                    section_name,
                                    None,
                                    text,
                                    None,
                                    None,
                                )
                            )

                return results

        # --------------------------------------------------------
        # Dictionary itself may represent:
        #
        # {
        #   "text": "...",
        #   "subsection": "...",
        #   ...
        # }
        # --------------------------------------------------------

        text = (
            section_data.get("text")
            or section_data.get("content")
            or section_data.get("body")
        )

        if text is not None:

            subsection = (
                section_data.get("subsection")
                or section_data.get("name")
                or section_data.get("heading")
                or section_data.get("title")
            )

            source_start = (
                section_data.get("source_start")
                or section_data.get("start")
            )

            source_end = (
                section_data.get("source_end")
                or section_data.get("end")
            )

            text = _normalize_text(text)

            if text:
                results.append(
                    (
                        section_name,
                        subsection,
                        text,
                        source_start,
                        source_end,
                    )
                )

            return results

        # --------------------------------------------------------
        # Last fallback:
        # dictionary keys are treated as subsection names.
        # --------------------------------------------------------
        for subsection_name, subsection_value in section_data.items():

            if subsection_name in {
                "page",
                "pages",
                "source_start",
                "source_end",
                "start",
                "end",
            }:
                continue

            text = _normalize_text(subsection_value)

            if text:
                results.append(
                    (
                        section_name,
                        str(subsection_name),
                        text,
                        None,
                        None,
                    )
                )

        return results

    return results


def chunk_all_sections(
    sections: Dict[str, Any],
    paper_id: str = "paper_001",
    target_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> List[Chunk]:
    """
    Chunk every section while preserving subsection identity.

    Output:
        List[Chunk]

    Each Chunk contains:
        paper_id
        section
        subsection
        chunk_id
        text
        source_start
        source_end
    """

    chunks: List[Chunk] = []

    for section_name, section_data in sections.items():

        subsection_items = _extract_subsections(
            section_name,
            section_data,
        )

        for (
            section,
            subsection,
            text,
            source_start,
            source_end,
        ) in subsection_items:

            subsection_chunks = _chunk_subsection(
                text,
                target_tokens=target_tokens,
                overlap_tokens=overlap_tokens,
            )

            for local_index, chunk_text in enumerate(
                subsection_chunks,
                start=1,
            ):

                # Make IDs stable and human-readable.
                section_id = (
                    section.lower()
                    .replace(" ", "_")
                    .replace("/", "_")
                )

                if subsection:
                    subsection_id = (
                        str(subsection)
                        .lower()
                        .replace(" ", "_")
                        .replace("/", "_")
                    )

                    chunk_id = (
                        f"{section_id}_"
                        f"{subsection_id}_"
                        f"{local_index:03d}"
                    )
                else:
                    chunk_id = (
                        f"{section_id}_"
                        f"{local_index:03d}"
                    )

                chunks.append(
                    Chunk(
                        paper_id=paper_id,
                        section=section,
                        chunk_id=chunk_id,
                        text=chunk_text,
                        subsection=subsection,
                        source_start=source_start,
                        source_end=source_end,
                    )
                )

    return chunks


# Compatibility alias used by the existing pipeline.
def chunk_sections(
    sections: Dict[str, Any],
    paper_id: str = "paper_001",
    target_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> List[Chunk]:

    return chunk_all_sections(
        sections=sections,
        paper_id=paper_id,
        target_tokens=target_tokens,
        overlap_tokens=overlap_tokens,
    )