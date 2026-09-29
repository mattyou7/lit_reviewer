from dataclasses import dataclass
from typing import Optional


@dataclass
class Chunk:
    paper_id: str
    section: str
    chunk_id: str
    text: str

    # Scientific subsection, when available.
    subsection: Optional[str] = None

    # Source location.
    source_start: Optional[str] = None
    source_end: Optional[str] = None