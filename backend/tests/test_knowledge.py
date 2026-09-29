"""Knowledge/discovery tests: metadata, references, citations,
embeddings (hash backend), similarity, landscape data."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app import embeddings as emb_orch
from backend.app import store
from backend.app.database import connect
from src.embeddings.backends import HashEmbeddingBackend


class CountingBackend(HashEmbeddingBackend):
    def __init__(self):
        super().__init__(dim=32)
        self.calls = 0

    def encode(self, texts):
        self.calls += 1
        return super().encode(texts)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    monkeypatch.setenv("LIT_REVIEW_DB", str(db))
    from backend.app.database import init_db
    from backend.app.main import app
    init_db(db)
    backend = CountingBackend()
    emb_orch.set_backend(backend)
    yield TestClient(app), backend
    emb_orch.set_backend(None)


def _paper(client, title="T", **kw):
    pid = client[0].post("/api/projects", json={"name": "P"}).json()["id"]
    data = {"title": title}
    data.update(kw)
    r = client[0].post(f"/api/projects/{pid}/papers", json=data)
    assert r.status_code == 201, r.text
    return pid, r.json()["id"]


def _project_with(client, papers):
    """Create one project holding several papers. Returns (proj, ids)."""
    pid = client[0].post("/api/projects", json={"name": "P"}).json()["id"]
    ids = []
    for data in papers:
        r = client[0].post(f"/api/projects/{pid}/papers", json=data)
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return pid, ids


# ---------- metadata ----------

def test_metadata_extraction_from_pdf():
    from backend.app.metadata import read_pdf_metadata, extract_text_metadata
    import fitz
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as t:
        path = t.name
    try:
        doc = fitz.open()
        doc.new_page().insert_text(
            (72, 72), "Contact https://doi.org/10.1234/abc.2020 arXiv:2101.00001")
        doc.set_metadata({"title": "A Real Study of Brains",
                          "author": "Doe, J.; Smith, A."})
        doc.save(path)
        doc.close()
        meta = read_pdf_metadata(path)
        assert meta["title"] == "A Real Study of Brains"
        assert meta["authors"] == ["Doe", "J.", "Smith", "A."]
        text_meta = extract_text_metadata(
            "see 10.1234/abc.2020 and arXiv:2101.00001 here")
        assert text_meta["doi"] == "10.1234/abc.2020"
        assert text_meta["arxiv_id"] == "2101.00001"
    finally:
        os.unlink(path)


def test_metadata_missing_and_provenance(client):
    _, paper_id = _paper(client)
    from backend.app import metadata as md
    result = md.run_paper_metadata(paper_id)
    assert result["status"] == "complete"
    body = client[0].get(f"/api/papers/{paper_id}/metadata").json()
    assert body["fields"]["journal"]["value"] == ""
    assert body["fields"]["journal"]["source"] == "unknown"
    assert body["fields"]["year"]["value"] is None


def test_metadata_conflicts_preserved(client):
    _, paper_id = _seed_with_pdf_meta(client, "First Title")
    from backend.app import metadata as md
    md.record_metadata(paper_id, "title", "Second Title", "pdf_text")
    body = client[0].get(f"/api/papers/{paper_id}/metadata").json()
    cands = body["fields"]["title"]["candidates"]
    assert {c["value"] for c in cands} == {"First Title", "Second Title"}
    # pdf_metadata wins over pdf_text by priority
    assert body["fields"]["title"]["source"] == "pdf_metadata"


def _seed_with_pdf_meta(client, title):
    _, paper_id = _paper(client)
    from backend.app import metadata as md
    md.record_metadata(paper_id, "title", title, "pdf_metadata")
    conn = connect()
    try:
        conn.execute("UPDATE papers SET title=? WHERE id=?",
                     (title, paper_id))
        conn.commit()
    finally:
        conn.close()
    return None, paper_id


# ---------- references ----------

def _ref_items():
    return [
        {"page": 14, "text": "[1] Smith J, et al. Great work. "
                             "Nature 2020. https://doi.org/10.9999/xyz",
         "subsection": None, "is_heading": False},
        {"page": 14, "text": "[2] Doe A. Unmatched work. Science 2019.",
         "subsection": None, "is_heading": False},
    ]


def test_reference_extraction_split_and_parse():
    from backend.app.references import split_references, parse_reference
    entries = split_references(_ref_items())
    assert len(entries) == 2
    assert entries[0]["source_page"] == 14
    parsed = parse_reference(entries[0]["raw_text"])
    assert parsed["doi"] == "10.9999/xyz"
    assert parsed["year"] == 2020
    assert parse_reference(entries[1]["raw_text"])["doi"] == ""


def _seed_sections(paper_id, items):
    import json as _json
    from datetime import datetime, timezone
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO paper_sections (id, paper_id, name, items_json,"
            " created_at) VALUES (?, ?, ?, ?, ?)",
            (f"{paper_id}:references", paper_id, "references",
             _json.dumps(items), datetime.now(timezone.utc).isoformat()))
        conn.commit()
    finally:
        conn.close()


def test_doi_resolution_and_edge(client):
    proj, (target_id, citing_id) = _project_with(client, [
        {"title": "Target", "doi": "10.9999/xyz"},
        {"title": "Citing"},
    ])
    from backend.app import references as ref
    _seed_sections(citing_id, _ref_items())
    result = ref.run_paper_references(citing_id)
    assert result["references"] == 2
    assert result["resolved"] == 1
    assert result["unresolved"] == 1
    assert result["edges"] == 1
    cites = client[0].get(f"/api/papers/{citing_id}/citations").json()
    assert len(cites["outgoing"]) == 1
    assert cites["outgoing"][0]["target_paper_id"] == target_id
    assert cites["outgoing"][0]["relationship"] == "cites"
    incoming = client[0].get(f"/api/papers/{target_id}/citations").json()
    assert len(incoming["incoming"]) == 1


def test_unresolved_keeps_raw(client):
    _, paper_id = _paper(client)
    from backend.app import references as ref
    _seed_sections(paper_id, _ref_items())
    ref.run_paper_references(paper_id)
    refs = client[0].get(f"/api/papers/{paper_id}/references").json()
    assert len(refs) == 2
    assert refs[1]["resolution_status"] == "unresolved"
    assert "[2] Doe A." in refs[1]["raw_text"]


def test_ambiguous_and_no_dup_edges(client):
    proj, (dupa, dupb, citing_id) = _project_with(client, [
        {"title": "Dup A", "doi": "10.9999/xyz"},
        {"title": "Dup B", "doi": "10.9999/xyz"},
        {"title": "Citing"},
    ])
    from backend.app import references as ref
    _seed_sections(citing_id, _ref_items())
    result = ref.run_paper_references(citing_id)
    assert result["ambiguous"] == 1
    assert result["edges"] == 0
    # rerun: still no edges, no duplicates
    result2 = ref.run_paper_references(citing_id)
    assert result2["edges"] == 0
    cites = client[0].get(f"/api/papers/{citing_id}/citations").json()
    assert cites["outgoing"] == []


# ---------- embeddings ----------

def test_embedding_create_persist_idempotent(client):
    _, paper_id = _paper(client, title="Embedding Test Paper",
                         **{"abstract": "Brains and decisions."})
    backend = client[1]
    r = client[0].post(f"/api/papers/{paper_id}/embeddings", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "complete" and body["dim"] == 32
    assert backend.calls == 1
    st = client[0].get(f"/api/papers/{paper_id}/embedding-status").json()
    assert st["status"] == "complete"
    assert st["embeddings"][0]["dim"] == 32
    vec = emb_orch.get_embedding(paper_id, backend.model_id,
                                 backend.version)
    assert vec["vector"].shape == (32,)
    # second run: cached, no recompute
    client[0].post(f"/api/papers/{paper_id}/embeddings", json={})
    assert backend.calls == 1
    # forced: recompute
    client[0].post(f"/api/papers/{paper_id}/embeddings",
                   json={"force": True})
    assert backend.calls == 2


def test_embedding_versioning(client):
    _, paper_id = _paper(client, title="Versioned Paper")
    client[0].post(f"/api/papers/{paper_id}/embeddings", json={})
    st = client[0].get(f"/api/papers/{paper_id}/embedding-status").json()
    assert st["embeddings"][0]["embedding_version"] == "1.0"
    assert st["embeddings"][0]["source_repr"].startswith("title+abstract")


# ---------- similarity ----------

def _seed_vector(paper_id, vec, model="m", version="1.0"):
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO paper_embeddings
               (paper_id, model_name, model_version, embedding_version,
                source_repr, source_hash, dim, vector, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (paper_id, model, "", version, "test", "h",
             len(vec), np.asarray(vec, dtype=np.float32).tobytes(), "t"))
        conn.commit()
    finally:
        conn.close()


def test_cosine_and_pairs(client):
    proj, (a, b) = _project_with(client, [{"title": "A"}, {"title": "B"}])
    from backend.app import landscape as ls
    assert ls.cosine(np.array([1.0, 0.0]), np.array([1.0, 0.0])) == 1.0
    assert abs(ls.cosine(np.array([1.0, 0.0]),
                         np.array([0.0, 1.0]))) < 1e-6
    _seed_vector(a, [1.0, 0.0])
    _seed_vector(b, [1.0, 0.0])
    from backend.app.landscape import compute_pair, store_pair
    r = compute_pair(a, b, "m", "1.0")
    assert r is not None and r["similarity"] == 1.0
    store_pair(r)
    r = client[0].get(f"/api/papers/{a}/similarity").json()
    assert len(r) == 1 and r[0]["similarity"] == 1.0
    # single-paper project: no self pairs
    _, solo = _paper(client, title="Solo")
    assert client[0].get(f"/api/papers/{solo}/similarity").json() == []


def test_pair_duplication_prevention(client):
    proj, (a, b) = _project_with(client, [{"title": "A"}, {"title": "B"}])
    client[0].post(f"/api/projects/{proj}/embeddings", json={})
    from backend.app import landscape as ls
    ls.compute_project_similarity(proj)
    ls.compute_project_similarity(proj)
    conn = connect()
    try:
        n = conn.execute("SELECT COUNT(*) c FROM paper_similarity"
                         ).fetchone()["c"]
    finally:
        conn.close()
    assert n == 1


# ---------- landscape ----------

def test_landscape_nodes_edges(client):
    proj, (a, b) = _project_with(client, [
        {"title": "A", "doi": "10.9999/xyz"},
        {"title": "B"},
    ])
    from backend.app import references as ref
    _seed_sections(b, _ref_items())
    ref.run_paper_references(b)
    client[0].post(f"/api/projects/{proj}/embeddings", json={})
    client[0].get(f"/api/projects/{proj}/similarity")
    land = client[0].get(f"/api/landscape/{proj}").json()
    assert len(land["nodes"]) >= 2
    node = next(n for n in land["nodes"] if n["id"] == b)
    assert node["type"] == "paper" and node["title"] == "B"
    assert node["embedding_status"] == "complete"
    rels = {(e["source"], e["target"], e["relationship"])
            for e in land["edges"]}
    assert (b, a, "cites") in rels
    assert any(r == "semantic_similarity" for _, _, r in rels)
    # unknown project -> 404
    assert client[0].get("/api/landscape/missing").status_code == 404


def test_doi_prefers_early_pages_over_references():
    from backend.app.metadata import extract_text_metadata, mining_texts
    pages = ["Publisher header https://doi.org/10.1111/real-paper",
             "More front matter",
             "Methods text here"]
    refs = ["[1] Someone. Old work. 10.2222/cited-work."]
    out = extract_text_metadata("", pages + refs)
    assert out["doi"] == "10.1111/real-paper"
    mined = mining_texts(pages + refs, {4})
    assert extract_text_metadata("", mined)["doi"] == "10.1111/real-paper"
    # references-only mining would have returned the wrong DOI
    assert extract_text_metadata("", refs)["doi"] == "10.2222/cited-work"


def test_stale_pdf_value_cleared_not_user_value(client):
    from backend.app import metadata as md
    _, stale_id = _paper(client)
    md.record_metadata(stale_id, "doi", "10.0000/stale", "pdf_text")
    conn = connect()
    try:
        conn.execute("UPDATE papers SET doi=? WHERE id=?",
                     ("10.0000/stale", stale_id))
        conn.commit()
    finally:
        conn.close()
    result = md.run_paper_metadata(stale_id, full_text="no identifiers here",
                                   page_texts=["no identifiers here"])
    assert result["status"] == "complete"
    assert any("cleared stale" in w for w in result["warnings"])
    assert store.get_paper(stale_id)["doi"] == ""
    # explicit user values are never cleared or overwritten
    _, user_id = _paper(client, title="Kept", **{"doi": "10.5555/user"})
    md.run_paper_metadata(user_id, full_text="see 10.9999/other",
                          page_texts=["see 10.9999/other"])
    assert store.get_paper(user_id)["doi"] == "10.5555/user"


def test_transformer_backend_real_model():
    from src.embeddings.backends import TransformerEmbeddingBackend
    backend = TransformerEmbeddingBackend()
    vecs = backend.encode(["visual decision making under uncertainty",
                           "cooking recipes for pasta"])
    assert vecs.shape[1] == 384
    assert backend.dim == 384
    from backend.app.landscape import cosine
    assert abs(cosine(vecs[0], vecs[0]) - 1.0) < 1e-5
    assert -1.0 <= float(cosine(vecs[0], vecs[1])) <= 1.0
