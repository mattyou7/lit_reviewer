"""Knowledge/discovery endpoints: metadata, references, citations,
embeddings, similarity, landscape data. Follows existing conventions."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException

from .. import discovery, embeddings, landscape, metadata, references, store
from ..schemas import (
    Citations,
    DiscoverRequest,
    EmbeddingStats,
    EmbeddingStatus,
    EmbedRequest,
    Landscape,
    LandscapeStatus,
    PaperMetadata,
    ProjectSimilarity,
    Reference,
    ReferenceStats,
    SimilarityPair,
)

router = APIRouter()


def _paper_or_404(paper_id: str) -> dict:
    paper = store.get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")
    return paper


@router.get("/papers/{paper_id}/metadata", response_model=PaperMetadata)
def get_metadata(paper_id: str):
    _paper_or_404(paper_id)
    return metadata.get_metadata(paper_id)


@router.post("/papers/{paper_id}/metadata")
def run_metadata(paper_id: str):
    paper = _paper_or_404(paper_id)
    if not paper.get("source_pdf_path"):
        raise HTTPException(status_code=422, detail="no stored PDF")
    from ..pipeline import resolve_pdf_path
    pdf = resolve_pdf_path(paper["source_pdf_path"])
    if not pdf.exists():
        raise HTTPException(status_code=422, detail="stored PDF missing")
    from src.pdf.extract import extract_pdf
    pages = extract_pdf(str(pdf))
    page_texts = [p.get("text", "") for p in pages]
    ref_pages = set()
    for sec in store.list_sections(paper_id):
        if sec["name"] == "references":
            ref_pages.update(it.get("page") for it in sec["items"]
                             if it.get("page"))
    mining = metadata.mining_texts(page_texts, ref_pages)
    return metadata.run_paper_metadata(paper_id, pdf,
                                       full_text="\n".join(mining),
                                       page_texts=mining)


@router.get("/papers/{paper_id}/references",
            response_model=list[Reference])
def get_references(paper_id: str):
    _paper_or_404(paper_id)
    return references.list_references(paper_id)


@router.post("/papers/{paper_id}/references", response_model=ReferenceStats)
def run_references(paper_id: str):
    _paper_or_404(paper_id)
    return references.run_paper_references(paper_id)


@router.get("/papers/{paper_id}/citations", response_model=Citations)
def get_citations(paper_id: str):
    _paper_or_404(paper_id)
    return references.list_citations(paper_id)


@router.post("/papers/{paper_id}/embeddings",
             response_model=EmbeddingStats)
def run_embedding(paper_id: str, payload: Optional[EmbedRequest] = None):
    _paper_or_404(paper_id)
    req = payload or EmbedRequest()
    try:
        return embeddings.run_paper_embedding(paper_id, force=req.force)
    except KeyError:
        raise HTTPException(status_code=404, detail="paper not found")


@router.get("/papers/{paper_id}/embedding-status",
            response_model=EmbeddingStatus)
def get_embedding_status(paper_id: str):
    _paper_or_404(paper_id)
    return landscape.embedding_status(paper_id)


@router.get("/papers/{paper_id}/similarity",
            response_model=list[SimilarityPair])
def get_paper_similarity(paper_id: str):
    _paper_or_404(paper_id)
    return landscape.list_paper_similarity(paper_id)


@router.post("/projects/{project_id}/embeddings")
def run_project_embeddings(project_id: str,
                           payload: Optional[EmbedRequest] = None):
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    req = payload or EmbedRequest()
    results = []
    for p in store.list_papers(project_id):
        try:
            results.append(embeddings.run_paper_embedding(p["id"],
                                                          force=req.force))
        except KeyError:
            continue
    return {"project_id": project_id, "papers": results}


@router.get("/projects/{project_id}/similarity",
            response_model=ProjectSimilarity)
def get_project_similarity(project_id: str):
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        return landscape.compute_project_similarity(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="project not found")


@router.get("/landscape/{project_id}", response_model=Landscape)
def get_landscape(project_id: str):
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        return landscape.build_landscape(project_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="project not found")


@router.get("/projects/{project_id}/landscape/status",
            response_model=LandscapeStatus)
def get_landscape_status(project_id: str):
    """Truthful state of the automatic landscape build: idle, running +
    current step, or complete/error with per-channel outcomes."""
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    return discovery.get_status(project_id)


@router.post("/projects/{project_id}/discover",
             response_model=LandscapeStatus)
def post_discover(project_id: str, background_tasks: BackgroundTasks,
                  payload: Optional[DiscoverRequest] = None):
    """(Re-)run the automatic first-degree build for a seed paper.
    The automatic trigger already fires when a PDF enters the project;
    this endpoint exists for explicit retry after a surfaced error."""
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    req = payload or DiscoverRequest()
    seed_id = req.seed_paper_id
    if not seed_id:
        seed_id = discovery.get_status(project_id)["seed_paper_id"]
    if not seed_id:
        with_pdf = [p for p in store.list_papers(project_id)
                    if p.get("source_pdf_path")]
        if not with_pdf:
            raise HTTPException(
                status_code=422,
                detail="no seed paper (upload a PDF first)")
        seed_id = with_pdf[-1]["id"]
    seed = store.get_paper(seed_id)
    if seed is None or seed["project_id"] != project_id:
        raise HTTPException(status_code=404, detail="paper not found")
    discovery.log_auto(f"triggered project_id={project_id} "
                       f"seed_paper_id={seed_id}")
    discovery.start_run(project_id, seed_id)
    background_tasks.add_task(discovery.run_build, project_id, seed_id)
    return discovery.get_status(project_id)
