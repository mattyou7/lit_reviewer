"""Paper-synthesis tests. Teacher is faked; no Qwen weights needed."""
import json

import pytest
from fastapi.testclient import TestClient

from backend.app import synthesis as synth_orch
from backend.app import store
from backend.app.database import connect
from backend.app.extraction import set_backend
from src.teacher.backend import TeacherBackend


class FakeBackend(TeacherBackend):
    name = "fake-test"

    def __init__(self, scripts):
        self.scripts = list(scripts)
        self.calls: list[str] = []

    def extract(self, prompt: str) -> str:
        self.calls.append(prompt)
        resp = self.scripts.pop(0) if self.scripts else \
            '{"schema_version": "1.0"}'
        if isinstance(resp, Exception):
            raise resp
        return resp


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    monkeypatch.setenv("LIT_REVIEW_DB", str(db))
    from backend.app.database import init_db
    from backend.app.main import app
    init_db(db)
    set_backend(None)
    yield TestClient(app)
    set_backend(None)


def _seed_versions():
    from src.teacher.backend import load_teacher_config
    from src.teacher.prompt import (
        EXTRACTION_SCHEMA_VERSION,
        PROMPT_VERSION as EXTRACTION_PROMPT_VERSION,
    )
    try:
        model = load_teacher_config()["model"]
    except Exception:
        model = "Qwen/Qwen3-1.7B-MLX-8bit"
    return model, EXTRACTION_PROMPT_VERSION, EXTRACTION_SCHEMA_VERSION


def _seed_paper(n_evidence=2, paper_title="T"):
    proj = store.create_project("P")
    paper = store.create_paper(proj["id"], {"title": paper_title})
    pid = paper["id"]
    items = [
        {"category": "methods", "text": f"Method statement {i}.",
         "section": "methods", "subsection": "participants",
         "page_start": 8, "page_end": 8,
         "location_status": "known", "status": "explicit"}
        for i in range(n_evidence)
    ]
    store.save_evidence_items(pid, "methods_participants_001", items,
                              *_seed_versions())
    return pid


def _ev_ids(client, pid):
    return [e["id"] for e in
            client.get(f"/api/papers/{pid}/evidence").json()]


def _synth_json(eids, **overrides):
    body = {"schema_version": "1.0",
            "methods": [{"text": "Synthesized method.",
                         "evidence_ids": eids}]}
    body.update(overrides)
    return json.dumps(body)


