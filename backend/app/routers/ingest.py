"""PDF upload + processing endpoints. Failures are visible, never silent."""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile

from .. import discovery, pipeline, store
from ..schemas import PaperChunk, PaperSection, ProcessingStatus

router = APIRouter()

MAX_PDF_BYTES = 100 * 1024 * 1024


def _paper_or_404(paper_id: str) -> dict:
    paper = store.get_paper(paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="paper not found")
    return paper


def _validate_upload(file: UploadFile) -> None:
    """Reject a bad upload *before* any paper row exists, so a failed
    upload cannot leave an orphaned (ghost) paper in the library."""
    name = (file.filename or "").lower()
    if not name.endswith(".pdf"):
        raise HTTPException(status_code=422, detail="only .pdf uploads supported")
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 100MB")


@router.post("/projects/{project_id}/papers/upload")
def upload_paper(project_id: str, file: UploadFile,
                 background_tasks: BackgroundTasks):
    if store.get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="project not found")
    _validate_upload(file)
    paper = store.create_paper(project_id, {"discovery_source_type": "user_import"})
    result = _attach_pdf(paper["id"], file)
    from .. import search as _search  # service module, not routers.search
    _search.record_discovery(paper["id"], "user_import")
    # Automatic landscape build: runs after this response is sent
    # (first-degree discovery around this seed; no manual embed/import
    # needed). The UI watches /landscape/status for truthful states.
    discovery.schedule_build(background_tasks, project_id, paper["id"])
    return {**store.get_paper(paper["id"]), **result}


@router.post("/papers/{paper_id}/pdf")
def attach_pdf(paper_id: str, file: UploadFile,
               background_tasks: BackgroundTasks):
    """Attach a PDF to an existing (e.g. metadata-only) paper and run
    the standard ingestion pipeline. Prior evidence/extractions are
    preserved; only the PDF-derived stages run. The attached PDF makes
    this paper a seed: the automatic landscape build is scheduled."""
    paper = _paper_or_404(paper_id)
    _attach_pdf(paper["id"], file)
    discovery.schedule_build(background_tasks, paper["project_id"],
                             paper["id"])
    return store.get_paper(paper["id"])


def _attach_pdf(paper_id: str, file: UploadFile) -> dict:
    name = (file.filename or "").lower()
    if not name.endswith(".pdf"):
        raise HTTPException(status_code=422, detail="only .pdf uploads supported")
    # Stream to temp first so the original is never partially written.
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        total = 0
        while True:
            data = file.file.read(1024 * 1024)
            if not data:
                break
            total += len(data)
            if total > MAX_PDF_BYTES:
                raise HTTPException(status_code=413, detail="PDF exceeds 100MB")
            tmp.write(data)
        tmp_path = Path(tmp.name)
    try:
        dest = pipeline.store_original_pdf(paper_id, tmp_path, name)
        result = pipeline.ingest_pdf(paper_id, dest)
    finally:
        tmp_path.unlink(missing_ok=True)
    return result


@router.post("/papers/{paper_id}/process")
def process_paper(paper_id: str):
    paper = _paper_or_404(paper_id)
    if not paper.get("source_pdf_path"):
        raise HTTPException(status_code=422, detail="no stored PDF to process")
    pdf = pipeline.resolve_pdf_path(paper["source_pdf_path"])
    if not pdf.exists():
        raise HTTPException(status_code=422, detail="stored PDF missing")
    return pipeline.ingest_pdf(paper_id, pdf)


@router.get("/papers/{paper_id}/processing-status",
            response_model=ProcessingStatus)
def processing_status(paper_id: str):
    paper = _paper_or_404(paper_id)
    return {"paper_id": paper_id,
            "extraction_status": paper["extraction_status"],
            "parsing_warnings": paper["parsing_warnings"],
            "source_pdf_path": paper["source_pdf_path"]}


@router.get("/papers/{paper_id}/sections", response_model=list[PaperSection])
def get_sections(paper_id: str):
    _paper_or_404(paper_id)
    return store.list_sections(paper_id)


@router.get("/papers/{paper_id}/chunks", response_model=list[PaperChunk])
def get_chunks(paper_id: str):
    _paper_or_404(paper_id)
    return store.list_chunks(paper_id)
