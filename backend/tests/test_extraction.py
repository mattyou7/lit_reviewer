"""Teacher-extraction tests. The model is faked; no Qwen weights needed.

Covers: valid JSON, malformed JSON, schema failure, missing provenance,
invalid chunk ID, unknown/invented pages, persistence, idempotency,
partial extraction + targeted retry, evidence API filters.
"""
import json
import re

import pytest
from fastapi.testclient import TestClient

from backend.app import extraction as ext_orch
from backend.app import store
from backend.app.database import connect
from src.teacher.backend import TeacherBackend
from src.teacher.prompt import PROMPT_VERSION


class FakeBackend(TeacherBackend):
    name = "fake-test"

    def __init__(self, scripts):
        self.scripts = scripts
        self.calls: list[str] = []

    def extract(self, prompt: str) -> str:
        # Last match wins: the prompt template contains an example chunk
        # header ("ex_001"); the real chunk header comes after it.
        found = re.findall(r"chunk_id: (\S+)", prompt)
        cid = found[-1] if found else "?"
        self.calls.append(cid)
        resp = self.scripts.get(cid, '{"schema_version": "1.0"}')
        if isinstance(resp, Exception):
            raise resp
        return resp


def _item(text, cid, section="methods", sub="participants", ps=8, pe=8):
    return {"text": text, "source": {"chunk_id": cid, "section": section,
                                     "subsection": sub, "page_start": ps,
                                     "page_end": pe}}


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


def _seed_paper(chunks):
    proj = store.create_project("P")
    paper = store.create_paper(proj["id"], {"title": "T"})
    conn = connect()
    try:
        for c in chunks:
            conn.execute(
                """INSERT INTO paper_chunks (id, paper_id, chunk_id, section,
                   subsection, text, source_start, source_end, token_estimate,
                   char_count, text_hash, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 10, 100, 'h', 't')""",
                (f"{paper['id']}:{c['chunk_id']}", paper["id"],
                 c["chunk_id"], c["section"], c.get("subsection", ""),
                 c.get("text", "some chunk text with enough length"),
                 c.get("source_start", ""), c.get("source_end", "")))
        conn.commit()
    finally:
        conn.close()
    return paper["id"]


def _chunk(cid, **kw):
    d = {"chunk_id": cid, "section": "methods", "subsection": "participants",
         "source_start": "8", "source_end": "9"}
    d.update(kw)
    return d


# 1. valid teacher JSON -> persisted with provenance
def test_valid_json_persisted(client):
    pid = _seed_paper([_chunk("methods_participants_001")])
    body = json.dumps({
        "schema_version": "1.0",
        "methods": [_item("Twelve adults participated.",
                           "methods_participants_001")],
        "results": [_item("Accuracy improved.", "methods_participants_001",
                           ps=None, pe=None)],
    })
    ext_orch.set_backend(FakeBackend(
        {"methods_participants_001": body}))
    r = client.post(f"/api/papers/{pid}/extract", json={})
    assert r.status_code == 200, r.text
    stats = r.json()
    assert stats["status"] == "complete"
    assert stats["succeeded"] == 1 and stats["failed"] == 0
    assert stats["evidence_items"] == 2

    r = client.get(f"/api/papers/{pid}/evidence")
    items = r.json()
    assert len(items) == 2
    by_cat = {i["category"]: i for i in items}
    assert by_cat["methods"]["location_status"] == "known"
    assert by_cat["methods"]["page_start"] == 8
    assert by_cat["results"]["location_status"] == "SOURCE LOCATION UNKNOWN"
    assert all(i["status"] == "explicit" for i in items)
    assert all(i["chunk_id"] == "methods_participants_001" for i in items)


# 2. malformed teacher JSON -> failed, visible, nothing persisted
def test_malformed_json(client):
    pid = _seed_paper([_chunk("methods_001", subsection="")])
    ext_orch.set_backend(FakeBackend({"methods_001": "not json at all"}))
    r = client.post(f"/api/papers/{pid}/extract", json={})
    stats = r.json()
    assert stats["status"] == "error"
    assert stats["json_failures"] == 1
    assert client.get(f"/api/papers/{pid}/evidence").json() == []
    status = client.get(f"/api/papers/{pid}/processing-status").json()
    assert status["extraction_status"] == "error"
    assert any("json" in w for w in status["parsing_warnings"])


