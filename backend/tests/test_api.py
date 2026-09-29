import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    monkeypatch.setenv("LIT_REVIEW_DB", str(db))
    from backend.app.database import init_db
    from backend.app.main import app
    init_db(db)
    return TestClient(app)


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_project_crud(client):
    r = client.post("/api/projects", json={"name": "My Research Project"})
    assert r.status_code == 201
    pid = r.json()["id"]
    assert pid.startswith("proj_")

    r = client.get("/api/projects")
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = client.get(f"/api/projects/{pid}")
    assert r.status_code == 200
    assert r.json()["name"] == "My Research Project"

    r = client.get("/api/projects/nope")
    assert r.status_code == 404


def test_paper_metadata_roundtrip(client):
    pid = client.post("/api/projects", json={"name": "P"}).json()["id"]
    r = client.post(
        f"/api/projects/{pid}/papers",
        json={"title": "Test Paper", "authors": ["A. Uthor"],
              "year": 2024, "discovery_source_type": "direct_import"},
    )
    assert r.status_code == 201
    paper_id = r.json()["id"]
    assert paper_id.startswith("paper_")
    assert r.json()["extraction_status"] == "pending"

    r = client.get(f"/api/projects/{pid}/papers")
    assert len(r.json()) == 1

    r = client.get(f"/api/papers/{paper_id}")
    assert r.json()["title"] == "Test Paper"

    # invalid discovery source rejected, not silently accepted
    r = client.post(
        f"/api/projects/{pid}/papers",
        json={"title": "Bad", "discovery_source_type": "best_paper_ever"},
    )
    assert r.status_code == 422

    # unknown project -> 404, not fabricated
    r = client.post("/api/projects/missing/papers", json={"title": "X"})
    assert r.status_code == 404
