"""Shared search types. No network, no ranking, no LLM."""
from __future__ import annotations

from dataclasses import dataclass, field


class SearchError(Exception):
    """Explicit, testable search failure (network, malformed, timeout)."""


@dataclass
class SearchResult:
    external_id: str
    source: str  # "pubmed" | "arxiv"
    pmid: str = ""
    doi: str = ""
    arxiv_id: str = ""
    title: str = ""
    authors: list[str] = field(default_factory=list)
    journal: str = ""
    year: int | None = None
    abstract: str = ""
    pdf_url: str = ""
    # Publication types as reported by the source (PubMed esummary
    # "pubtype"); empty when the source provides none. Never inferred.
    pub_types: list[str] = field(default_factory=list)

    def discovery(self, query: str) -> dict:
        return {"type": f"{self.source}_query", "query": query}

    def to_row(self) -> dict:
        return {
            "external_id": self.external_id,
            "source": self.source,
            "pmid": self.pmid,
            "doi": self.doi,
            "arxiv_id": self.arxiv_id,
            "title": self.title,
            "authors": list(self.authors),
            "journal": self.journal,
            "year": self.year,
            "abstract": self.abstract,
            "pdf_url": self.pdf_url,
            "pub_types": list(self.pub_types),
        }
