from typing import Dict, List

from .schema import Chunk
from .sectioner import section_text


DEFAULT_CHUNK_SIZE = 5000
DEFAULT_OVERLAP = 500


def chunk_section(
    paper_id: str,
    section: str,
    lines: List[Dict],
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_OVERLAP,
) -> List[Chunk]:

    text = section_text(lines)

    if not text.strip():
        return []

    chunks = []
    start = 0
    chunk_number = 1

    while start < len(text):
        end = min(start + chunk_size, len(text))

        # Prefer ending at a paragraph boundary.
        if end < len(text):
            boundary = text.rfind("\n\n", start, end)
            if boundary > start:
                end = boundary

        chunk_text = text[start:end].strip()

        if chunk_text:
            chunks.append(
                Chunk(
                    paper_id=paper_id,
                    section=section,
                    chunk_id=f"{section}_{chunk_number:03d}",
                    text=chunk_text,
                )
            )

        if end >= len(text):
            break

        start = max(end - overlap, start + 1)
        chunk_number += 1

    return chunks


def chunk_all_sections(
    paper_id: str,
    sections: Dict[str, List[Dict]],
) -> List[Chunk]:

    all_chunks = []

    for section, lines in sections.items():
        all_chunks.extend(
            chunk_section(
                paper_id=paper_id,
                section=section,
                lines=lines,
            )
        )

    return all_chunks