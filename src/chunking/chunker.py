from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from .schema import Chunk


# ============================================================
# Chunking configuration
# ============================================================

CHARS_PER_TOKEN = 4

TARGET_TOKENS = 1800
OVERLAP_TOKENS = 150


# ============================================================
# Token estimation
# ============================================================

def _estimate_tokens(text: str) -> int:
    """
    Rough token estimate for English scientific text.

    The actual tokenizer will be used later by the LLM stage.
    """
    if not text:
        return 0

    return max(1, len(text) // CHARS_PER_TOKEN)


# ============================================================
# Text normalization
# ============================================================

def _normalize_text(text: Any) -> str:

    if text is None:
        return ""

    if isinstance(text, str):
        return text.strip()

    return str(text).strip()


# ============================================================
# Build paragraphs from sectioner output
# ============================================================

def _build_paragraphs(
    items: List[Dict[str, Any]],
) -> List[Tuple[str, Optional[int], Optional[int]]]:
    """
    Convert the sectioner's line-by-line representation into
    paragraph-like units.

    The sectioner gives us items like:

        {
            "page": 8,
            "text": "...",
            "subsection": "participants",
            "is_heading": False
        }

    Two item origins exist (`unit` field, set by the sectioner):

    - "block": one PyMuPDF block = one paragraph-like unit.
      Blocks never contain blank-line separators, so joining
      consecutive blocks would merge whole pages into a single
      mega-paragraph. Each block stands alone (its internal
      line wraps are joined with spaces).
    - "line" (legacy, or missing): consecutive lines belonging
      to the same paragraph are joined together; blank lines
      terminate a paragraph.

    We DO NOT want every line to become a chunk.

    Returns:

        [
            (paragraph_text, start_page, end_page),
            ...
        ]
    """

    paragraphs = []

    current_lines: List[str] = []
    current_start_page: Optional[int] = None
    current_end_page: Optional[int] = None

    def _flush() -> None:
        nonlocal current_lines, current_start_page, current_end_page
        if current_lines:
            paragraph = " ".join(current_lines).strip()
            if paragraph:
                paragraphs.append(
                    (
                        paragraph,
                        current_start_page,
                        current_end_page,
                    )
                )
        current_lines = []
        current_start_page = None
        current_end_page = None

    for item in items:

        if not isinstance(item, dict):
            continue

        text = _normalize_text(item.get("text", ""))
        page = item.get("page")

        # ----------------------------------------------------
        # Block-origin item: one block = one paragraph.
        # ----------------------------------------------------

        if item.get("unit", "line") == "block":

            _flush()

            # Heading items are NOT paragraph text.
            #
            # The subsection name is already stored in metadata.
            if item.get("is_heading", False):
                continue

            if text:
                paragraph = " ".join(
                    text.splitlines()
                ).strip()
                if paragraph:
                    paragraphs.append(
                        (
                            paragraph,
                            page,
                            page,
                        )
                    )

            continue

        # ----------------------------------------------------
        # Legacy line-origin items: join until blank line.
        # ----------------------------------------------------

        if not text:

            _flush()
            continue

        # ----------------------------------------------------
        # Heading items are NOT paragraph text.
        #
        # The subsection name is already stored in metadata.
        # ----------------------------------------------------

        if item.get("is_heading", False):
            continue

        # ----------------------------------------------------
        # Start new paragraph
        # ----------------------------------------------------

        if current_start_page is None:
            current_start_page = page

        current_end_page = page

        current_lines.append(text)

    # --------------------------------------------------------
    # Flush final paragraph
    # --------------------------------------------------------

    _flush()

    return paragraphs


# ============================================================
# Chunk one subsection
# ============================================================

def _chunk_subsection(
    items: List[Dict[str, Any]],
    target_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> List[Tuple[str, Optional[int], Optional[int]]]:
    """
    Chunk a single subsection.

    Paragraphs are kept intact wherever possible.

    Returns:

        [
            (
                chunk_text,
                source_start_page,
                source_end_page
            ),
            ...
        ]
    """

    paragraphs = _build_paragraphs(items)

    if not paragraphs:
        return []

    chunks = []

    current_paragraphs: List[
        Tuple[str, Optional[int], Optional[int]]
    ] = []

    current_tokens = 0

    i = 0

    # Structural hang guard: every loop iteration must either
    # consume a paragraph or empty a non-empty accumulator, so
    # this bound is never reached on legitimate input. It exists
    # so a pathological case fails loudly instead of freezing.
    max_iterations = len(paragraphs) * 4 + 100
    iterations = 0

    while i < len(paragraphs):

        iterations += 1

        if iterations > max_iterations:
            raise RuntimeError(
                "chunker failed to make progress "
                f"(paragraph {i}/{len(paragraphs)})"
            )

        paragraph, start_page, end_page = paragraphs[i]

        paragraph_tokens = _estimate_tokens(paragraph)

        # ----------------------------------------------------
        # Very large paragraph
        # ----------------------------------------------------

        if (
            not current_paragraphs
            and paragraph_tokens > target_tokens
        ):

            chunks.append(
                (
                    paragraph,
                    start_page,
                    end_page,
                )
            )

            # Do not create artificial overlap from a giant
            # paragraph. Move directly to the next paragraph.
            i += 1
            continue

        # ----------------------------------------------------
        # Would exceed target
        # ----------------------------------------------------

        if (
            current_paragraphs
            and current_tokens + paragraph_tokens > target_tokens
        ):

            chunk_text = "\n\n".join(
                p[0]
                for p in current_paragraphs
            )

            chunk_start = current_paragraphs[0][1]
            chunk_end = current_paragraphs[-1][2]

            chunks.append(
                (
                    chunk_text,
                    chunk_start,
                    chunk_end,
                )
            )

            # ------------------------------------------------
            # Add paragraph-level overlap.
            # ------------------------------------------------

            overlap_paragraphs = []
            overlap_count = 0

            for p in reversed(current_paragraphs):

                p_tokens = _estimate_tokens(p[0])

                if (
                    overlap_paragraphs
                    and overlap_count + p_tokens > overlap_tokens
                ):
                    break

                overlap_paragraphs.append(p)
                overlap_count += p_tokens

                if overlap_count >= overlap_tokens:
                    break

            overlap_paragraphs.reverse()

            # ------------------------------------------------
            # The overlap tail is best-effort: if the pending
            # paragraph still does not fit alongside it,
            # carrying the tail would re-emit the identical
            # chunk forever. Drop the tail (no overlap at this
            # boundary) so the paragraph is reconsidered
            # against an empty accumulator and always consumed.
            # ------------------------------------------------

            tail_tokens = sum(
                _estimate_tokens(p[0])
                for p in overlap_paragraphs
            )

            if tail_tokens + paragraph_tokens > target_tokens:
                current_paragraphs = []
                current_tokens = 0
            else:
                current_paragraphs = overlap_paragraphs
                current_tokens = tail_tokens

            # IMPORTANT:
            # Do not increment i here.
            # The paragraph that didn't fit needs to be
            # reconsidered for the next chunk.

            continue

        # ----------------------------------------------------
        # Add paragraph
        # ----------------------------------------------------

        current_paragraphs.append(
            (
                paragraph,
                start_page,
                end_page,
            )
        )

        current_tokens += paragraph_tokens

        i += 1

    # --------------------------------------------------------
    # Final chunk.
    #
    # NOTE: every append in the loop above consumes at least
    # one new paragraph (the overlap tail alone is never
    # re-emitted: it is either extended or dropped), so the
    # final accumulation always contains fresh content. A
    # text-equality guard here would wrongly drop legitimate
    # chunks when source paragraphs repeat verbatim (e.g. a
    # recurring equation).
    # --------------------------------------------------------

    if current_paragraphs:

        chunk_text = "\n\n".join(
            p[0]
            for p in current_paragraphs
        )

        chunk_start = current_paragraphs[0][1]
        chunk_end = current_paragraphs[-1][2]

        chunks.append(
            (
                chunk_text,
                chunk_start,
                chunk_end,
            )
        )

    return chunks


# ============================================================
# Group section items by subsection
# ============================================================

def _group_by_subsection(
    section_items: List[Dict[str, Any]],
) -> List[
    Tuple[
        Optional[str],
        List[Dict[str, Any]]
    ]
]:
    """
    Convert the sectioner's flat list into logical subsections.

    Example input:

        Participants heading
        paragraph
        paragraph
        blank
        paragraph
        Task heading
        paragraph
        paragraph

    becomes:

        [
            ("participants", [...]),
            ("task", [...])
        ]

    Text before the first subsection heading remains under
    subsection=None.
    """

    groups = []

    current_subsection: Optional[str] = None
    current_items: List[Dict[str, Any]] = []

    for item in section_items:

        if not isinstance(item, dict):
            continue

        subsection = item.get("subsection")

        # ----------------------------------------------------
        # A subsection heading starts a new group.
        # ----------------------------------------------------

        if item.get("is_heading", False):

            if current_items:
                groups.append(
                    (
                        current_subsection,
                        current_items,
                    )
                )

            current_subsection = (
                str(subsection)
                if subsection
                else None
            )

            current_items = []

            continue

        # ----------------------------------------------------
        # Normal text
        # ----------------------------------------------------

        current_items.append(item)

    # --------------------------------------------------------
    # Final group
    # --------------------------------------------------------

    if current_items:
        groups.append(
            (
                current_subsection,
                current_items,
            )
        )

    return groups


# ============================================================
# Safe ID creation
# ============================================================

def _safe_id(text: str) -> str:

    text = str(text).lower().strip()

    # Replace anything other than letters/numbers with "_"
    result = ""

    for char in text:

        if char.isalnum():
            result += char

        else:
            result += "_"

    # Collapse repeated underscores
    while "__" in result:
        result = result.replace("__", "_")

    return result.strip("_") or "section"


# ============================================================
# Main chunking function
# ============================================================

def chunk_all_sections(
    sections: Dict[str, Any],
    paper_id: str = "paper_001",
    target_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
) -> List[Chunk]:
    """
    Chunk all sections produced by split_into_sections().

    The sectioner output is expected to look like:

        {
            "methods": [
                {
                    "page": 8,
                    "text": "...",
                    "subsection": "participants",
                    "is_heading": False
                },
                ...
            ]
        }

    The chunker:

        1. Preserves major section
        2. Preserves subsection
        3. Groups lines into paragraphs
        4. Chunks paragraphs at ~1800 tokens
        5. Adds ~150-token overlap
        6. Preserves page ranges
    """

    chunks: List[Chunk] = []

    for section_name, section_data in sections.items():

        # The current sectioner produces lists of dictionaries.
        if not isinstance(section_data, list):
            continue

        subsection_groups = _group_by_subsection(
            section_data
        )

        for subsection, items in subsection_groups:

            chunk_results = _chunk_subsection(
                items,
                target_tokens=target_tokens,
                overlap_tokens=overlap_tokens,
            )

            for local_index, (
                chunk_text,
                source_start,
                source_end,
            ) in enumerate(
                chunk_results,
                start=1,
            ):

                section_id = _safe_id(
                    section_name
                )

                if subsection:

                    subsection_id = _safe_id(
                        subsection
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

                # ------------------------------------------------
                # Store page provenance as strings.
                # ------------------------------------------------

                if source_start is not None:

                    if (
                        source_end is not None
                        and source_end != source_start
                    ):
                        source_start_value = str(
                            source_start
                        )
                        source_end_value = str(
                            source_end
                        )

                    else:
                        source_start_value = str(
                            source_start
                        )
                        source_end_value = str(
                            source_end
                        )

                else:
                    source_start_value = None
                    source_end_value = None

                chunks.append(
                    Chunk(
                        paper_id=paper_id,
                        section=section_name,
                        subsection=subsection,
                        chunk_id=chunk_id,
                        text=chunk_text,
                        source_start=source_start_value,
                        source_end=source_end_value,
                    )
                )

    return chunks


# ============================================================
# Compatibility alias
# ============================================================

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