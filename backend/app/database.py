"""SQLite connection + schema management (stdlib sqlite3, no ORM)."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

# Default DB location: <repo>/data/lit_review.db (overridable for tests).
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DB_PATH = REPO_ROOT / "data" / "lit_review.db"


def get_db_path() -> Path:
    return Path(os.environ.get("LIT_REVIEW_DB", str(DEFAULT_DB_PATH)))


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'UNSET',
    authors_json TEXT NOT NULL DEFAULT '[]',
    journal TEXT DEFAULT '',
    year INTEGER,
    doi TEXT DEFAULT '',
    pmid TEXT DEFAULT '',
    arxiv_id TEXT DEFAULT '',
    abstract TEXT DEFAULT '',
    source_pdf_path TEXT DEFAULT '',
    discovery_source_type TEXT NOT NULL DEFAULT 'direct_import',
    source_paper_id TEXT DEFAULT '',
    query_id TEXT DEFAULT '',
    extraction_status TEXT NOT NULL DEFAULT 'pending',
    parsing_warnings_json TEXT NOT NULL DEFAULT '[]',
    in_project INTEGER NOT NULL DEFAULT 1,
    pdf_url TEXT NOT NULL DEFAULT '',
    pub_types_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_sections (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    items_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_chunks (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    section TEXT NOT NULL,
    subsection TEXT DEFAULT '',
    text TEXT NOT NULL,
    source_start TEXT DEFAULT '',
    source_end TEXT DEFAULT '',
    token_estimate INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0,
    text_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paper_evidence (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    subsection TEXT DEFAULT '',
    page_start INTEGER,
    page_end INTEGER,
    location_status TEXT NOT NULL DEFAULT 'known',
    status TEXT NOT NULL DEFAULT 'explicit',
    schema_version TEXT NOT NULL DEFAULT '1.0',
    model_name TEXT NOT NULL DEFAULT '',
    prompt_version TEXT NOT NULL DEFAULT '1.0',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunk_extractions (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    prompt_version TEXT NOT NULL DEFAULT '1.0',
    schema_version TEXT NOT NULL DEFAULT '1.0',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    failure_type TEXT NOT NULL DEFAULT '',
    raw_output TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (paper_id, chunk_id, model_name, prompt_version, schema_version)
);

CREATE TABLE IF NOT EXISTS paper_syntheses (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    synthesis_json TEXT NOT NULL DEFAULT '{}',
    synthesis_status TEXT NOT NULL DEFAULT 'pending',
    error TEXT DEFAULT '',
    schema_version TEXT NOT NULL DEFAULT '1.0',
    model_name TEXT NOT NULL DEFAULT '',
    prompt_version TEXT NOT NULL DEFAULT '1.0',
    input_tokens INTEGER NOT NULL DEFAULT 0,
    model_calls INTEGER NOT NULL DEFAULT 0,
    raw_output TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (paper_id, model_name, prompt_version, schema_version)
);

CREATE TABLE IF NOT EXISTS paper_metadata (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (paper_id, field, source)
);

CREATE TABLE IF NOT EXISTS paper_references (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    ref_index INTEGER NOT NULL,
    raw_text TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    authors_json TEXT NOT NULL DEFAULT '[]',
    year INTEGER,
    journal TEXT NOT NULL DEFAULT '',
    doi TEXT NOT NULL DEFAULT '',
    pmid TEXT NOT NULL DEFAULT '',
    arxiv_id TEXT NOT NULL DEFAULT '',
    source_page INTEGER,
    resolution_status TEXT NOT NULL DEFAULT 'unresolved',
    resolved_paper_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS citation_edges (
    source_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    target_paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL DEFAULT 'cites',
    source TEXT NOT NULL DEFAULT 'reference_extraction',
    status TEXT NOT NULL DEFAULT 'resolved',
    created_at TEXT NOT NULL,
    PRIMARY KEY (source_paper_id, target_paper_id),
    CHECK (source_paper_id != target_paper_id)
);

CREATE TABLE IF NOT EXISTS paper_embeddings (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL DEFAULT '',
    embedding_version TEXT NOT NULL DEFAULT '1.0',
    source_repr TEXT NOT NULL DEFAULT '',
    source_hash TEXT NOT NULL DEFAULT '',
    dim INTEGER NOT NULL DEFAULT 0,
    vector BLOB NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (paper_id, model_name, embedding_version)
);

CREATE TABLE IF NOT EXISTS paper_similarity (
    paper_a TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    paper_b TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    similarity REAL NOT NULL,
    embedding_model TEXT NOT NULL DEFAULT '',
    embedding_version TEXT NOT NULL DEFAULT '1.0',
    created_at TEXT NOT NULL,
    PRIMARY KEY (paper_a, paper_b),
    CHECK (paper_a < paper_b)
);

CREATE TABLE IF NOT EXISTS paper_processing (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (paper_id, stage)
);

-- Latest automatic landscape build per project: truthful run state
-- (running/step/channels/error) for the UI's building states.
CREATE TABLE IF NOT EXISTS landscape_runs (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    seed_paper_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'running',
    step TEXT NOT NULL DEFAULT '',
    report_json TEXT NOT NULL DEFAULT '{}',
    error TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS searches (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    query TEXT NOT NULL,
    max_results INTEGER NOT NULL DEFAULT 20,
    result_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id TEXT NOT NULL REFERENCES searches(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL DEFAULT 0,
    external_id TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    pmid TEXT NOT NULL DEFAULT '',
    doi TEXT NOT NULL DEFAULT '',
    arxiv_id TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    authors_json TEXT NOT NULL DEFAULT '[]',
    journal TEXT NOT NULL DEFAULT '',
    year INTEGER,
    abstract TEXT NOT NULL DEFAULT '',
    pdf_url TEXT NOT NULL DEFAULT '',
    pub_types_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    UNIQUE (search_id, external_id)
);

CREATE TABLE IF NOT EXISTS paper_discovery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    query TEXT NOT NULL DEFAULT '',
    source_paper_id TEXT NOT NULL DEFAULT '',
    search_id TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
"""


