from dataclasses import dataclass, asdict
from typing import Optional

@dataclass
class Chunk:
    paper_id: str
    section: str
    chunk_id: str
    text: str
    source_start: Optional[str] = None
    source_end: Optional[str] = None

    def to_dict(self):
        return asdict(self)
