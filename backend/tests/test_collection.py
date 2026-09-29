"""Project collection membership: DISCOVERED != ADDED TO PROJECT.

The Landscape (discovery surface) and the Library (project collection)
are explicitly separated:
  * explicit upload/import/create -> in the collection (Library)
  * automatic discovery          -> Landscape only, NOT in the Library
  * [Add to Project] single/bulk -> membership only: provenance, nodes,
    and edges preserved; idempotent; immediate status change
  * Remove membership            -> leaves the Library; the Landscape
    node and its relationships are never destroyed
PubMed publication types (pubtype) are parsed from real esummary
metadata: retraction state is True/False only when the source typed the
record, None ("unavailable") otherwise; citation counts are never
fabricated (always None).
All provider traffic uses controlled fixtures — no live network.
"""
import json
import urllib.parse
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app import discovery, embeddings as emb_orch
from backend.app import references as ref
from backend.app import search as search_orch
from backend.app.database import connect
from src.embeddings.backends import HashEmbeddingBackend

# ---------- controlled provider payloads ----------

PUBMED_ESUMMARY = {"result": {
    "900": {"title": "Memory consolidation during sleep",
            "authors": [{"name": "Seed A"}], "source": "Neuron",
            "pubdate": "2024 Jan", "pubtype": ["Journal Article"],
            "articleids": [{"idtype": "doi", "value": "10.1000/seed"}]},
    "111": {"title": "Sleep spindles and systems consolidation",
            "authors": [{"name": "Smith J"}, {"name": "Doe A"}],
            "source": "Neuron", "pubdate": "2021 May",
            "pubtype": ["Review"],
            "articleids": [{"idtype": "doi", "value": "10.1000/ABC"}]},
    "222": {"title": "Retracted pilot study", "authors": [],
            "source": "Brain", "pubdate": "2019",
            "pubtype": ["Retracted Publication"],
            "articleids": [{"idtype": "doi", "value": "10.9999/ret"}]},
    "uids": ["900", "111", "222"]}}
