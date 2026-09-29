"""Contextual tutor endpoint (beta): explain a selected passage from the
paper the researcher is currently reading.

Single general explanation mode. The request carries the paper id, the
verbatim selection, bounded surrounding context, and location metadata.
Nothing is persisted and nothing is ever triggered automatically.
Follows extract.py conventions."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import store, tutor
from ..schemas import TutorRequest, TutorResponse

router = APIRouter()


@router.post("/tutor/explain", response_model=TutorResponse)
def explain(payload: TutorRequest):
    paper = store.get_paper(payload.paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")
    if not payload.text.strip():
        raise HTTPException(status_code=422,
                            detail="selected text is empty — select text"
                                   " from the paper to learn about it")
    evidence = None
    if payload.evidence_id:
        evidence = store.get_evidence(payload.evidence_id)
        if evidence is None or evidence.get("paper_id") != payload.paper_id:
            raise HTTPException(status_code=404, detail="evidence not found")
    return tutor.run_explain(
        paper=paper, text=payload.text, context=payload.context,
        section=payload.section, subsection=payload.subsection,
        page=payload.page, evidence=evidence)
