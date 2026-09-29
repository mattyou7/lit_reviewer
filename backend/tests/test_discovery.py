"""Automatic landscape discovery: ONE seed -> bounded first-degree
channels (references / cited-by / semantic), provenance, dedupe,
similarity floor policy, truthful status, honest channel errors.

All provider traffic uses the repo's controlled fixtures (mocked HTTP +
SEARCH_FNS) — no live network. The live one-seed integration run is
performed by Liit/automatic_landscape_check.mjs (record mode) and is
reported separately.
"""
import json
import urllib.parse
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app import discovery
from backend.app import embeddings as emb_orch
from backend.app import extraction, synthesis
from backend.app import search as search_orch
from backend.app.database import connect
from src.embeddings.backends import HashEmbeddingBackend
from src.search.common import SearchError

# ---------- controlled provider payloads ----------

PUBMED_ESUMMARY = {"result": {
    "900": {"title": "Memory consolidation during sleep",
            "authors": [{"name": "Seed A"}], "source": "Neuron",
            "pubdate": "2024 Jan",
            "articleids": [{"idtype": "doi", "value": "10.1000/seed"}]},
    "111": {"title": "Sleep spindles and systems consolidation",
            "authors": [{"name": "Smith J"}, {"name": "Doe A"}],
            "source": "Neuron", "pubdate": "2021 May",
            "articleids": [{"idtype": "doi", "value": "10.1000/ABC"}]},
    "222": {"title": "Untitled pilot", "authors": [], "source": "Brain",
            "pubdate": "", "articleids": []},
    "uids": ["900", "111", "222"]}}
PUBMED_EFETCH = """<?xml version="1.0"?>
<PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID>900</PMID>
<Article><Abstract><AbstractText>Sleep consolidates memories.
</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID>111</PMID>
<Article><Abstract><AbstractText>Sleep helps memory.
</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID>222</PMID>
<Article></Article></MedlineCitation></PubmedArticle>
</PubmedArticleSet>"""

ELINK_CITEDIN = {"linksets": [{"ids": ["900"], "linksetdbs": [
    {"linkname": "pubmed_citedin", "links": ["222"]}]}]}

