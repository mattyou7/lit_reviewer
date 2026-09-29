"""FastAPI entrypoint. Phase 1: projects + paper metadata only."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import init_db
from .routers import extract, health, ingest, knowledge, papers, projects, search, synthesize, tutor


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Lit Review Assistant API", version="0.1.0", lifespan=lifespan)

# Local-first desktop app: the Vite frontend runs on a different port.
# Permissive CORS is acceptable here because the API binds to loopback
# and holds no credentials or multi-user data.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(papers.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(extract.router, prefix="/api")
app.include_router(synthesize.router, prefix="/api")
app.include_router(knowledge.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(tutor.router, prefix="/api")
