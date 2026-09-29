"""External discovery tests: PubMed/arXiv search (mocked HTTP),
explicit import, dedup, provenance, landscape expansion."""
import json

import pytest
from fastapi.testclient import TestClient

from backend.app import embeddings as emb_orch
from backend.app import search as search_orch
from backend.app import store
from backend.app.database import connect
from src.embeddings.backends import HashEmbeddingBackend
from src.search.common import SearchError, SearchResult


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


def _project(client):
    return client[0].post("/api/projects", json={"name": "P"}).json()["id"]


# ---------- fixtures: mocked provider payloads ----------

PUBMED_ESEARCH = {"esearchresult": {"idlist": ["111", "222", "111"]}}
PUBMED_ESUMMARY = {"result": {
    "111": {"title": "Memory consolidation during sleep",
            "authors": [{"name": "Smith J"}, {"name": "Doe A"}],
            "source": "Neuron", "pubdate": "2021 May",
            "articleids": [{"idtype": "doi", "value": "10.1000/ABC"}]},
    "222": {"title": "Untitled pilot",
            "authors": [], "source": "Brain", "pubdate": "",
            "articleids": []},
    "uids": ["111", "222"]}}
PUBMED_EFETCH = """<?xml version="1.0"?>
<PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID>111</PMID>
<Article><Abstract><AbstractText>Sleep helps memory.</AbstractText>
</Abstract></Article></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID>222</PMID>
<Article></Article></MedlineCitation></PubmedArticle>
</PubmedArticleSet>"""