# 1. valid synthesis JSON -> complete, persisted, sources resolved
def test_valid_synthesis(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    set_backend(FakeBackend([_synth_json(eids)]))
    r = client.post(f"/api/papers/{pid}/synthesize", json={})
    assert r.status_code == 200, r.text
    stats = r.json()
    assert stats["status"] == "complete"
    assert stats["model_calls"] == 1
    assert stats["fields_populated"] >= 1

    r = client.get(f"/api/papers/{pid}/synthesis")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["synthesis_status"] == "complete"
    item = body["synthesis"]["methods"][0]
    assert item["evidence_ids"] == eids
    assert item["sources"][0]["chunk_id"] == "methods_participants_001"
    assert item["sources"][0]["page_start"] == 8


# 2. malformed JSON -> error, nothing complete persisted
def test_malformed_json(client):
    pid = _seed_paper()
    set_backend(FakeBackend(["not json at all"]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"
    assert stats["model_calls"] == 1
    row = client.get(f"/api/papers/{pid}/synthesis").json()
    assert row["synthesis_status"] == "error"


# 3. schema failure (unexpected field)
def test_schema_failure(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    set_backend(FakeBackend([_synth_json(eids, recommended_future_work=[])]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"


# 4. wrong paper_id
def test_wrong_paper_id(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    set_backend(FakeBackend([_synth_json(eids, paper_id="paper_other")]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"


# 5. nonexistent evidence ID
def test_unknown_evidence_id(client):
    pid = _seed_paper()
    set_backend(FakeBackend([_synth_json(["nope:missing:methods:000"])]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"


# 6. evidence from another paper
def test_foreign_evidence_id(client):
    pid_a = _seed_paper()
    pid_b = _seed_paper()
    foreign = _ev_ids(client, pid_b)
    set_backend(FakeBackend([_synth_json(foreign)]))
    stats = client.post(f"/api/papers/{pid_a}/synthesize",
                        json={}).json()
    assert stats["status"] == "error"


# 7. missing provenance (no evidence_ids)
def test_missing_evidence_ids(client):
    pid = _seed_paper()
    set_backend(FakeBackend([json.dumps(
        {"schema_version": "1.0",
         "methods": [{"text": "Unsupported claim."}]} )]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"


# 8. smuggled page numbers rejected
def test_smuggled_pages_rejected(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    set_backend(FakeBackend([json.dumps(
        {"schema_version": "1.0",
         "methods": [{"text": "X.", "evidence_ids": eids,
                      "page_start": 99}]} )]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"


# 9. empty / UNKNOWN fields coerced
def test_unknown_fields_coerced(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    set_backend(FakeBackend([json.dumps(
        {"schema_version": "1.0",
         "methods": [{"text": "M.", "evidence_ids": eids}],
         "hypotheses": "UNKNOWN",
         "limitations": None})]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete"
    body = client.get(f"/api/papers/{pid}/synthesis").json()
    assert body["synthesis"]["hypotheses"] == []
    assert body["synthesis"]["limitations"] == []


# 10. results vs interpretation stay separate; main_results <- results
def test_results_vs_interpretation(client):
    pid = _seed_paper(n_evidence=0)
    model, pv, sv = _seed_versions()
    conn = connect()
    try:
        for i, cat in enumerate(["results", "author_interpretations"]):
            conn.execute(
                """INSERT INTO paper_evidence (id, paper_id, chunk_id,
                   category, text, section, model_name, prompt_version,
                   schema_version, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (f"{pid}:c:res:{i}", pid, "results_001", cat,
                 f"Statement {i}.", "results", model, pv, sv, "t"))
        conn.commit()
    finally:
        conn.close()
    res_id = f"{pid}:c:res:0"
    int_id = f"{pid}:c:res:1"
    set_backend(FakeBackend([json.dumps(
        {"schema_version": "1.0",
         "main_results": [{"text": "R.", "evidence_ids": [res_id]}],
         "author_interpretations": [{"text": "I.",
                                     "evidence_ids": [int_id]}]})]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete"
    body = client.get(f"/api/papers/{pid}/synthesis").json()
    assert body["synthesis"]["main_results"][0]["evidence_ids"] == [res_id]
    assert body["synthesis"]["author_interpretations"][0][
        "evidence_ids"] == [int_id]


# 11. author-stated future work allowed
def test_author_stated_future_work(client):
    pid = _seed_paper(n_evidence=0)
    model, pv, sv = _seed_versions()
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO paper_evidence (id, paper_id, chunk_id, category,
               text, section, model_name, prompt_version, schema_version,
               created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (f"{pid}:c:fw:0", pid, "discussion_001",
             "author_stated_future_work", "Authors will extend X.",
             "discussion", model, pv, sv, "t"))
        conn.commit()
    finally:
        conn.close()
    eid = f"{pid}:c:fw:0"
    set_backend(FakeBackend([json.dumps(
        {"schema_version": "1.0",
         "author_stated_future_work": [{"text": "Extend X.",
                                        "evidence_ids": [eid]}]})]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete"


# 12+13. overlap dedup: same statement from two chunks -> one item, both IDs
def test_overlap_dedup(client):
    pid = _seed_paper(n_evidence=0)
    for chunk in ["methods_001", "methods_002"]:
        store.save_evidence_items(
            pid, chunk,
            [{"category": "methods", "text": "Twelve adults participated.",
              "section": "methods", "subsection": "",
              "page_start": 8, "page_end": 9,
              "location_status": "known", "status": "explicit"}],
            *_seed_versions())
    seen = {}

    class SpyBackend(FakeBackend):
        def extract(self, prompt):
            body = json.loads(prompt.split("VALIDATED EVIDENCE (JSON):\n")[1])
            seen["n"] = len(body["evidence"])
            seen["merged"] = body["evidence"][0].get("merged_ids")
            eid = body["evidence"][0]["evidence_id"]
            return json.dumps(
                {"schema_version": "1.0",
                 "methods": [{"text": "Twelve adults.",
                              "evidence_ids": [eid]}]})

    set_backend(SpyBackend([]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete"
    assert seen["n"] == 1  # duplicates merged before the model
    assert len(seen["merged"]) == 2  # both original IDs preserved


# 15+16. idempotency + force
def test_idempotent_and_force(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    backend = FakeBackend([_synth_json(eids), _synth_json(eids)])
    set_backend(backend)
    client.post(f"/api/papers/{pid}/synthesize", json={})
    assert len(backend.calls) == 1
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["cached"] is True
    assert len(backend.calls) == 1
    stats = client.post(f"/api/papers/{pid}/synthesize",
                        json={"force": True}).json()
    assert stats["cached"] is False
    assert len(backend.calls) == 2


# 17. failed synthesis preserves extraction
def test_failure_preserves_evidence(client):
    pid = _seed_paper()
    before = client.get(f"/api/papers/{pid}/evidence").json()
    assert len(before) == 2
    set_backend(FakeBackend(["garbage"]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"
    after = client.get(f"/api/papers/{pid}/evidence").json()
    assert len(after) == 2
    paper = client.get(f"/api/papers/{pid}").json()
    assert paper["extraction_status"] == "pending"  # synthesis untouched it
    assert any("synthesis" in w for w in paper["parsing_warnings"])


# 18. API retrieval errors
def test_api_errors(client):
    assert client.get("/api/papers/missing/synthesis").status_code == 404
    pid = _seed_paper()
    r = client.get(f"/api/papers/{pid}/synthesis")
    assert r.status_code == 404  # none yet
    r = client.post("/api/papers/missing/synthesize", json={})
    assert r.status_code == 404


# hierarchical batching when evidence exceeds budget
def test_hierarchical_batches(client, monkeypatch):
    pid = _seed_paper()
    store.save_evidence_items(
        pid, "results_001",
        [{"category": "results", "text": "Accuracy improved.",
          "section": "results", "subsection": "",
          "page_start": 3, "page_end": 3,
          "location_status": "known", "status": "explicit"}],
        *_seed_versions())
    import backend.app.synthesis as S
    monkeypatch.setattr(S, "load_context_budget", lambda: (600, 100))
    calls = []

    prompts = []

    class BatchBackend(FakeBackend):
        def extract(self, prompt):
            fields = json.loads(
                prompt.split("FIELDS TO FILL (only these):\n")[1]
                .split("\n\n---")[0])
            calls.append(fields)
            prompts.append(prompt)
            return json.dumps({"schema_version": "1.0"})

    set_backend(BatchBackend([]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete"
    assert stats["hierarchical"] is True
    assert stats["model_calls"] == len(calls) > 1
    # Batch inputs are filtered to their fields' categories: the
    # methods-only batch carries no results-category evidence.
    methods_prompts = [p for p, fs in zip(prompts, calls)
                       if fs == ["methods"]]
    assert methods_prompts, calls
    assert '"category": "methods"' in methods_prompts[0]
    assert '"category": "results"' not in methods_prompts[0]
    covered = {f for batch in calls for f in batch}
    # Only answerable fields (those with matching-category evidence)
    # are requested: the seed has methods + results evidence.
    assert covered == {"methods", "main_results"}


# repair retry fixes a fabricated evidence ID
def test_repair_fixes_bad_id(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)

    class RepairBackend(FakeBackend):
        def repair(self, previous, instruction=None):
            assert "evidence IDs" in (instruction or "")
            return _synth_json(eids)

    bad = json.dumps({"schema_version": "1.0",
                      "methods": [{"text": "M.",
                                   "evidence_ids": ["fake:id:000"]}]})
    set_backend(RepairBackend([bad]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete"
    assert stats["repair_attempts"] == 1
    assert stats["model_calls"] == 2
    body = client.get(f"/api/papers/{pid}/synthesis").json()
    assert body["synthesis"]["methods"][0]["evidence_ids"] == eids


# unrepairable output stays error
def test_repair_failure_stays_error(client):
    pid = _seed_paper()

    class BadRepairBackend(FakeBackend):
        def repair(self, previous, instruction=None):
            return "still not json"

    set_backend(BadRepairBackend(['{"schema_version": broken']))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"
    assert stats["repair_attempts"] == 1


# stale-version evidence is excluded from synthesis input
def test_stale_versions_excluded(client):
    pid = _seed_paper(n_evidence=0)
    store.save_evidence_items(
        pid, "methods_001",
        [{"category": "methods", "text": "Stale statement.",
          "section": "methods", "subsection": "",
          "page_start": 1, "page_end": 1,
          "location_status": "known", "status": "explicit"}],
        "OLD-MODEL", "0.1", "0.1")
    set_backend(FakeBackend([json.dumps({"schema_version": "1.0"})]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    # No current-version evidence -> synthesis cannot proceed.
    assert stats["status"] == "error"


# cross-category citation rejected (real case: results evidence for research_question)
def test_cross_category_citation_rejected(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)  # methods-category evidence
    set_backend(FakeBackend([json.dumps(
        {"schema_version": "1.0",
         "task": [{"text": "Inferred task.", "evidence_ids": eids}]} )]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"
    row = client.get(f"/api/papers/{pid}/synthesis").json()
    assert "cite" in row["error"] and "task" in row["error"]


# continuation repair splices truncated output
def test_continuation_repair(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    prefix = ('{"schema_version": "1.0", "methods": '
              '[{"text": "Partially written')
    fixed_tail = (' claim.", "evidence_ids": ["' + eids[0] + '"]}]}')

    class ContinueBackend(FakeBackend):
        def repair(self, previous, instruction=None, system=None):
            assert "continuation" in (instruction or "")
            assert "continuation" in (system or "")
            return fixed_tail

    set_backend(ContinueBackend([prefix]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete"
    assert stats["repair_attempts"] == 1
    body = client.get(f"/api/papers/{pid}/synthesis").json()
    assert body["synthesis"]["methods"][0]["evidence_ids"] == [eids[0]]


# failed continuation stays error with raw stored
def test_continuation_failure(client):
    pid = _seed_paper()

    class BadContinueBackend(FakeBackend):
        def repair(self, previous, instruction=None, system=None):
            return "more garbage ((( "

    set_backend(BadContinueBackend(['{"schema_version": "1.0", "methods": [']))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"
    from backend.app import store as _store
    from src.teacher.prompt import SYNTHESIS_PROMPT_VERSION as _spv
    from src.teacher.prompt import SYNTHESIS_SCHEMA_VERSION as _ssv
    from src.teacher.backend import load_teacher_config as _cfg
    row = _store.get_synthesis(pid, _cfg()["model"], _spv, _ssv)
    assert row["raw_output"].startswith('{"schema_version"')


# truncation fallback: single-call truncates -> field-group batches
def test_truncation_fallback(client, monkeypatch):
    pid = _seed_paper(n_evidence=0)
    for chunk, cat in [("c1", "methods"), ("c2", "results"),
                       ("c3", "task"), ("c4", "stimuli")]:
        store.save_evidence_items(
            pid, chunk,
            [{"category": cat, "text": ("Statement %s %d. " % (cat, i)) * 40,
              "section": "s", "subsection": "",
              "page_start": 1, "page_end": 1,
              "location_status": "known", "status": "explicit"}
             for i in range(4)],
            *_seed_versions())
    import backend.app.synthesis as S
    # Full input (~4400 tok) fits: single-call mode. Half budget forces
    # the fallback split.
    monkeypatch.setattr(S, "load_context_budget", lambda: (6000, 100))
    calls = []

    class FallbackBackend(FakeBackend):
        def __init__(self):
            super().__init__([])
            self.first = True

        def extract(self, prompt):
            calls.append(prompt)
            body = json.loads(prompt.split("VALIDATED EVIDENCE (JSON):\n")[1])
            by_cat = {}
            for e in body["evidence"]:
                by_cat.setdefault(e["category"], e["evidence_id"])
            if self.first:
                self.first = False
                return '{"schema_version": "1.0", "methods": [{"text": "cut'
            fields = json.loads(
                prompt.split("FIELDS TO FILL (only these):\n")[1]
                .split("\n\n---")[0])
            out = {"schema_version": "1.0"}
            for f in fields:
                cat = {"main_results": "results"}.get(f, f)
                if cat in by_cat:
                    out[f] = [{"text": "Item %s." % f,
                               "evidence_ids": [by_cat[cat]]}]
                else:
                    out[f] = []
            return json.dumps(out)

    set_backend(FallbackBackend())
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete", stats
    assert stats["hierarchical"] is True
    assert stats["model_calls"] > 2  # 1 failed + repair? no: fallback path
    body = client.get(f"/api/papers/{pid}/synthesis").json()
    assert body["synthesis_status"] == "complete"


# partial persistence: validated batches kept when a later batch fails
def test_partial_persistence(client, monkeypatch):
    pid = _seed_paper()
    store.save_evidence_items(
        pid, "results_001",
        [{"category": "results", "text": "Accuracy improved.",
          "section": "results", "subsection": "",
          "page_start": 3, "page_end": 3,
          "location_status": "known", "status": "explicit"}],
        *_seed_versions())
    import backend.app.synthesis as S
    monkeypatch.setattr(S, "load_context_budget", lambda: (600, 100))
    eids = {e["category"]: e["id"]
            for e in client.get(f"/api/papers/{pid}/evidence").json()}

    class PartialBackend(FakeBackend):
        def extract(self, prompt):
            fields = json.loads(
                prompt.split("FIELDS TO FILL (only these):\n")[1]
                .split("\n\n---")[0])
            if "methods" in fields:
                return json.dumps(
                    {"schema_version": "1.0",
                     "methods": [{"text": "M.",
                                  "evidence_ids": [eids["methods"]]}]})
            return '{"schema_version": "1.0", "main_results": [{"text": "cut'

    set_backend(PartialBackend([]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "partial", stats
    assert stats["fields_populated"] == 1
    body = client.get(f"/api/papers/{pid}/synthesis").json()
    assert body["synthesis_status"] == "partial"
    assert body["synthesis"]["methods"][0]["evidence_ids"] == [
        eids["methods"]]
    assert body["error"].startswith("synthesis: json:")


# salvage: valid items kept, unsupported ones dropped visibly
def test_salvage_keeps_valid_items(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    bad = json.dumps({"schema_version": "1.0",
                      "methods": [{"text": "Good.", "evidence_ids": eids}],
                      "task": [{"text": "Inferred.",
                                "evidence_ids": ["ghost:1"]}]})
    set_backend(FakeBackend([bad]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete", stats
    assert any("dropped 1 unsupported" in w for w in stats["warnings"])
    body = client.get(f"/api/papers/{pid}/synthesis").json()
    assert body["synthesis"]["methods"][0]["evidence_ids"] == eids
    assert body["synthesis"].get("task", []) == []


# salvage with nothing valid stays error
def test_salvage_all_invalid_errors(client):
    pid = _seed_paper()
    bad = json.dumps({"schema_version": "1.0",
                      "task": [{"text": "Inferred.",
                                "evidence_ids": ["ghost:1"]}]})
    set_backend(FakeBackend([bad]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "error"


# salvage falls back to pre-repair output when repair returns garbage
def test_salvage_uses_pre_repair_output(client):
    pid = _seed_paper()
    eids = _ev_ids(client, pid)
    original = json.dumps(
        {"schema_version": "1.0",
         "methods": [{"text": "Good.", "evidence_ids": eids}],
         "task": [{"text": "Bad.", "evidence_ids": ["ghost:9"]}]})

    class GarbageRepairBackend(FakeBackend):
        def repair(self, previous, instruction=None, system=None):
            return "!!! not json !!!"

    set_backend(GarbageRepairBackend([original]))
    stats = client.post(f"/api/papers/{pid}/synthesize", json={}).json()
    assert stats["status"] == "complete", stats
    body = client.get(f"/api/papers/{pid}/synthesis").json()
    assert body["synthesis"]["methods"][0]["evidence_ids"] == eids
    assert body["synthesis"].get("task", []) == []
