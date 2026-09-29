"""External discovery endpoints: PubMed/arXiv search, explicit
import, search history. Retrieval only — no ranking, no recommendations."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import search, store
from ..schemas import (
    ImportRequest,
    ImportResponse,
    SearchHistoryItem,
    SearchRequest,
    SearchResponse,
)
from src.search.common import SearchError

router = APIRouter()


def _run(source: str, project_id: str, payload: SearchRequest):
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        return search.run_search(project_id, source, payload.query,
                                 payload.max_results, payload.year_min,
                                 payload.year_max)
    except SearchError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except KeyError:
        raise HTTPException(status_code=404, detail="project not found")


@router.post("/projects/{project_id}/search/pubmed",
             response_model=SearchResponse)
def search_pubmed(project_id: str, payload: SearchRequest):
    return _run("pubmed", project_id, payload)


@router.post("/projects/{project_id}/search/arxiv",
             response_model=SearchResponse)
def search_arxiv(project_id: str, payload: SearchRequest):
    return _run("arxiv", project_id, payload)


@router.get("/projects/{project_id}/searches",
            response_model=list[SearchHistoryItem])
def search_history(project_id: str):
    try:
        return search.list_searches(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="project not found")


@router.get("/search/{search_id}", response_model=SearchResponse)
def get_search(search_id: str):
    result = search.get_search(search_id)
    if result is None:
        raise HTTPException(status_code=404, detail="search not found")
    return result


@router.post("/search/import", response_model=ImportResponse)
def import_search_result(payload: ImportRequest):
    try:
        return search.import_result(payload.project_id, payload.search_id,
                                    payload.external_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/papers/{paper_id}/discovery")
def get_discovery(paper_id: str):
    paper = store.get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")
    return {"paper_id": paper_id,
            "discovery": search.discovery_items(
                paper_id, paper.get("discovery_source_type", ""))}
