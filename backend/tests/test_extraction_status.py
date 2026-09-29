"""GET /papers/{id}/extraction-status: truthful latest-attempt state.

Read-only over existing tables (paper_chunks + chunk_extractions); the
endpoint never runs extraction. Covers: not_run / complete / partial /
failed, newest-version rows winning over older ones, stale chunk ids
being ignored, and 404 for unknown papers.
"""
import pytest
from fastapi.testclient import TestClient

from backend.app import store
from backend.app.database import connect


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    monkeypatch.setenv("LIT_REVIEW_DB", str(db))
    from backend.app.database import init_db
    from backend.app.main import app
    init_db(db)
    return TestClient(app)


def _seed(chunks):
    proj = store.create_project("P")
    paper = store.create_paper(proj["id"], {"title": "T"})
    conn = connect()
    try:
        for cid in chunks:
            conn.execute(
                """INSERT INTO paper_chunks (id, paper_id, chunk_id, section,
                   subsection, text, source_start, source_end, token_estimate,
                   char_count, text_hash, created_at)
                   VALUES (?, ?, ?, 'methods', '', 'text', '', '', 10, 100,
                           'h', 't')""",
                (f"{paper['id']}:{cid}", paper["id"], cid))
        conn.commit()
    finally:
        conn.close()
    return paper["id"]


def _attempt(pid, cid, status, error="", model="m", prompt="1.0",
             schema="1.0"):
    store.record_chunk_extraction(pid, cid, status, error, model, prompt,
                                  schema)


def _get(client, pid):
    r = client.get(f"/api/papers/{pid}/extraction-status")
    assert r.status_code == 200, r.text
    return r.json()


def test_not_run_without_attempts(client):
    pid = _seed(["a_001", "b_002"])
    s = _get(client, pid)
    assert s["run"] == "not_run"
    assert s["chunks_total"] == 2
    assert s["succeeded"] == s["failed"] == 0
    assert s["not_attempted"] == 2
    assert s["error"] == ""


def test_complete_when_every_chunk_succeeded(client):
    pid = _seed(["a_001", "b_002"])
    _attempt(pid, "a_001", "success")
    _attempt(pid, "b_002", "success")
    s = _get(client, pid)
    assert s["run"] == "complete"
    assert (s["succeeded"], s["failed"], s["not_attempted"]) == (2, 0, 0)


def test_partial_with_failures(client):
    pid = _seed(["a_001", "b_002", "c_003"])
    _attempt(pid, "a_001", "success")
    _attempt(pid, "b_002", "success")
    _attempt(pid, "c_003", "failed", error="json: bad delimiter")
    s = _get(client, pid)
    assert s["run"] == "partial"
    assert (s["succeeded"], s["failed"], s["not_attempted"]) == (2, 1, 0)
    assert s["error"] == "json: bad delimiter"


def test_partial_when_some_chunks_never_attempted(client):
    pid = _seed(["a_001", "b_002"])
    _attempt(pid, "a_001", "success")
    s = _get(client, pid)
    assert s["run"] == "partial"
    assert s["not_attempted"] == 1


def test_failed_when_all_attempted_chunks_failed(client):
    pid = _seed(["a_001", "b_002"])
    _attempt(pid, "a_001", "failed", error="schema: missing schema_version")
    _attempt(pid, "b_002", "failed", error="json: output is not JSON")
    s = _get(client, pid)
    assert s["run"] == "failed"
    assert (s["succeeded"], s["failed"]) == (0, 2)
    assert s["error"] in {"schema: missing schema_version",
                          "json: output is not JSON"}


def test_latest_version_row_wins(client):
    # An older prompt version failed; the newer run succeeded. Only the
    # newest row per chunk counts toward the run state.
    pid = _seed(["a_001"])
    _attempt(pid, "a_001", "failed", error="old failure", prompt="1.3")
    _attempt(pid, "a_001", "success", prompt="1.4")
    s = _get(client, pid)
    assert s["run"] == "complete"
    assert (s["succeeded"], s["failed"]) == (1, 0)


def test_stale_chunk_ids_ignored(client):
    # Rows for chunks that no longer exist (pre-re-chunking) don't count:
    # the stale failure stays invisible and only current chunks matter.
    pid = _seed(["a_001", "b_002"])
    _attempt(pid, "a_001", "success")
    _attempt(pid, "gone_009", "failed", error="stale failure")
    s = _get(client, pid)
    assert s["run"] == "partial"      # b_002 never attempted; gone_009 invisible
    assert (s["succeeded"], s["failed"], s["not_attempted"]) == (1, 0, 1)
    assert s["error"] == ""           # the stale failure message must not surface


def test_unknown_paper_404(client):
    r = client.get("/api/papers/paper_none/extraction-status")
    assert r.status_code == 404
