from fastapi import APIRouter, HTTPException

from .. import store
from ..schemas import (
    CollectionAddRequest,
    CollectionAddResponse,
    Paper,
    PaperCreate,
)

router = APIRouter()


@router.post("/projects/{project_id}/papers", response_model=Paper, status_code=201)
def add_paper(project_id: str, payload: PaperCreate):
    try:
        return store.create_paper(project_id, payload.model_dump())
    except KeyError:
        raise HTTPException(status_code=404, detail="project not found")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _paper_or_404(project_id: str, paper_id: str) -> dict:
    paper = store.get_paper(paper_id)
    if paper is None or paper["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="paper not found")
    return paper


@router.get("/projects/{project_id}/papers", response_model=list[Paper])
def get_papers(project_id: str):
    """The project COLLECTION (Library): only papers the researcher
    explicitly added. Landscape discoveries are served by
    GET /landscape/{project_id} until explicitly added."""
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return store.list_collection_papers(project_id)


@router.post("/projects/{project_id}/papers/{paper_id}/collection",
             response_model=Paper)
def add_to_collection(project_id: str, paper_id: str):
    """Explicit [Add to Project]. Idempotent: preserves provenance,
    relationships, and never duplicates the paper node."""
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    _paper_or_404(project_id, paper_id)
    return store.set_paper_in_project(paper_id, True)


@router.delete("/projects/{project_id}/papers/{paper_id}/collection",
               response_model=Paper)
def remove_from_collection(project_id: str, paper_id: str):
    """Remove project-collection membership only. The Landscape node,
    provenance, and edges are untouched (never destroyed here)."""
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    _paper_or_404(project_id, paper_id)
    return store.set_paper_in_project(paper_id, False)


@router.post("/projects/{project_id}/collection",
             response_model=CollectionAddResponse)
def bulk_add_to_collection(project_id: str, payload: CollectionAddRequest):
    """Bulk [Add to Project]: membership only, per named paper. Unknown
    or foreign ids are reported honestly in `not_found`."""
    project = store.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    added = already = 0
    not_found: list[str] = []
    for pid in payload.paper_ids:
        paper = store.get_paper(pid)
        if paper is None or paper["project_id"] != project_id:
            not_found.append(pid)
            continue
        if paper["in_project"]:
            already += 1
        else:
            store.set_paper_in_project(pid, True)
            added += 1
    return CollectionAddResponse(
        project_id=project_id, project_name=project["name"],
        added=added, already_in_project=already, not_found=not_found)


@router.get("/papers/{paper_id}", response_model=Paper)
def get_paper(paper_id: str):
    paper = store.get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")
    return paper