ARXIV_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
<entry><id>http://arxiv.org/abs/2401.00001v2</id>
<title>Attention Flows</title>
<author><name>Lee K</name></author><author><name>Park J</name></author>
<published>2024-01-15T00:00:00Z</published>
<summary>We study attention flow mechanisms in depth.
</summary>
<arxiv:doi>10.2000/xyz</arxiv:doi>
<arxiv:journal_ref>JMLR 2024</arxiv:journal_ref></entry>
</feed>"""


def _mock_http(url):
    if "elink" in url:
        return json.dumps(ELINK_CITEDIN).encode()
    if "esearch" in url:
        term = urllib.parse.parse_qs(
            urllib.parse.urlparse(url).query).get("term", [""])[0]
        if "10.1000/seed" in term:
            ids = ["900"]                    # the seed's own record
        elif "10.1000/abc" in term:
            ids = ["111"]                    # a resolvable reference
        elif "10.9999/none" in term:
            ids = []                         # not in PubMed
        else:
            ids = ["900", "111", "222"]      # semantic search results
        return json.dumps({"esearchresult": {"idlist": ids}}).encode()
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
def client(tmp_path, monkeypatch):
    db = tmp_path / "test.db"
    monkeypatch.setenv("LIT_REVIEW_DB", str(db))
    from backend.app.database import init_db
    from backend.app.main import app
    init_db(db)
    backend = HashEmbeddingBackend(dim=32)
    emb_orch.set_backend(backend)
    monkeypatch.setitem(search_orch.SEARCH_FNS, "pubmed", _fake_pubmed)
    monkeypatch.setitem(search_orch.SEARCH_FNS, "arxiv", _fake_arxiv)
    monkeypatch.setattr(discovery, "HTTP_GET", _mock_http)
    yield TestClient(app), backend
    emb_orch.set_backend(None)


def _project(client, name="P"):
    return client[0].post("/api/projects", json={"name": name}).json()["id"]


def _seed(client, pid, **fields):
    # mirrors the real seed path: upload creates the paper as user_import
    data = {"title": "Memory consolidation during sleep",
            "discovery_source_type": "user_import"}
    data.update(fields)
    r = client[0].post(f"/api/projects/{pid}/papers", json=data)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _seed_ref_section(paper_id, raw, page=3):
    conn = connect()
    try:
        conn.execute(
            "INSERT INTO paper_sections (id, paper_id, name, items_json,"
            " created_at) VALUES (?, ?, ?, ?, ?)",
            (f"{paper_id}:references", paper_id, "references",
             json.dumps([{"page": page, "text": raw}]),
             datetime.now(timezone.utc).isoformat()))
        conn.commit()
    finally:
        conn.close()


def _channel(status, name):
    return next(c for c in status["channels"] if c["channel"] == name)


def _cfg(monkeypatch, **overrides):
    cfg = discovery.load_landscape_config()
    cfg.update(overrides)
    monkeypatch.setattr(discovery, "load_landscape_config", lambda: cfg)
    return cfg


# ---------- run: channels + provenance ----------

def test_full_run_seed_reference_citedby_semantic(client, monkeypatch):
    """One seed with identifiers: all four channels run, nodes carry the
    right provenance types, edges carry mechanisms."""
    _cfg(monkeypatch, similarity_min=-1.0)  # keep every candidate
    pid = _project(client)
    seed = _seed(client, pid, doi="10.1000/seed")
    _seed_ref_section(seed, "[1] Smith J. Memory work. 2021. 10.1000/abc")
    from backend.app import references as ref
    assert ref.run_paper_references(seed)["edges"] == 0

    status = discovery.run_discovery(pid, seed)
    assert status["status"] == "complete"
    assert status["step"] == "landscape ready"

    # seed metadata resolved from the source (fill-empty only)
    meta = _channel(status, "seed_metadata")
    assert meta["status"] == "complete" and meta["source"] == "pubmed"
    paper = client[0].get(f"/api/papers/{seed}").json()
    assert paper["pmid"] == "900" and paper["abstract"]
    assert paper["title"] == "Memory consolidation during sleep"  # kept

    # citation discovery from the PDF reference
    refs = _channel(status, "references")
    assert refs["created"] == 1 and refs["resolved"] >= 1
    assert refs["edges"] >= 1

    # cited-by via PubMed ELink (seed gained pmid 900 above)
    cited = _channel(status, "cited_by")
    assert cited["source"] == "pubmed"
    assert cited["retrieved"] == 1 and cited["created"] == 1
    assert cited["edges"] == 1

    # semantic channels ran persisted searches
    pubmed_ch = [c for c in status["channels"]
                 if c["channel"] == "semantic_discovery"
                 and c["source"] == "pubmed"][0]
    arxiv_ch = [c for c in status["channels"]
                if c["channel"] == "semantic_discovery"
                and c["source"] == "arxiv"][0]
    assert pubmed_ch["status"] == "complete" and pubmed_ch["query"]
    assert pubmed_ch["excluded_self"] == 1   # 900 excluded by identity
    assert arxiv_ch["status"] == "complete"

    # one node per paper, one edge per relationship — no duplicates
    land = client[0].get(f"/api/landscape/{pid}").json()
    identifiers = [n["doi"] or n["pmid"] or n["arxiv_id"] or n["id"]
                   for n in land["nodes"]]
    assert len(identifiers) == len(set(identifiers))
    titles = [n["title"] for n in land["nodes"]]
    assert len(titles) == len(set(titles))
    assert len(land["nodes"]) == 4  # seed + 111 + 222 + arXiv paper

    cites = [e for e in land["edges"] if e["relationship"] == "cites"]
    assert any(e["mechanism"] == "reference_extraction" for e in cites)
    assert any(e["mechanism"] == "pubmed_citedin" for e in cites)
    sims = [e for e in land["edges"]
            if e["relationship"] == "semantic_similarity"]
    assert len(sims) == 3
    assert all(e["similarity"] is not None for e in sims)

    # provenance types per node (seed vs discovered)
    nodes = {n["id"]: n for n in land["nodes"]}
    seed_types = [d["type"] for d in nodes[seed]["discovery"]]
    assert "user_import" in seed_types
    by_doi = {n["doi"]: n for n in land["nodes"] if n["doi"]}
    ref_node = by_doi["10.1000/abc"]
    assert {d["type"] for d in ref_node["discovery"]} == {
        "citation_discovery", "semantic_discovery"}
    assert all(d["source_paper_id"] == seed
               for d in ref_node["discovery"])
    cited_node = next(n for n in land["nodes"] if n["pmid"] == "222"
                      and n["id"] != seed)
    assert {d["type"] for d in cited_node["discovery"]} == {
        "cited_by_discovery", "semantic_discovery"}


def test_dual_route_creates_one_node_two_routes(client, monkeypatch):
    """Same paper via reference lookup AND semantic search: one node,
    two provenance rows, one edge — never duplicated."""
    _cfg(monkeypatch, similarity_min=-1.0)
    pid = _project(client)
    seed = _seed(client, pid, doi="10.1000/seed")
    _seed_ref_section(seed, "[1] Smith J. Memory work. 2021. 10.1000/abc")
    from backend.app import references as ref
    ref.run_paper_references(seed)
    discovery.run_discovery(pid, seed)

    papers = client[0].get(f"/api/projects/{pid}/papers").json()
    # Discovered papers live in the Landscape, not the project
    # collection — find it via the landscape payload.
    land = client[0].get(f"/api/landscape/{pid}").json()
    matches = [n for n in land["nodes"]
               if (n["doi"] or "").lower() == "10.1000/abc"]
    assert len(matches) == 1
    # ...and it is NOT in the Library until explicitly added.
    assert not [p for p in papers
                if (p["doi"] or "").lower() == "10.1000/abc"]
    disc = client[0].get(
        f"/api/papers/{matches[0]['id']}/discovery").json()["discovery"]
    assert [d["type"] for d in disc] == ["citation_discovery",
                                         "semantic_discovery"]
    assert len(disc) == 2  # no duplicated route rows

    node_edges = [e for e in land["edges"]
                  if e["relationship"] == "cites"
                  and e["target"] == matches[0]["id"]]
    assert len(node_edges) == 1


def test_semantic_floor_gates_nodes_and_edges(client, monkeypatch):
    """No identifiers, no references: only semantic channels act.
    Floor keeps/ drops candidates exactly per the documented policy."""
    pid = _project(client)
    seed = _seed(client, pid)  # plain seed, no identifiers

    # floor = 1.0: no distinct text can pass -> zero nodes, counts honest
    _cfg(monkeypatch, similarity_min=1.0)
    status = discovery.run_discovery(pid, seed)
    assert status["status"] == "complete"
    assert _channel(status, "seed_metadata")["status"] == "skipped"
    assert _channel(status, "references")["status"] == "skipped"
    assert _channel(status, "cited_by")["status"] == "skipped"
    pubmed_ch = [c for c in status["channels"]
                 if c["channel"] == "semantic_discovery"
                 and c["source"] == "pubmed"][0]
    assert pubmed_ch["retrieved"] == 3
    assert pubmed_ch["excluded_self"] == 1   # own title, not created
    assert pubmed_ch["created"] == 0
    assert pubmed_ch["below_threshold"] == 2
    land = client[0].get(f"/api/landscape/{pid}").json()
    assert len(land["nodes"]) == 1            # seed only
    assert not [e for e in land["edges"]
                if e["relationship"] == "semantic_similarity"]

    # floor = -1.0: every candidate becomes a node + stored pair
    _cfg(monkeypatch, similarity_min=-1.0)
    status = discovery.run_discovery(pid, seed)
    pubmed_ch = [c for c in status["channels"]
                 if c["channel"] == "semantic_discovery"
                 and c["source"] == "pubmed"][0]
    arxiv_ch = [c for c in status["channels"]
                if c["channel"] == "semantic_discovery"
                and c["source"] == "arxiv"][0]
    assert pubmed_ch["created"] == 2 and arxiv_ch["created"] == 1
    land = client[0].get(f"/api/landscape/{pid}").json()
    assert len(land["nodes"]) == 4
    sims = [e for e in land["edges"]
            if e["relationship"] == "semantic_similarity"]
    assert len(sims) == 3                    # seed-first-degree only
    assert all(e["similarity"] >= -1.0 for e in sims)

    # provenance carries query + seed + persisted search id
    node = next(n for n in land["nodes"] if n["pmid"] == "111")
    item = next(d for d in node["discovery"]
                if d["type"] == "semantic_discovery")
    assert item["query"] and item["source_paper_id"] == seed
    assert item["search_id"] and item["source"] == "pubmed"
    searches = client[0].get(f"/api/projects/{pid}/searches").json()
    assert {s["source"] for s in searches} == {"pubmed", "arxiv"}


def test_channel_errors_reported_honestly(client, monkeypatch):
    """Provider failure never fails silently and never fakes results:
    the run finishes, every failure is in its channel, the status API
    exposes it (what the UI banner shows)."""
    def down(*args, **kwargs):
        raise SearchError("NCBI network failure: down")
    monkeypatch.setitem(search_orch.SEARCH_FNS, "pubmed", down)
    monkeypatch.setitem(search_orch.SEARCH_FNS, "arxiv", down)
    monkeypatch.setattr(discovery, "HTTP_GET", down)
    pid = _project(client)
    # seed has a PMID: identifier lookup and cited-by both attempt and
    # both fail honestly
    seed = _seed(client, pid, doi="10.1000/seed", pmid="900")
    _seed_ref_section(seed, "[1] Smith J. 2021. 10.1000/abc")
    from backend.app import references as ref
    ref.run_paper_references(seed)

    status = discovery.run_discovery(pid, seed)
    assert status["status"] == "complete"     # run finished
    assert status["step"] == "landscape ready"
    assert _channel(status, "seed_metadata")["error"]  # surfaced
    refs = _channel(status, "references")
    assert refs["errors"] and "10.1000/abc" in refs["errors"][0]
    assert _channel(status, "cited_by")["status"] == "error"
    for source in ("pubmed", "arxiv"):
        ch = [c for c in status["channels"]
              if c["channel"] == "semantic_discovery"
              and c["source"] == source][0]
        assert ch["status"] == "error" and ch["error"]
        assert ch["created"] == 0             # no faked nodes
    # nothing was discovered
    papers = client[0].get(f"/api/projects/{pid}/papers").json()
    assert len(papers) == 1

    # same facts visible through the status endpoint (UI source)
    api_status = client[0].get(
        f"/api/projects/{pid}/landscape/status").json()
    assert api_status["status"] == "complete"
    assert any(c["error"] or c["errors"] for c in api_status["channels"])
    assert api_status["policy"]["similarity_min"] == 0.3


def test_status_endpoint_idle_then_running_then_complete(client,
                                                          monkeypatch):
    _cfg(monkeypatch, similarity_min=-1.0)
    pid = _project(client)
    seed = _seed(client, pid, doi="10.1000/seed")
    idle = client[0].get(f"/api/projects/{pid}/landscape/status").json()
    assert idle["status"] == "idle" and idle["channels"] == []

    r = client[0].post(f"/api/projects/{pid}/discover",
                       json={"seed_paper_id": seed})
    assert r.status_code == 200, r.text
    assert r.json()["status"] in ("running", "complete")
    # TestClient runs the background build before returning here
    done = client[0].get(
        f"/api/projects/{pid}/landscape/status").json()
    assert done["status"] == "complete"
    assert done["seed_paper_id"] == seed
    assert done["step"] == "landscape ready"

    # discover without any PDF seed -> explicit 422, not a guess
    pid2 = _project(client, "no-pdf")
    r = client[0].post(f"/api/projects/{pid2}/discover", json={})
    assert r.status_code == 422


def test_pre_trigger_seed_recovered_by_discover_without_explicit_id(
        client, monkeypatch):
    """REGRESSION for the observed "1 node / 0 edges" landscape: a
    project whose automatic build NEVER ran (no run record — the paper
    entered before the trigger existed, or via an explicit import)
    reports idle forever. The UI's labelled recovery action sends an
    EMPTY seed id, so the endpoint must find the PDF-backed seed on its
    own, run the build, and leave a multi-paper landscape — without any
    second upload and without touching trigger semantics elsewhere."""
    _cfg(monkeypatch, similarity_min=-1.0)
    pid = _project(client)
    seed = _seed(client, pid, doi="10.1000/seed")
    # the seed is PDF-backed (the stored-path flag is what the endpoint
    # selects on; PDF bytes themselves are not needed for this state)
    conn = connect()
    try:
        conn.execute(
            "UPDATE papers SET source_pdf_path=? WHERE id=?",
            ("data/papers/paper_pre_trigger/original.pdf", seed))
        conn.commit()
    finally:
        conn.close()

    # the exact observed bug state: no run record -> idle, one paper
    idle = client[0].get(f"/api/projects/{pid}/landscape/status").json()
    assert idle["status"] == "idle" and idle["seed_paper_id"] == ""
    land = client[0].get(f"/api/landscape/{pid}").json()
    assert len(land["nodes"]) == 1 and land["edges"] == []

    # the labelled UI action (empty seed id) must recover: background
    # build runs (TestClient executes it before returning) to completion
    r = client[0].post(f"/api/projects/{pid}/discover",
                       json={"seed_paper_id": ""})
    assert r.status_code == 200, r.text
    assert r.json()["seed_paper_id"] == seed
    done = client[0].get(f"/api/projects/{pid}/landscape/status").json()
    assert done["status"] == "complete"
    assert done["seed_paper_id"] == seed and done["step"] == "landscape ready"

    # no longer the stuck state: real discovered papers, typed provenance
    land = client[0].get(f"/api/landscape/{pid}").json()
    assert len(land["nodes"]) >= 2
    assert land["edges"]
    other = next(n for n in land["nodes"] if n["id"] != seed)
    disc = client[0].get(f"/api/papers/{other['id']}"
                         "/discovery").json()["discovery"]
    assert any(d["type"] in ("cited_by_discovery", "semantic_discovery")
               for d in disc)


def test_no_llm_runs_during_discovery(client, monkeypatch):
    """Extraction/synthesis/repair are unreachable during automatic
    discovery — metadata, retrieval and embeddings only."""
    def boom(*args, **kwargs):
        raise AssertionError("LLM path invoked during discovery")
    monkeypatch.setattr(extraction, "get_backend", boom)
    monkeypatch.setattr(synthesis, "get_backend", boom)
    monkeypatch.setattr(extraction, "run_paper_extraction", boom)
    monkeypatch.setattr(synthesis, "run_paper_synthesis", boom)
    _cfg(monkeypatch, similarity_min=-1.0)
    pid = _project(client)
    seed = _seed(client, pid, doi="10.1000/seed")
    _seed_ref_section(seed, "[1] Smith J. 2021. 10.1000/abc")
    from backend.app import references as ref
    ref.run_paper_references(seed)
    status = discovery.run_discovery(pid, seed)
    assert status["status"] == "complete"

    land = client[0].get(f"/api/landscape/{pid}").json()
    discovered = [n for n in land["nodes"] if n["id"] != seed]
    assert discovered
    for node in discovered:
        paper = client[0].get(f"/api/papers/{node['id']}").json()
        assert paper["extraction_status"] == "pending"  # never run
        assert paper["source_pdf_path"] == ""           # no PDF fetched
        assert client[0].get(
            f"/api/papers/{node['id']}/chunks").json() == []
        assert node["metadata_only"] is True            # landscape view


def test_reference_cap_bounds_lookups(client, monkeypatch):
    """Per-channel cap from config is respected (bounded discovery)."""
    _cfg(monkeypatch, max_reference_resolutions=1)
    pid = _project(client)
    seed = _seed(client, pid, doi="10.1000/seed")
    now = datetime.now(timezone.utc).isoformat()
    conn = connect()
    try:
        for i, doi in enumerate(["10.1000/abc", "10.9999/none"]):
            conn.execute(
                """INSERT INTO paper_references
                   (id, paper_id, ref_index, raw_text, title, authors_json,
                    year, journal, doi, pmid, arxiv_id, source_page,
                    resolution_status, resolved_paper_id, created_at)
                   VALUES (?, ?, ?, ?, '', '[]', 2021, '', ?, '', '', 3,
                           'unresolved', '', ?)""",
                (f"{seed}:ref:{i:03d}", seed, i, f"[{i + 1}] {doi}",
                 doi, now))
        conn.commit()
    finally:
        conn.close()
    status = discovery.run_discovery(pid, seed)
    refs = _channel(status, "references")
    assert refs["retrieved"] == 1   # second reference never looked up
    assert refs["created"] == 1


def test_seed_query_is_deterministic_metadata():
    # first three significant terms, AND-joined, metadata-only
    terms = '"Sleep"[Title/Abstract] AND "Memory"[Title/Abstract]' \
        ' AND "Review"[Title/Abstract]'
    assert discovery.seed_query(
        {"title": "The Sleep of Memory: A Review of Consolidation",
         "abstract": "Unrelated filler words here."}) == terms
    # arXiv gets the same three terms as quoted free text
    # (its caller prefixes `all:`)
    assert discovery.seed_query(
        {"title": "The Sleep of Memory: A Review of Consolidation",
         "abstract": ""}, source="arxiv") == \
        '"Sleep" AND "Memory" AND "Review"'
    assert discovery.seed_query({"title": "UNSET", "abstract": ""}) == ""
    # "during" is a stopword — dropped deterministically
    assert discovery.seed_query(
        {"title": "", "abstract": "hippocampal replay during rest"}) == \
        '"hippocampal"[Title/Abstract] AND "replay"[Title/Abstract]' \
        ' AND "rest"[Title/Abstract]'


def test_schedule_build_seam_and_config_flag(monkeypatch):
    # restore the real seam (the autouse fixture neuters it for
    # every other test — here we test its actual behavior)
    monkeypatch.setattr(discovery, "schedule_build",
                        discovery._REAL_SCHEDULE_BUILD)

    class BG:
        def __init__(self):
            self.tasks = []
        def add_task(self, fn, *args):
            self.tasks.append((fn, args))
    bg = BG()
    assert discovery.schedule_build(bg, "p1", "s1") is True
    assert len(bg.tasks) == 1 and bg.tasks[0][1] == ("p1", "s1")
    _cfg(monkeypatch, auto_discover=False)
    assert discovery.schedule_build(bg, "p2", "s2") is False
    assert len(bg.tasks) == 1


def test_record_discovery_once_idempotent(client):
    pid = _project(client)
    seed = _seed(client, pid)
    assert discovery.record_discovery_once(
        seed, "semantic_discovery", "q", "s1", "search_1", "ext:1")
    assert not discovery.record_discovery_once(
        seed, "semantic_discovery", "q", "s1", "search_1", "ext:1")
    assert discovery.record_discovery_once(
        seed, "semantic_discovery", "q", "s2", "search_2", "ext:1")
    items = client[0].get(
        f"/api/papers/{seed}/discovery").json()["discovery"]
    assert len(items) == 2  # distinct routes accumulate, dupes do not
