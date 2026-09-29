"""Contextual-tutor tests. The model is faked; no Qwen weights needed.

Covers: paper association (404 + echo), verbatim selection, bounded
context with explicit roles in the prompt, evidence-pointer ownership,
the INSUFFICIENT CONTEXT sentinel, model-unavailable/error surfacing,
empty output, and no persistence / no whole-paper prompts.
"""
import pytest
from fastapi.testclient import TestClient

from backend.app import extraction as ext_orch
from backend.app import store
from backend.app.database import connect
from src.teacher.backend import ModelUnavailable, TeacherBackend
from src.teacher.prompt import TUTOR_SYSTEM_PROMPT


class FakeTutorBackend(TeacherBackend):
    name = "fake-tutor"

    def __init__(self, response="The selection describes a drift-diffusion"
                                " model fitted per session."):
        self.response = response
        self.calls: list[dict] = []

    def extract(self, prompt: str, system=None) -> str:
        self.calls.append({"prompt": prompt, "system": system})
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    monkeypatch.setenv("LIT_REVIEW_DB", str(db))
    from backend.app.database import init_db
    from backend.app.main import app
    init_db(db)
    ext_orch.set_backend(None)
    yield TestClient(app)
    ext_orch.set_backend(None)


def _seed_paper(title="Real Paper", chunks=()):
    proj = store.create_project("P")
    paper = store.create_paper(proj["id"], {"title": title})
    conn = connect()
    try:
        for i, text in enumerate(chunks):
            conn.execute(
                "INSERT INTO paper_chunks (id, paper_id, chunk_id, section,"
                " subsection, text, source_start, source_end, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-01-01')",
                (f"ch_{i}", paper["id"], f"chunk_{i:03d}", "methods",
                 "statistics", text, "3", "3"))
        conn.commit()
    finally:
        conn.close()
    return paper


def _seed_evidence(paper_id, chunk_id="chunk_000"):
    ev_id = f"{paper_id}:{chunk_id}:methods:001"
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO paper_evidence (id, paper_id, chunk_id, category,"
            " text, section, subsection, page_start, page_end, created_at)"
            " VALUES (?, ?, ?, 'methods', 'Two-sided permutation test',"
            " 'methods', 'statistics', 5, 5, '2026-01-01')",
            (ev_id, paper_id, chunk_id))
        conn.commit()
    finally:
        conn.close()
    return ev_id


def _ask(client, payload):
    return client.post("/api/tutor/explain", json=payload)


def test_unknown_paper_404_and_model_never_called(client):
    fake = FakeTutorBackend()
    ext_orch.set_backend(fake)
    r = _ask(client, {"paper_id": "paper_missing", "text": "selection"})
    assert r.status_code == 404
    assert fake.calls == []


def test_whitespace_selection_422_with_helpful_detail(client):
    paper = _seed_paper()
    fake = FakeTutorBackend()
    ext_orch.set_backend(fake)
    r = _ask(client, {"paper_id": paper["id"], "text": "   \n  "})
    assert r.status_code == 422
    assert "select text" in r.json()["detail"]
    assert fake.calls == []


