from fastapi import APIRouter, HTTPException

from .. import store
from ..schemas import Project, ProjectCreate

router = APIRouter()


@router.post("/projects", response_model=Project, status_code=201)
def create_project(payload: ProjectCreate):
    return store.create_project(payload.name, payload.description)


@router.get("/projects", response_model=list[Project])
def get_projects():
    return store.list_projects()


@router.get("/projects/{project_id}", response_model=Project)
def get_project(project_id: str):
    proj = store.get_project(project_id)
    if proj is None:
        raise HTTPException(status_code=404, detail="project not found")
    return proj
