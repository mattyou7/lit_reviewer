from dataclasses import dataclass
from typing import Optional


@dataclass
class Chunk:
    paper_id: str
    section: str
    chunk_id: str
    text: str
    subsection: Optional[str] = None
    source_start: Optional[str] = None
    source_end: Optional[str] = None