def test_ok_echoes_paper_and_returns_explanation(client):
    paper = _seed_paper()
    fake = FakeTutorBackend("Because the rate constant k sets the scale.")
    ext_orch.set_backend(fake)
    r = _ask(client, {"paper_id": paper["id"], "text": "rate constant k"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["paper_id"] == paper["id"]
    assert body["explanation"] == "Because the rate constant k sets the scale."
    assert body["model"]
    assert body["duration_seconds"] >= 0
    assert body["error"] == ""


def test_prompt_carries_selection_verbatim_roles_and_system(client):
    paper = _seed_paper()
    fake = FakeTutorBackend()
    ext_orch.set_backend(fake)
    equation = "The drift term mu obeys mu = mu0 * exp(-t/tau) exactly."
    r = _ask(client, {"paper_id": paper["id"], "text": equation,
                      "context": "Surrounding sentence about the fit.",
                      "section": "results", "subsection": "drift",
                      "page": 7})
    assert r.status_code == 200
    call = fake.calls[0]
    prompt = call["prompt"]
    assert equation in prompt                     # verbatim, unmodified
    assert f"title: {paper['title']}" in prompt   # paper association
    assert "section: results" in prompt
    assert "subsection: drift" in prompt
    assert "page: 7" in prompt
    assert "Surrounding sentence about the fit." in prompt
    assert "SURROUNDING CONTEXT" in prompt
    assert "secondary background only" in prompt  # role is explicit
    assert call["system"] == TUTOR_SYSTEM_PROMPT


def test_selection_and_context_are_bounded_not_whole_paper(client):
    paper = _seed_paper(chunks=("A first stored chunk about ANOVA results.",
                                "A second stored chunk about bootstrap"
                                " resampling details."))
    fake = FakeTutorBackend()
    ext_orch.set_backend(fake)
    long_sel = "s" * 7000 + "TAIL_NEVER_SENTINEL"
    long_ctx = "c" * 3000 + "CTX_TAIL_NEVER_SENTINEL"
    r = _ask(client, {"paper_id": paper["id"], "text": long_sel,
                      "context": long_ctx})
    assert r.status_code == 200
    body = r.json()
    assert body["truncated"] is True
    prompt = fake.calls[0]["prompt"]
    assert "[truncated for length]" in prompt
    assert "TAIL_NEVER_SENTINEL" not in prompt
    assert "CTX_TAIL_NEVER_SENTINEL" not in prompt
    assert len(prompt) < 10000
    # The whole paper is never sent: stored chunks not part of the
    # selection/context stay out of the prompt entirely.
    assert "A second stored chunk" not in prompt


def test_insufficient_sentinel_becomes_status(client):
    paper = _seed_paper()
    fake = FakeTutorBackend("INSUFFICIENT CONTEXT: the selection is only a"
                            " figure caption and states no mechanism.")
    ext_orch.set_backend(fake)
    r = _ask(client, {"paper_id": paper["id"], "text": "Fig. 3 here."})
    body = r.json()
    assert body["status"] == "insufficient"
    assert not body["explanation"].upper().startswith("INSUFFICIENT")
    assert "figure caption" in body["explanation"]


def test_model_unavailable_is_surfaced_verbatim(client):
    paper = _seed_paper()
    ext_orch.set_backend(
        FakeTutorBackend(ModelUnavailable("mlx-lm not installed: no module")))
    r = _ask(client, {"paper_id": paper["id"], "text": "selection"})
    body = r.json()
    assert body["status"] == "unavailable"
    assert "mlx-lm not installed" in body["error"]
    assert body["explanation"] == ""


def test_generation_error_is_surfaced(client):
    paper = _seed_paper()
    ext_orch.set_backend(FakeTutorBackend(RuntimeError("metal lock jammed")))
    r = _ask(client, {"paper_id": paper["id"], "text": "selection"})
    body = r.json()
    assert body["status"] == "error"
    assert "metal lock jammed" in body["error"]


def test_empty_model_output_is_an_error_not_filler(client):
    paper = _seed_paper()
    ext_orch.set_backend(FakeTutorBackend("   "))
    r = _ask(client, {"paper_id": paper["id"], "text": "selection"})
    body = r.json()
    assert body["status"] == "error"
    assert "empty explanation" in body["error"]


def test_evidence_pointer_ownership_is_enforced(client):
    paper_a = _seed_paper(title="Paper A")
    paper_b = _seed_paper(title="Paper B")
    ev_b = _seed_evidence(paper_b["id"])
    fake = FakeTutorBackend()
    ext_orch.set_backend(fake)

    # Evidence from another paper must never be attached to paper A.
    r = _ask(client, {"paper_id": paper_a["id"], "text": "selection",
                      "evidence_id": ev_b})
    assert r.status_code == 404

    r = _ask(client, {"paper_id": paper_a["id"], "text": "selection",
                      "evidence_id": "paper_x:chunk:method:001"})
    assert r.status_code == 404
    assert fake.calls == []          # rejected before any model call

    ev_a = _seed_evidence(paper_a["id"])
    r = _ask(client, {"paper_id": paper_a["id"], "text": "selection",
                      "evidence_id": ev_a})
    assert r.status_code == 200
    body = r.json()
    assert body["evidence_id"] == ev_a
    prompt = fake.calls[0]["prompt"]
    assert "EXTRACTED EVIDENCE" in prompt
    assert ev_a in prompt
    assert "Two-sided" not in prompt     # pointer is metadata, not re-sent


def test_no_persistence_after_explain(client):
    paper = _seed_paper(chunks=("chunk text",))
    ext_orch.set_backend(FakeTutorBackend())
    r = _ask(client, {"paper_id": paper["id"], "text": "chunk text",
                      "section": "methods", "page": 3})
    assert r.status_code == 200
    conn = connect()
    try:
        for table in ("paper_evidence", "chunk_extractions",
                      "paper_syntheses", "searches"):
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            assert n == 0, f"{table} gained rows — tutor must persist nothing"
    finally:
        conn.close()
