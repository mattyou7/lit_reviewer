"""Teacher-extraction endpoints. Follows ingest.py conventions."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from .. import extraction, store
from ..schemas import (EvidenceItem, ExtractionRunStatus, ExtractionStats,
                       ExtractRequest)

router = APIRouter()


def _paper_or_404(paper_id: str) -> dict:
    paper = store.get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")
    return paper


@router.post("/papers/{paper_id}/extract", response_model=ExtractionStats)
def extract_paper(paper_id: str, payload: Optional[ExtractRequest] = None):
    _paper_or_404(paper_id)
    req = payload or ExtractRequest()
    try:
        return extraction.run_paper_extraction(
            paper_id, force=req.force, limit=req.limit,
            chunk_ids=req.chunk_ids)
    except KeyError:
        raise HTTPException(status_code=404, detail="paper not found")


@router.get("/papers/{paper_id}/evidence", response_model=list[EvidenceItem])
def get_evidence(paper_id: str,
                 section: Optional[str] = Query(default=None),
                 subsection: Optional[str] = Query(default=None),
                 category: Optional[str] = Query(default=None)):
    _paper_or_404(paper_id)
    return store.list_evidence(paper_id, section=section,
                               subsection=subsection, category=category)


@router.get("/papers/{paper_id}/extraction-status",
            response_model=ExtractionRunStatus)
def get_extraction_status(paper_id: str):
    """Read-only latest-attempt state per current chunk (never runs
    extraction): distinguishes not_run from complete/partial/failed."""
    _paper_or_404(paper_id)
    return store.extraction_run_status(paper_id)
