"""Paper-synthesis endpoints. Follows extract.py conventions."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

from .. import store, synthesis
from ..schemas import PaperSynthesis, SynthesisStats, SynthesizeRequest
from src.teacher.prompt import (
    SYNTHESIS_PROMPT_VERSION,
    SYNTHESIS_SCHEMA_VERSION,
)
from src.teacher.backend import load_teacher_config

router = APIRouter()


def _paper_or_404(paper_id: str) -> dict:
    paper = store.get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")
    return paper


def _current_model() -> str:
    try:
        return load_teacher_config()["model"]
    except Exception:
        return "Qwen/Qwen3-1.7B-MLX-8bit"


@router.post("/papers/{paper_id}/synthesize", response_model=SynthesisStats)
def synthesize_paper(paper_id: str,
                     payload: Optional[SynthesizeRequest] = None):
    _paper_or_404(paper_id)
    req = payload or SynthesizeRequest()
    try:
        return synthesis.run_paper_synthesis(paper_id, force=req.force)
    except KeyError:
        raise HTTPException(status_code=404, detail="paper not found")


@router.get("/papers/{paper_id}/synthesis", response_model=PaperSynthesis)
def get_synthesis(paper_id: str):
    _paper_or_404(paper_id)
    row = store.get_synthesis(paper_id, _current_model(),
                              SYNTHESIS_PROMPT_VERSION,
                              SYNTHESIS_SCHEMA_VERSION)
    if row is None:
        raise HTTPException(status_code=404,
                            detail="no synthesis for this paper")
    return row