def connect(db_path: Path | None = None) -> sqlite3.Connection:
    path = Path(db_path) if db_path else get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Path | None = None) -> Path:
    path = Path(db_path) if db_path else get_db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        conn.executescript(SCHEMA)
        conn.commit()
        _migrate(conn)
        conn.commit()
    finally:
        conn.close()
    return path


def _migrate(conn: sqlite3.Connection):
    """Idempotent column additions for pre-existing databases."""
    existing_tables = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    if "chunk_extractions" in existing_tables:
        cols = {r["name"] for r in
                conn.execute(
                    "PRAGMA table_info(chunk_extractions)").fetchall()}
        for name, ddl in (
            ("attempt_count", "INTEGER NOT NULL DEFAULT 0"),
            ("failure_type", "TEXT NOT NULL DEFAULT ''"),
            ("raw_output", "TEXT NOT NULL DEFAULT ''"),
        ):
            if name not in cols:
                conn.execute(
                    f"ALTER TABLE chunk_extractions ADD COLUMN {name} {ddl}")
    if "papers" in existing_tables:
        cols = {r["name"] for r in
                conn.execute("PRAGMA table_info(papers)").fetchall()}
        if "in_project" not in cols:
            conn.execute("ALTER TABLE papers ADD COLUMN in_project"
                         " INTEGER NOT NULL DEFAULT 1")
            # One-time backfill for pre-existing databases: papers created
            # by the AUTOMATIC discovery channels were never explicitly
            # added by the researcher — move them out of the project
            # collection (they stay in the Landscape). Explicit imports
            # (pubmed_query / user_import / ...) remain in the collection.
            conn.execute(
                "UPDATE papers SET in_project=0"
                " WHERE discovery_source_type IN"
                " ('citation_discovery', 'cited_by_discovery',"
                " 'semantic_discovery')")
        for name, ddl in (
            ("pdf_url", "TEXT NOT NULL DEFAULT ''"),
            ("pub_types_json", "TEXT NOT NULL DEFAULT '[]'"),
        ):
            if name not in cols:
                conn.execute(f"ALTER TABLE papers ADD COLUMN {name} {ddl}")
    if "search_results" in existing_tables:
        cols = {r["name"] for r in
                conn.execute(
                    "PRAGMA table_info(search_results)").fetchall()}
        if "pub_types_json" not in cols:
            conn.execute("ALTER TABLE search_results ADD COLUMN"
                         " pub_types_json TEXT NOT NULL DEFAULT '[]'")
    if "paper_syntheses" in existing_tables:
        cols = {r["name"] for r in
                conn.execute(
                    "PRAGMA table_info(paper_syntheses)").fetchall()}
        if "raw_output" not in cols:
            conn.execute("ALTER TABLE paper_syntheses ADD COLUMN"
                         " raw_output TEXT NOT NULL DEFAULT ''")