# 3. schema validation failure (unexpected field)
def test_schema_failure(client):
    pid = _seed_paper([_chunk("methods_001", subsection="")])
    ext_orch.set_backend(FakeBackend({"methods_001": json.dumps({
        "schema_version": "1.0", "research_gap": ["cure for X"]})}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["failed"] == 1 and stats["json_failures"] == 1
    assert client.get(f"/api/papers/{pid}/evidence").json() == []


# 4. missing provenance (item without source)
def test_missing_provenance(client):
    pid = _seed_paper([_chunk("methods_001", subsection="")])
    ext_orch.set_backend(FakeBackend({"methods_001": json.dumps({
        "schema_version": "1.0",
        "methods": [{"text": "something happened"}]})}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["failed"] == 1
    assert client.get(f"/api/papers/{pid}/evidence").json() == []


# 5. invalid chunk ID (model points elsewhere)
def test_invalid_chunk_id(client):
    pid = _seed_paper([_chunk("methods_001", subsection="")])
    ext_orch.set_backend(FakeBackend({"methods_001": json.dumps({
        "schema_version": "1.0",
        "methods": [_item("Claim.", "some_other_chunk",
                           section="methods", sub="", ps=None, pe=None)]})}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["failed"] == 1 and stats["provenance_failures"] == 1
    assert client.get(f"/api/papers/{pid}/evidence").json() == []


# 6a. unknown page location inherited from chunk
def test_unknown_page_location(client):
    pid = _seed_paper([_chunk("front_matter_001", section="front_matter",
                              subsection="", source_start="",
                              source_end="")])
    ext_orch.set_backend(FakeBackend({"front_matter_001": json.dumps({
        "schema_version": "1.0",
        "concepts": [_item("Attention.", "front_matter_001",
                            section="front_matter", sub="",
                            ps=None, pe=None)]})}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["status"] == "complete"
    items = client.get(f"/api/papers/{pid}/evidence").json()
    assert items[0]["location_status"] == "SOURCE LOCATION UNKNOWN"
    assert items[0]["page_start"] is None


# 6b. invented pages rejected (chunk has pages 8-9, model claims 25)
def test_invented_pages_rejected(client):
    pid = _seed_paper([_chunk("methods_001", subsection="")])
    ext_orch.set_backend(FakeBackend({"methods_001": json.dumps({
        "schema_version": "1.0",
        "methods": [_item("Claim.", "methods_001",
                           section="methods", sub="", ps=25, pe=25)]})}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["provenance_failures"] == 1
    assert client.get(f"/api/papers/{pid}/evidence").json() == []


# 8. idempotency: second run skips cache; force reprocesses without dupes
def test_idempotent_rerun(client):
    pid = _seed_paper([_chunk("methods_001", subsection="")])
    backend = FakeBackend({"methods_001": json.dumps({
        "schema_version": "1.0",
        "methods": [_item("Claim.", "methods_001",
                           section="methods", sub="",
                           ps=None, pe=None)]})})
    ext_orch.set_backend(backend)
    client.post(f"/api/papers/{pid}/extract", json={})
    assert len(backend.calls) == 1
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["skipped_cached"] == 1 and stats["succeeded"] == 0
    assert len(backend.calls) == 1
    stats = client.post(f"/api/papers/{pid}/extract",
                        json={"force": True}).json()
    assert stats["succeeded"] == 1 and len(backend.calls) == 2
    assert len(client.get(f"/api/papers/{pid}/evidence").json()) == 1


# 9. partial extraction + targeted retry of only failed chunks
def test_partial_and_targeted_retry(client):
    pid = _seed_paper([_chunk("good_001", subsection=""),
                       _chunk("bad_001", subsection="")])
    backend = FakeBackend({
        "good_001": json.dumps({
            "schema_version": "1.0",
            "methods": [_item("Good.", "good_001", section="methods",
                               sub="", ps=None, pe=None)]}),
        "bad_001": "garbage {{{",
    })
    ext_orch.set_backend(backend)
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["status"] == "partial"
    assert stats["succeeded"] == 1 and stats["failed"] == 1
    assert len(backend.calls) == 2

    backend.scripts["bad_001"] = json.dumps({
        "schema_version": "1.0",
        "results": [_item("Fixed.", "bad_001", section="methods",
                           sub="", ps=None, pe=None)]})
    stats = client.post(f"/api/papers/{pid}/extract",
                        json={"chunk_ids": ["bad_001"]}).json()
    assert stats["status"] == "complete"
    assert stats["skipped_cached"] == 0  # targeted run only saw bad_001
    assert backend.calls[-1] == "bad_001"
    assert len(client.get(f"/api/papers/{pid}/evidence").json()) == 2


# 10. evidence API filters
def test_evidence_filters(client):
    pid = _seed_paper([_chunk("methods_001", subsection=""),
                       _chunk("results_001", section="results",
                              subsection="")])
    backend = FakeBackend({
        "methods_001": json.dumps({
            "schema_version": "1.0",
            "methods": [_item("M.", "methods_001", section="methods",
                               sub="", ps=None, pe=None)]}),
        "results_001": json.dumps({
            "schema_version": "1.0",
            "results": [_item("R.", "results_001", section="results",
                               sub="", ps=None, pe=None)]}),
    })
    ext_orch.set_backend(backend)
    client.post(f"/api/papers/{pid}/extract", json={})
    assert len(client.get(f"/api/papers/{pid}/evidence").json()) == 2
    assert len(client.get(
        f"/api/papers/{pid}/evidence?category=methods").json()) == 1
    assert len(client.get(
        f"/api/papers/{pid}/evidence?section=results").json()) == 1
    assert client.get(
        f"/api/papers/{pid}/evidence?category=methods&section=results"
    ).json() == []
    r = client.get("/api/papers/missing/evidence")
    assert r.status_code == 404


# 11. bounded repair retry: near-miss JSON gets one repair attempt
def test_repair_retry(client):
    class RepairBackend(FakeBackend):
        def repair(self, previous: str, instruction=None) -> str:
            assert "{" in previous
            return json.dumps({
                "schema_version": "1.0",
                "methods": [_item("Repaired.", "methods_001",
                                   section="methods", sub="",
                                   ps=None, pe=None)]})

    pid = _seed_paper([_chunk("methods_001", subsection="")])
    backend = RepairBackend(
        {"methods_001": 'leading prose {"schema_version": broken'})
    ext_orch.set_backend(backend)
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["repair_attempts"] == 1
    assert stats["succeeded"] == 1
    assert len(client.get(f"/api/papers/{pid}/evidence").json()) == 1


# 12. pure prose (no brace) is not retried
def test_no_repair_without_brace(client):
    class RepairBackend(FakeBackend):
        def repair(self, previous: str, instruction=None) -> str:  # pragma: no cover
            raise AssertionError("repair must not be called")

    pid = _seed_paper([_chunk("methods_001", subsection="")])
    ext_orch.set_backend(RepairBackend({"methods_001": "just prose"}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["repair_attempts"] == 0
    assert stats["json_failures"] == 1


class MechanicalRepairBackend(FakeBackend):
    """Repair fake: returns a per-chunk fixed output, records instructions."""

    def __init__(self, scripts, repaired):
        super().__init__(scripts)
        self._repaired = repaired
        self.repair_calls: list = []

    def repair(self, previous: str, instruction=None) -> str:
        self.repair_calls.append(instruction or "")
        return self._repaired[self.calls[-1]]


def _valid_body(cid, **kw):
    d = {"schema_version": "1.0",
         "methods": [_item("Twelve adults participated.", cid,
                            section="methods", sub="", ps=None, pe=None)]}
    d.update(kw)
    return json.dumps(d)


# 13. missing schema_version (real: 3 paper-2 chunks) -> repaired
def test_missing_schema_version_repaired(client):
    pid = _seed_paper([_chunk("m_001", subsection="")])
    broken = json.dumps(
        {"methods": [_item("Twelve adults participated.", "m_001",
                            section="methods", sub="",
                            ps=None, pe=None)]})
    backend = MechanicalRepairBackend({"m_001": broken},
                                      {"m_001": _valid_body("m_001")})
    ext_orch.set_backend(backend)
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["status"] == "complete"
    assert stats["repair_successes"] == 1
    assert len(backend.repair_calls) == 1
    assert "Do not add new scientific information" in backend.repair_calls[0]
    assert len(client.get(f"/api/papers/{pid}/evidence").json()) == 1


# 14. invented top-level field (real: 'res', 'source') -> repaired
def test_invented_field_repaired(client):
    pid = _seed_paper([_chunk("m_001", subsection="")])
    broken = '{"schema_version": "1.0", "res": ["junk"], ' \
        '"methods": []}'
    backend = MechanicalRepairBackend({"m_001": broken},
                                      {"m_001": _valid_body("m_001")})
    ext_orch.set_backend(backend)
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["status"] == "complete"
    assert stats["repair_successes"] == 1


# 15. bare-string item (real: results_003, references) -> NOT repaired
def test_bare_string_not_repaired(client):
    pid = _seed_paper([_chunk("m_001", subsection="")])
    backend = MechanicalRepairBackend(
        {"m_001": '{"schema_version": "1.0", "stimuli": ["bare string"]}'},
        {"m_001": _valid_body("m_001")})
    ext_orch.set_backend(backend)
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["status"] == "error"
    assert stats["repair_attempts"] == 0
    assert backend.repair_calls == []
    assert client.get(f"/api/papers/{pid}/evidence").json() == []


# 16. missing item text (real: references_002) -> fails visibly
def test_missing_item_text_fails(client):
    pid = _seed_paper([_chunk("m_001", subsection="")])
    broken = json.dumps(
        {"schema_version": "1.0",
         "research_question": [{"source": {"chunk_id": "m_001"}}]})
    ext_orch.set_backend(FakeBackend({"m_001": broken}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["failed"] == 1
    rec = store.get_chunk_extraction(
        pid, "m_001", stats["model"], PROMPT_VERSION, "1.0")
    assert rec is not None and rec["status"] == "failed"
    assert rec["failure_type"] == "schema"
    assert "missing non-empty text" in rec["error"]


# 17. truncated JSON (real: methods_data_acquisition_001) -> repaired
def test_truncated_json_repaired(client):
    pid = _seed_paper([_chunk("m_001", subsection="")])
    truncated = '{"schema_version": "1.0", "methods": [{"text": "Twelve'
    backend = MechanicalRepairBackend({"m_001": truncated},
                                      {"m_001": _valid_body("m_001")})
    ext_orch.set_backend(backend)
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["status"] == "complete"
    assert stats["repair_successes"] == 1


# 18. failure diagnostics recorded per chunk
def test_failure_diagnostics(client):
    pid = _seed_paper([_chunk("m_001", subsection="")])
    ext_orch.set_backend(FakeBackend({"m_001": "pure prose, no json"}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["failed"] == 1
    rec = store.get_chunk_extraction(
        pid, "m_001", stats["model"], PROMPT_VERSION, "1.0")
    assert rec["failure_type"] == "json"
    assert rec["attempt_count"] >= 1
    assert "pure prose" in rec["raw_output"]
    # retry increments the attempt counter
    client.post(f"/api/papers/{pid}/extract",
                json={"force": True, "chunk_ids": ["m_001"]})
    rec2 = store.get_chunk_extraction(
        pid, "m_001", stats["model"], PROMPT_VERSION, "1.0")
    assert rec2["attempt_count"] == rec["attempt_count"] + 1


# 19. targeted retry fixes one chunk, leaves successes cached
def test_targeted_retry_preserves_success(client):
    pid = _seed_paper([_chunk("good_001", subsection=""),
                       _chunk("bad_001", subsection="")])
    backend = FakeBackend({
        "good_001": _valid_body("good_001"),
        "bad_001": "garbage {{{",
    })
    ext_orch.set_backend(backend)
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["status"] == "partial"
    good_rec = store.get_chunk_extraction(
        pid, "good_001", stats["model"], PROMPT_VERSION, "1.0")
    backend.scripts["bad_001"] = _valid_body("bad_001")
    stats = client.post(f"/api/papers/{pid}/extract",
                        json={"chunk_ids": ["bad_001"]}).json()
    assert stats["status"] == "complete"
    assert stats["succeeded"] == 1 and stats["skipped_cached"] == 0
    good_rec2 = store.get_chunk_extraction(
        pid, "good_001", stats["model"], PROMPT_VERSION, "1.0")
    assert good_rec2["attempt_count"] == good_rec["attempt_count"]
    assert len(client.get(f"/api/papers/{pid}/evidence").json()) == 2


# 20. Qwen <think> trace stripped deterministically (closed block)
def test_think_block_stripped(client):
    from src.teacher.extraction import extract_json
    raw = "<think>\nSome reasoning with { stray brace.\n</think>\n" \
        '{"schema_version": "1.0", "methods": []}'
    assert extract_json(raw) == {"schema_version": "1.0", "methods": []}


# 21. unclosed trailing <think> block dropped (truncated generation)
def test_unclosed_think_dropped(client):
    from src.teacher.extraction import extract_json, ExtractionError
    with pytest.raises(ExtractionError):
        extract_json("<think>\ncut off mid-thought, no json here")


# 22. think-wrapped valid output extracts end-to-end
def test_think_wrapped_output_succeeds(client):
    pid = _seed_paper([_chunk("m_001", subsection="")])
    wrapped = "<think>reasoning</think>\n" + _valid_body("m_001")
    ext_orch.set_backend(FakeBackend({"m_001": wrapped}))
    stats = client.post(f"/api/papers/{pid}/extract", json={}).json()
    assert stats["status"] == "complete"
    assert stats["succeeded"] == 1