PUBMED_EFETCH = """<?xml version="1.0"?>
<PubmedArticleSet>
<PubmedArticle><MedlineCitation><PMID>900</PMID>
<Article><ArticleTitle>Memory consolidation during sleep</ArticleTitle>
<Abstract><AbstractText>Seed abstract.</AbstractText></Abstract>
</Article></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID>111</PMID>
<Article><ArticleTitle>Sleep spindles and systems consolidation</ArticleTitle>
<Abstract><AbstractText>Reference abstract.</AbstractText></Abstract>
</Article></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID>222</PMID>
<Article><ArticleTitle>Retracted pilot study</ArticleTitle>
</Article></MedlineCitation></PubmedArticle>
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
            ids = ["900"]
        elif "10.1000/abc" in term:
            ids = ["111"]
        elif "10.9999/ret" in term:
            ids = ["222"]
        else:
            ids = ["900", "111", "222"]
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


def _cfg(monkeypatch, **overrides):
    cfg = discovery.load_landscape_config()
    cfg.update(overrides)
    monkeypatch.setattr(discovery, "load_landscape_config", lambda: cfg)
    return cfg


def _project(client, name="P"):
    return client[0].post("/api/projects", json={"name": name}).json()["id"]


def _seed(client, pid, **fields):
    """Mirrors the real seed path: upload creates the paper as
    user_import (explicit -> in the project collection)."""
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


def _discovered_landscape(client, monkeypatch):
    """One seed -> full discovery run. Returns (pid, seed_id, land)."""
    _cfg(monkeypatch, similarity_min=-1.0)
    pid = _project(client)
    seed = _seed(client, pid, doi="10.1000/seed")
    _seed_ref_section(seed, "[1] Smith J. Memory work. 2021. 10.1000/abc")
    assert ref.run_paper_references(seed)["edges"] == 0
    status = discovery.run_discovery(pid, seed)
    assert status["status"] == "complete"
    land = client[0].get(f"/api/landscape/{pid}").json()
    return pid, seed, land


def _by_doi(land, doi):
    return next(n for n in land["nodes"]
                if (n["doi"] or "").lower() == doi)


# ---------- 1. discovery creates Landscape nodes, NOT collection members ----------

def test_discovery_is_not_added_to_project(client, monkeypatch):
    pid, seed, land = _discovered_landscape(client, monkeypatch)
    assert len(land["nodes"]) == 4  # seed + 3 discovered

    # Library contains ONLY the explicitly added seed.
    lib = client[0].get(f"/api/projects/{pid}/papers").json()
    assert [p["id"] for p in lib] == [seed]
    assert lib[0]["in_project"] is True

    # Every discovered node is present in the Landscape and flagged
    # as not-in-project; the seed is flagged in-project.
    assert len(land["nodes"]) == 4
    flags = {n["id"]: n["in_project"] for n in land["nodes"]}
    assert flags[seed] is True
    assert all(flag is False for nid, flag in flags.items()
               if nid != seed)

    # Provenance and relationships fully intact on discovered nodes.
    ref_node = _by_doi(land, "10.1000/abc")
    assert {d["type"] for d in ref_node["discovery"]} == {
        "citation_discovery", "semantic_discovery"}
    assert any(e["relationship"] == "cites" for e in land["edges"])


# ---------- 2. explicit [Add to Project]: membership only, idempotent ----------

def test_add_to_project_preserves_provenance_and_edges(client, monkeypatch):
    pid, seed, land = _discovered_landscape(client, monkeypatch)
    ref_node = _by_doi(land, "10.1000/abc")
    edges_before = sorted((e["source"], e["target"], e["relationship"])
                          for e in land["edges"])
    disc_before = [(d["type"], d["source_paper_id"])
                   for d in ref_node["discovery"]]

    r = client[0].post(
        f"/api/projects/{pid}/papers/{ref_node['id']}/collection")
    assert r.status_code == 200, r.text
    assert r.json()["in_project"] is True

    # Now in the Library — same single row, no duplicates.
    lib = client[0].get(f"/api/projects/{pid}/papers").json()
    assert sorted(p["id"] for p in lib) == sorted([seed, ref_node["id"]])

    # Still in the Landscape with provenance + edges unchanged.
    land2 = client[0].get(f"/api/landscape/{pid}").json()
    assert len(land2["nodes"]) == len(land["nodes"])
    node2 = next(n for n in land2["nodes"] if n["id"] == ref_node["id"])
    assert node2["in_project"] is True
    assert [(d["type"], d["source_paper_id"])
            for d in node2["discovery"]] == disc_before
    assert sorted((e["source"], e["target"], e["relationship"])
                  for e in land2["edges"]) == edges_before

    # Idempotent: second add reports no change (via bulk endpoint).
    r2 = client[0].post(f"/api/projects/{pid}/collection",
                        json={"paper_ids": [ref_node["id"]]})
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["added"] == 0 and body["already_in_project"] == 1
    assert body["project_name"] == "P"


# ---------- 3. bulk add with honest counts ----------

def test_bulk_add_to_project(client, monkeypatch):
    pid, seed, land = _discovered_landscape(client, monkeypatch)
    discovered = [n["id"] for n in land["nodes"] if n["id"] != seed]
    assert len(discovered) == 3

    r = client[0].post(f"/api/projects/{pid}/collection",
                       json={"paper_ids": discovered + ["paper_missing"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["added"] == 3
    assert body["already_in_project"] == 0
    assert body["not_found"] == ["paper_missing"]

    # Library now shows all four; Landscape unchanged (4 nodes, same edges).
    lib = client[0].get(f"/api/projects/{pid}/papers").json()
    assert len(lib) == 4
    land2 = client[0].get(f"/api/landscape/{pid}").json()
    assert len(land2["nodes"]) == 4
    assert len(land2["edges"]) == len(land["edges"])

    # Re-running the same bulk add is idempotent.
    again = client[0].post(f"/api/projects/{pid}/collection",
                           json={"paper_ids": discovered}).json()
    assert again["added"] == 0 and again["already_in_project"] == 3


# ---------- 4. removing membership never destroys the Landscape ----------

def test_remove_membership_keeps_landscape_intact(client, monkeypatch):
    pid, seed, land = _discovered_landscape(client, monkeypatch)
    ref_node = _by_doi(land, "10.1000/abc")
    client[0].post(
        f"/api/projects/{pid}/papers/{ref_node['id']}/collection")

    r = client[0].delete(
        f"/api/projects/{pid}/papers/{ref_node['id']}/collection")
    assert r.status_code == 200, r.text
    assert r.json()["in_project"] is False

    # Out of the Library...
    lib = client[0].get(f"/api/projects/{pid}/papers").json()
    assert [p["id"] for p in lib] == [seed]

    # ...but the Landscape node, its provenance, and its edges survive.
    land2 = client[0].get(f"/api/landscape/{pid}").json()
    assert len(land2["nodes"]) == 4
    assert len(land2["edges"]) == len(land["edges"])
    node2 = next(n for n in land2["nodes"] if n["id"] == ref_node["id"])
    assert node2["in_project"] is False
    assert {d["type"] for d in node2["discovery"]} == {
        "citation_discovery", "semantic_discovery"}
    assert client[0].get(
        f"/api/papers/{ref_node['id']}").status_code == 200

    # Unknown ids / foreign projects are reported honestly.
    bad = client[0].post(f"/api/projects/{pid}/papers/paper_nope/collection")
    assert bad.status_code == 404


# ---------- 5. metadata honesty: pub types, retraction, citation count ----------

def test_publication_types_and_retraction_state(client, monkeypatch):
    pid, seed, land = _discovered_landscape(client, monkeypatch)
    nodes = {n["id"]: n for n in land["nodes"]}

    # PubMed-typed records carry their real publication types.
    assert nodes[seed]["pub_types"] == ["Journal Article"]
    review = _by_doi(land, "10.1000/abc")
    assert review["pub_types"] == ["Review"]
    retracted = next(n for n in land["nodes"] if n["pmid"] == "222")
    assert retracted["pub_types"] == ["Retracted Publication"]
    assert retracted["retracted"] is True
    # Typed records that are not retracted: source supports the claim.
    assert nodes[seed]["retracted"] is False
    assert review["retracted"] is False
    # arXiv record: no PubMed typing — status unavailable, not "safe".
    arxiv = next(n for n in land["nodes"] if n["arxiv_id"])
    assert arxiv["pub_types"] == []
    assert arxiv["retracted"] is None

    # No citation-count source exists: never fabricated as 0.
    assert all(n["citation_count"] is None for n in land["nodes"])

    # Exclude-retracted filter input: only the PubMed-flagged node is
    # actually retracted (the filter's client behavior is checked by
    # Liit/landscape_workspace_check.mjs).
    assert [n["id"] for n in land["nodes"] if n["retracted"] is True] \
        == [retracted["id"]]


def test_import_promotes_discovered_paper_to_collection(client, monkeypatch):
    """Explicit import is a user action: "seed / imports are In Project".

    When identity-dedup lands on a paper that automatic discovery only
    surfaced (in_project=0), the import makes it a collection member —
    membership only: no duplicate Landscape node, and the first-discovery
    provenance is never rewritten."""
    from src.search.common import SearchResult

    pid, seed, land = _discovered_landscape(client, monkeypatch)
    disc = _by_doi(land, "10.1000/abc")
    node_id = disc["id"]
    assert not disc["in_project"]          # discovered only, NOT a member
    coll_before = {p["id"] for p in
                   client[0].get(f"/api/projects/{pid}/papers").json()}
    assert node_id not in coll_before and seed in coll_before
    first_type = client[0].get(f"/api/papers/{node_id}").json()[
        "discovery_source_type"]

    # The explicit PubMed search returns exactly that paper (same DOI).
    monkeypatch.setitem(search_orch.SEARCH_FNS, "pubmed",
                        lambda q, m=20, *a: [SearchResult(
                            external_id="pmid:111", source="pubmed",
                            doi="10.1000/ABC",
                            title="Sleep spindles and systems consolidation",
                            authors=["Smith J"])])
    sid = client[0].post(f"/api/projects/{pid}/search/pubmed",
                         json={"query": "sleep"}).json()["search_id"]
    r = client[0].post("/api/search/import",
                       json={"project_id": pid, "search_id": sid,
                             "external_id": "pmid:111"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] is False            # dedup: no second row
    assert body["paper_id"] == node_id

    # Import => collection member, provenance untouched, node not duplicated.
    paper = client[0].get(f"/api/papers/{node_id}").json()
    assert paper["in_project"] is True
    assert paper["discovery_source_type"] == first_type
    coll_after = {p["id"] for p in
                  client[0].get(f"/api/projects/{pid}/papers").json()}
    assert coll_after == coll_before | {node_id}
    land2 = client[0].get(f"/api/landscape/{pid}").json()
    assert len(land2["nodes"]) == len(land["nodes"])
    assert len({n["id"] for n in land2["nodes"]}) == len(land2["nodes"])