ARXIV_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>http://arxiv.org/abs/2401.00001v2</id>
<title>Attention Flows</title>
<author><name>Lee K</name></author><author><name>Park J</name></author>
<published>2024-01-15T00:00:00Z</published>
<summary>We study attention.  With  spaces.</summary>
<arxiv:doi>10.2000/xyz</arxiv:doi>
<arxiv:journal_ref>JMLR 2024</arxiv:journal_ref></entry>
<entry><id>http://arxiv.org/abs/2401.00001v1</id>
<title>Attention Flows</title><author><name>Lee K</name></author>
<published>2024-01-02T00:00:00Z</published><summary>Old version.</summary>
</entry>
</feed>"""


def _mock_http(url):
    if "esearch" in url:
        return json.dumps(PUBMED_ESEARCH).encode()
    if "esummary" in url:
        return json.dumps(PUBMED_ESUMMARY).encode()
    if "efetch" in url:
        return PUBMED_EFETCH.encode()
    if "arxiv.org" in url:
        return ARXIV_FEED.encode()
    raise AssertionError(f"unexpected url {url}")


def _fake_pubmed(query, max_results=20, *args):
    from src.search.pubmed import search_pubmed
    return search_pubmed(query, max_results, http_get=_mock_http)


def _fake_arxiv(query, max_results=20, *args):
    from src.search.arxiv import search_arxiv
    return search_arxiv(query, max_results, http_get=_mock_http)


@pytest.fixture()
def fakes(monkeypatch):
    monkeypatch.setitem(search_orch.SEARCH_FNS, "pubmed", _fake_pubmed)
    monkeypatch.setitem(search_orch.SEARCH_FNS, "arxiv", _fake_arxiv)


# ---------- PubMed unit ----------

def test_pubmed_success_and_provenance():
    from src.search.pubmed import search_pubmed
    results = search_pubmed("sleep memory", 10, http_get=_mock_http)
    assert len(results) == 2  # duplicate PMID removed
    first = results[0]
    assert first.pmid == "111" and first.doi == "10.1000/abc"
    assert first.title.startswith("Memory consolidation")
    assert first.authors == ["Smith J", "Doe A"]
    assert first.year == 2021 and first.journal == "Neuron"
    assert first.abstract == "Sleep helps memory."
    assert first.discovery("sleep memory") == {
        "type": "pubmed_query", "query": "sleep memory"}
    assert results[1].abstract == ""  # missing abstract is empty, not None


def test_pubmed_empty_results():
    from src.search.pubmed import search_pubmed
    empty = lambda url: json.dumps(
        {"esearchresult": {"idlist": []}}).encode()
    assert search_pubmed("qqqzzz", http_get=empty) == []


def test_pubmed_malformed_and_empty_query():
    from src.search.pubmed import search_pubmed
    with pytest.raises(SearchError):
        search_pubmed("", http_get=_mock_http)
    with pytest.raises(SearchError):
        search_pubmed("x", http_get=lambda url: b"not json {{{")
    with pytest.raises(SearchError):
        search_pubmed("x", http_get=lambda url: json.dumps(
            {"wrong": "shape"}).encode())


def test_pubmed_network_failure():
    from src.search.pubmed import search_pubmed
    def boom(url):
        raise SearchError("NCBI network failure: down")
    with pytest.raises(SearchError):
        search_pubmed("x", http_get=boom)


# ---------- arXiv unit ----------

def test_arxiv_success_dedup_provenance():
    from src.search.arxiv import search_arxiv
    results = search_arxiv("attention", 10, http_get=_mock_http)
    assert len(results) == 1  # v1/v2 deduplicated
    r = results[0]
    assert r.arxiv_id == "2401.00001" and r.doi == "10.2000/xyz"
    assert r.title == "Attention Flows"
    assert r.authors == ["Lee K", "Park J"]
    assert r.year == 2024 and r.journal == "JMLR 2024"
    assert r.abstract == "We study attention. With spaces."
    assert r.pdf_url == "https://arxiv.org/pdf/2401.00001.pdf"
    assert r.discovery("attention")["type"] == "arxiv_query"


def test_arxiv_empty_and_malformed():
    from src.search.arxiv import search_arxiv
    empty = ('<?xml version="1.0"?><feed '
             'xmlns="http://www.w3.org/2005/Atom"></feed>')
    assert search_arxiv("qqqzzz", http_get=lambda url: empty.encode()) == []
    with pytest.raises(SearchError):
        search_arxiv("", http_get=_mock_http)
    with pytest.raises(SearchError):
        search_arxiv("x", http_get=lambda url: b"<broken")


# ---------- API search ----------

def test_search_api_and_history(client, fakes):
    pid = _project(client)
    r = client[0].post(f"/api/projects/{pid}/search/pubmed",
                       json={"query": "sleep memory", "max_results": 10})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["result_count"] == 2 and body["status"] == "complete"
    assert body["results"][0]["discovery_source"] == {
        "type": "pubmed_query", "query": "sleep memory"}
    r = client[0].get(f"/api/projects/{pid}/searches").json()
    assert len(r) == 1 and r[0]["query"] == "sleep memory"
    assert r[0]["result_count"] == 2 and r[0]["source"] == "pubmed"
    r = client[0].post(f"/api/projects/{pid}/search/arxiv",
                       json={"query": "attention"})
    assert r.json()["result_count"] == 1
    assert len(client[0].get(f"/api/projects/{pid}/searches").json()) == 2


def test_search_api_errors(client, fakes):
    pid = _project(client)
    r = client[0].post(f"/api/projects/{pid}/search/pubmed",
                       json={"query": "   "})
    assert r.status_code == 422
    r = client[0].post("/api/projects/missing/search/pubmed",
                       json={"query": "x"})
    assert r.status_code == 404
    r = client[0].get("/api/search/missing")
    assert r.status_code == 404


def test_search_network_error_persisted(client, monkeypatch):
    pid = _project(client)
    def boom(query, max_results=20, *args):
        raise SearchError("NCBI network failure: down")
    monkeypatch.setitem(search_orch.SEARCH_FNS, "pubmed", boom)
    r = client[0].post(f"/api/projects/{pid}/search/pubmed",
                       json={"query": "x"})
    assert r.status_code == 422
    hist = client[0].get(f"/api/projects/{pid}/searches").json()
    assert hist[0]["status"] == "error" and "down" in hist[0]["error"]


# ---------- import ----------

def test_import_metadata_only(client, fakes):
    pid = _project(client)
    sid = client[0].post(f"/api/projects/{pid}/search/pubmed",
                         json={"query": "sleep"}).json()["search_id"]
    r = client[0].post("/api/search/import",
                       json={"project_id": pid, "search_id": sid,
                             "external_id": "pmid:111"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] is True
    assert body["discovery_source_type"] == "pubmed_query"
    paper = client[0].get(f"/api/papers/{body['paper_id']}").json()
    assert paper["title"] == "Memory consolidation during sleep"
    assert paper["pmid"] == "111" and paper["doi"] == "10.1000/abc"
    land = client[0].get(f"/api/landscape/{pid}").json()
    node = next(n for n in land["nodes"] if n["id"] == body["paper_id"])
    assert node["metadata_only"] is True
    assert {"type": "pubmed_query", "query": "sleep",
            "source_paper_id": "", "search_id": sid,
            "external_id": "pmid:111",
            "source": "pubmed"} in node["discovery"]
    assert node["embedding_status"] == "complete"  # title+abstract embedded


def test_import_duplicate_and_provenance(client, fakes):
    pid = _project(client)
    sid = client[0].post(f"/api/projects/{pid}/search/pubmed",
                         json={"query": "sleep"}).json()["search_id"]
    first = client[0].post("/api/search/import",
                           json={"project_id": pid, "search_id": sid,
                                 "external_id": "pmid:111"}).json()
    # same paper via arXiv-flavored second search (same DOI)
    monkeypatch_arxiv = {"arxiv:9": SearchResult(
        external_id="arxiv:9", source="arxiv", doi="10.1000/abc",
        title="Memory consolidation during sleep", authors=["Smith J"])}
    import backend.app.search as S
    orig = S.SEARCH_FNS["arxiv"]
    S.SEARCH_FNS["arxiv"] = lambda q, m=20, *a: [monkeypatch_arxiv["arxiv:9"]]
    try:
        sid2 = client[0].post(f"/api/projects/{pid}/search/arxiv",
                              json={"query": "memory"}).json()["search_id"]
        second = client[0].post("/api/search/import",
                                json={"project_id": pid, "search_id": sid2,
                                      "external_id": "arxiv:9"}).json()
    finally:
        S.SEARCH_FNS["arxiv"] = orig
    assert second["created"] is False
    assert second["paper_id"] == first["paper_id"]
    disc = client[0].get(
        f"/api/papers/{first['paper_id']}/discovery").json()["discovery"]
    assert [d["type"] for d in disc] == ["pubmed_query", "arxiv_query"]
    assert len(client[0].get(f"/api/projects/{pid}/papers").json()) == 1


def test_import_preserves_existing(client, fakes):
    pid = _project(client)
    paper_id = client[0].post(
        f"/api/projects/{pid}/papers",
        json={"title": "Kept Title", "doi": "10.1000/abc"}).json()["id"]
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO paper_chunks (id, paper_id, chunk_id, section,"
            " text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (f"{paper_id}:c1", paper_id, "c1", "results", "text", "t"))
        conn.commit()
    finally:
        conn.close()
    sid = client[0].post(f"/api/projects/{pid}/search/pubmed",
                         json={"query": "sleep"}).json()["search_id"]
    body = client[0].post("/api/search/import",
                          json={"project_id": pid, "search_id": sid,
                                "external_id": "pmid:111"}).json()
    assert body["created"] is False and body["paper_id"] == paper_id
    paper = client[0].get(f"/api/papers/{paper_id}").json()
    assert paper["title"] == "Kept Title"  # not overwritten
    assert paper["abstract"] == "Sleep helps memory."  # missing one filled
    chunks = client[0].get(f"/api/papers/{paper_id}/chunks").json()
    assert len(chunks) == 1  # existing chunk data preserved


def test_import_unknown_result(client, fakes):
    pid = _project(client)
    sid = client[0].post(f"/api/projects/{pid}/search/pubmed",
                         json={"query": "sleep"}).json()["search_id"]
    r = client[0].post("/api/search/import",
                       json={"project_id": pid, "search_id": sid,
                             "external_id": "pmid:999"})
    assert r.status_code == 404


# ---------- landscape expansion ----------

def _seed_ref_section(paper_id, raw, page=3):
    import json as _json
    from datetime import datetime, timezone
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO paper_sections (id, paper_id, name, items_json,"
            " created_at) VALUES (?, ?, ?, ?, ?)",
            (f"{paper_id}:references", paper_id, "references",
             _json.dumps([{"page": page, "text": raw}]),
             datetime.now(timezone.utc).isoformat()))
        conn.commit()
    finally:
        conn.close()


def test_import_creates_citation_and_similarity(client, fakes):
    pid = _project(client)
    host_id = client[0].post(
        f"/api/projects/{pid}/papers",
        json={"title": "Host Paper"}).json()["id"]
    _seed_ref_section(host_id, "[1] Smith J. Memory work. 2021. 10.1000/abc")
    from backend.app import references as ref
    assert ref.run_paper_references(host_id)["edges"] == 0  # target unknown
    client[0].post(f"/api/papers/{host_id}/embeddings", json={})
    sid = client[0].post(f"/api/projects/{pid}/search/pubmed",
                         json={"query": "sleep"}).json()["search_id"]
    body = client[0].post("/api/search/import",
                          json={"project_id": pid, "search_id": sid,
                                "external_id": "pmid:111"}).json()
    assert body["references_resolved"] >= 1
    cites = client[0].get(f"/api/papers/{host_id}/citations").json()
    assert any(e["target_paper_id"] == body["paper_id"]
               and e["relationship"] == "cites"
               for e in cites["outgoing"])
    land = client[0].get(f"/api/landscape/{pid}").json()
    sims = [e for e in land["edges"]
            if e["relationship"] == "semantic_similarity"]
    assert len(sims) == 1  # exactly one pair, no duplicates
    assert sims[0]["similarity"] is not None
    assert not any(e["relationship"] not in ("cites", "semantic_similarity")
                   for e in land["edges"])


def test_no_edge_to_unknown_external(client, fakes):
    pid = _project(client)
    host_id = client[0].post(
        f"/api/projects/{pid}/papers",
        json={"title": "Host"}).json()["id"]
    _seed_ref_section(host_id, "[1] Stranger X. Unknown. 10.9999/nope")
    from backend.app import references as ref
    result = ref.run_paper_references(host_id)
    assert result["unresolved"] == 1 and result["edges"] == 0
    assert client[0].get(f"/api/papers/{host_id}/citations").json() == {
        "outgoing": [], "incoming": []}


# ---------- PDF attach ----------

def _pdf_bytes(title="Attached"):
    import fitz, tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as t:
        path = t.name
    try:
        doc = fitz.open()
        doc.new_page().insert_text((72, 72), f"{title} body text here.")
        doc.save(path)
        doc.close()
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.unlink(path)


def test_metadata_only_then_pdf(client, fakes):
    pid = _project(client)
    sid = client[0].post(f"/api/projects/{pid}/search/pubmed",
                         json={"query": "sleep"}).json()["search_id"]
    paper_id = client[0].post(
        "/api/search/import",
        json={"project_id": pid, "search_id": sid,
              "external_id": "pmid:222"}).json()["paper_id"]
    assert client[0].get(f"/api/papers/{paper_id}/chunks").json() == []
    r = client[0].post(f"/api/papers/{paper_id}/pdf",
                       files={"file": ("p.pdf", _pdf_bytes(), "application/pdf")})
    assert r.status_code == 200, r.text
    assert r.json()["source_pdf_path"] != ""
    assert len(client[0].get(f"/api/papers/{paper_id}/chunks").json()) >= 1
    land = client[0].get(f"/api/landscape/{pid}").json()
    node = next(n for n in land["nodes"] if n["id"] == paper_id)
    assert node["metadata_only"] is False
