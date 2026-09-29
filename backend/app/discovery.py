"""Automatic first-degree landscape construction around ONE seed paper.

When a PDF enters a project (upload or attach), this module runs
without any user-triggered embed/import/"build landscape" step:

  1. seed metadata   resolve the seed's identifiers against PubMed/arXiv
                     (fill-empty-only) to pick up PMID + abstract.
  2. references      PDF reference identifiers (DOI/arXiv) resolved
                     against PubMed/arXiv -> citation_discovery nodes;
                     references.resolve_references(seed) then creates the
                     'cites' edges through the existing edge code.
  3. cited-by        PubMed ELink pubmed_citedin -> cited_by_discovery
                     nodes + citer->seed 'cites' edges (source
                     'pubmed_citedin'). arXiv exposes no cited-by API —
                     that channel is honestly skipped, never fabricated.
  4. semantic        a deterministic title/abstract term query (no LLM,
                     no ranking) run on PubMed and arXiv through the
                     persisted search path -> dedupe -> embed locally ->
                     cosine(seed, candidate); a node and a stored
                     similarity pair are created only for candidates at
                     or above the configured floor (pipeline.yaml).

Bounded and first-degree only: per-channel caps come from the
`landscape:` block of config/pipeline.yaml; discovered papers are never
recursed into (no PDFs are fetched, no reference sections mined for
them). NO LLM extraction/synthesis/repair runs here — metadata,
network retrieval and local CPU embeddings only; deep analysis stays an
explicit user action.

Provenance: every discovered node gets an append-once paper_discovery
row (source_type, query, source_paper_id=seed, search_id, external_id),
so one node can carry several discovery routes without duplicated rows.
Run state is written to landscape_runs so the UI can show truthful
building states (running + step + per-channel outcomes/errors).
"""
from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import embeddings, landscape, metadata, references, search, store
from .database import connect
from src.search.arxiv import fetch_arxiv_ids
from src.search.common import SearchError, SearchResult
from src.search.pubmed import cited_by_pmids, fetch_pubmed, search_pubmed

CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "pipeline.yaml"

# One landscape build at a time (uploads can arrive back to back).
_BUILD_LOCK = threading.Lock()

# Optional HTTP seam for tests: None -> the real (possibly
# record/replay-routed) transport. Production never sets this.
HTTP_GET = None


def load_landscape_config() -> dict:
    defaults = {"auto_discover": True, "max_reference_resolutions": 15,
                "max_cited_by": 10, "max_candidates_pubmed": 10,
                "max_candidates_arxiv": 10, "similarity_min": 0.30}
    try:
        import yaml  # type: ignore
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        saved = cfg.get("landscape", {}) or {}
        out = dict(defaults)
        for key in defaults:
            if key in saved:
                out[key] = type(defaults[key])(saved[key])
        return out
    except Exception:
        return defaults


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_auto(msg: str) -> None:
    """Console trace for the automatic-discovery path, visible in the
    uvicorn terminal. Real states and counts only — never fabricated
    progress or percentages."""
    print(f"[AUTO-DISCOVERY] {msg}", flush=True)


# ---------------- run state (landscape_runs) ----------------

def start_run(project_id: str, seed_paper_id: str):
    now = _now()
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO landscape_runs
               (project_id, seed_paper_id, status, step, report_json,
                error, started_at, updated_at)
               VALUES (?, ?, 'running', '', '{}', '', ?, ?)
               ON CONFLICT(project_id) DO UPDATE SET
                 seed_paper_id=excluded.seed_paper_id,
                 status='running', step='', report_json='{}', error='',
                 started_at=excluded.started_at,
                 updated_at=excluded.updated_at""",
            (project_id, seed_paper_id, now, now))
        conn.commit()
    finally:
        conn.close()


def update_run(project_id: str, *, status: str | None = None,
               step: str | None = None, report: dict | None = None,
               error: str | None = None):
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM landscape_runs WHERE project_id=?",
            (project_id,)).fetchone()
        if row is None:
            return
        current = dict(row)
        conn.execute(
            """UPDATE landscape_runs SET status=?, step=?, report_json=?,
               error=?, updated_at=? WHERE project_id=?""",
            (status if status is not None else current["status"],
             step if step is not None else current["step"],
             json.dumps(report) if report is not None
             else current["report_json"],
             error if error is not None else current["error"],
             _now(), project_id))
        conn.commit()
    finally:
        conn.close()


def get_status(project_id: str) -> dict:
    """Truthful build state for the UI: idle until a build runs."""
    cfg = load_landscape_config()
    policy = {"similarity_min": cfg["similarity_min"],
              "max_reference_resolutions": cfg["max_reference_resolutions"],
              "max_cited_by": cfg["max_cited_by"],
              "max_candidates_pubmed": cfg["max_candidates_pubmed"],
              "max_candidates_arxiv": cfg["max_candidates_arxiv"]}
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM landscape_runs WHERE project_id=?",
            (project_id,)).fetchone()
    finally:
        conn.close()
    if row is None:
        return {"project_id": project_id, "seed_paper_id": "",
                "status": "idle", "step": "", "channels": [],
                "policy": policy, "error": "", "started_at": "",
                "updated_at": ""}
    current = dict(row)
    try:
        report = json.loads(current["report_json"] or "{}")
    except Exception:
        report = {}
    return {"project_id": project_id,
            "seed_paper_id": current["seed_paper_id"],
            "status": current["status"], "step": current["step"],
            "channels": report.get("channels", []),
            "policy": report.get("policy", policy),
            "error": current["error"],
            "started_at": current["started_at"],
            "updated_at": current["updated_at"]}


# ---------------- scheduling seam ----------------

def schedule_build(background_tasks, project_id: str,
                   seed_paper_id: str) -> bool:
    """Register the automatic build after a seed PDF enters the project.
    Runs after the response is sent — upload stays responsive; the UI
    polls landscape status for truthful building states. The unit-test
    suite neuters this seam (network isolation); the e2e check drives
    the real trigger."""
    if not load_landscape_config()["auto_discover"]:
        return False
    log_auto(f"triggered project_id={project_id} "
             f"seed_paper_id={seed_paper_id}")
    background_tasks.add_task(run_build, project_id, seed_paper_id)
    return True


def run_build(project_id: str, seed_paper_id: str) -> dict | None:
    with _BUILD_LOCK:
        try:
            return run_discovery(project_id, seed_paper_id)
        except Exception as e:
            log_auto(f"failed project_id={project_id} "
                     f"error={type(e).__name__}: {e}")
            try:
                update_run(project_id, status="error",
                           error=f"{type(e).__name__}: {e}")
            except Exception:
                pass
            return None


# ---------------- channel helpers ----------------

def _channel(name: str, source: str, status: str = "complete",
             **kw) -> dict:
    out = {"channel": name, "source": source, "status": status,
           "detail": "", "query": "", "search_id": "",
           "retrieved": 0, "created": 0, "edged": 0,
           "below_threshold": 0, "duplicates": 0, "excluded_self": 0,
           "skipped": 0, "unresolved": 0, "resolved": 0, "edges": 0,
           "error": "", "errors": []}
    out.update(kw)
    return out


_STOPWORDS = {
    "a", "an", "the", "of", "for", "and", "or", "in", "on", "with",
    "to", "by", "from", "at", "as", "is", "are", "be", "via", "using",
    "into", "over", "under", "after", "before", "between", "during",
    "without", "within", "from",
}


def _significant_terms(text: str, limit: int) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9-]{2,}", text or "")
    terms: list[str] = []
    seen: set[str] = set()
    for word in words:
        key = word.lower()
        if key in _STOPWORDS or key in seen:
            continue
        seen.add(key)
        terms.append(word)
        if len(terms) >= limit:
            break
    return terms


def seed_query(seed: dict, source: str = "pubmed") -> str:
    """Deterministic metadata query for semantic discovery: the first
    three significant seed-title terms (stopwords removed, first-seen
    order, no scoring), topped up from the abstract when the title
    yields fewer.

    Terms are AND-joined — PubMed as quoted Title/Abstract terms,
    arXiv as quoted free text (its caller prefixes `all:`). OR-ing
    every title word matches millions of loosely-related records and
    AND-ing all eight matches none; three distinctive leading terms
    retrieve the on-topic set that the cosine floor
    (`similarity_min`) then filters after local embedding. Empty
    when there is no usable metadata — the channel is then
    skipped."""
    title = (seed.get("title") or "").strip()
    terms = [] if title in ("", "UNSET") else _significant_terms(title, 8)
    if len(terms) < 3:
        abstract = (seed.get("abstract") or "").strip()
        if abstract:
            extra = _significant_terms(abstract, 8)
            known = {t.lower() for t in terms}
            for term in extra:
                if term.lower() not in known:
                    terms.append(term)
                    known.add(term.lower())
                if len(terms) >= 8:
                    break
    terms = terms[:3]
    if not terms:
        return ""
    if source == "pubmed":
        return " AND ".join(f'"{t}"[Title/Abstract]' for t in terms)
    return " AND ".join(f'"{t}"' for t in terms)


def _norm_title(title: str) -> str:
    return " ".join((title or "").lower().split())


def _same_identity(a: dict, b: dict) -> bool:
    for key in ("doi", "pmid", "arxiv_id"):
        va = (a.get(key) or "").strip().lower()
        vb = (b.get(key) or "").strip().lower()
        if va and vb and va == vb:
            return True
    return False


def _candidate_repr(row: dict) -> str:
    """Mirrors embeddings.build_representation for a paper with no
    synthesis/chunks: title + abstract, same join, same cap."""
    parts = [row.get("title", "") or "", row.get("abstract", "") or ""]
    return "\n\n".join(p for p in parts if p)[:embeddings.REPR_CAP]


# ---------------- dedupe / provenance ----------------

def _find_existing(project_id: str, row: dict) -> str:
    """Project paper matching an external row, or ''."""
    found = search.find_paper_by_identity(
        project_id, row.get("pmid", "") or "",
        row.get("doi", "") or "", row.get("arxiv_id", "") or "")
    if found is not None:
        return found["id"]
    # Title fallback for external search rows only: exact normalized
    # title against exactly one project paper; multiple matches refuse
    # to choose (same rule as DOI ambiguity).
    title = _norm_title(row.get("title", ""))
    if not title or title == "unset":
        return ""
    hits = [p for p in store.list_papers(project_id)
            if _norm_title(p.get("title", "")) == title]
    if len(hits) == 1:
        return hits[0]["id"]
    return ""


def record_discovery_once(paper_id: str, source_type: str, query: str,
                          seed_paper_id: str, search_id: str,
                          external_id: str) -> bool:
    """Append a discovery route only when that exact route is not yet
    recorded (append-only provenance, never duplicated rows)."""
    conn = connect()
    try:
        existing = conn.execute(
            """SELECT id FROM paper_discovery
               WHERE paper_id=? AND source_type=? AND query=?
               AND source_paper_id=? AND search_id=? AND external_id=?""",
            (paper_id, source_type, query or "", seed_paper_id or "",
             search_id or "", external_id or "")).fetchone()
    finally:
        conn.close()
    if existing is not None:
        return False
    search.record_discovery(paper_id, source_type, query=query,
                            source_paper_id=seed_paper_id,
                            search_id=search_id, external_id=external_id)
    return True


def ensure_paper(project_id: str, row: dict, source_type: str,
                 seed_id: str, query: str, search_id: str,
                 external_id: str) -> tuple[str, bool]:
    """Create-or-dedupe one project paper + append its provenance row.
    No PDF, no ingest, no LLM — metadata row only."""
    existing_id = _find_existing(project_id, row)
    created = False
    if existing_id:
        paper_id = existing_id
        paper = store.get_paper(paper_id)
        if paper is not None:
            search._fill_missing(paper, row, row.get("source", ""))
    else:
        paper = store.create_paper(project_id, {
            "title": row.get("title") or "UNSET",
            "authors": row.get("authors") or [],
            "journal": row.get("journal") or "",
            "year": row.get("year"),
            "doi": row.get("doi") or "",
            "pmid": row.get("pmid") or "",
            "arxiv_id": row.get("arxiv_id") or "",
            "abstract": row.get("abstract") or "",
            "pdf_url": row.get("pdf_url") or "",
            "pub_types": row.get("pub_types") or [],
            "discovery_source_type": source_type,
        })
        paper_id = paper["id"]
        created = True
        for field in ("title", "authors", "journal", "year", "doi",
                      "pmid", "arxiv_id", "abstract"):
            value = paper.get(field)
            if value is None or value == "" or value == [] \
                    or value == "UNSET":
                continue
            metadata.record_metadata(paper_id, field, value,
                                     row.get("source", ""))
    record_discovery_once(paper_id, source_type, query, seed_id,
                          search_id, external_id)
    return paper_id, created


# ---------------- channels ----------------

def _resolve_seed_metadata(seed: dict) -> dict:
    ch = _channel("seed_metadata", "")
    doi = (seed.get("doi") or "").strip().lower()
    pmid = (seed.get("pmid") or "").strip()
    arxiv_id = (seed.get("arxiv_id") or "").strip()
    if not (doi or pmid or arxiv_id):
        ch["status"] = "skipped"
        ch["detail"] = ("seed carries no DOI/PMID/arXiv id — "
                        "identifier lookup skipped")
        return ch
    if pmid and seed.get("abstract"):
        ch["status"] = "skipped"
        ch["detail"] = "seed already has PMID and abstract"
        return ch
    try:
        result = None
        if pmid:
            hits = fetch_pubmed([pmid], http_get=HTTP_GET)
            result = hits[0] if hits else None
        elif doi:
            hits = search_pubmed(f'"{doi}"[doi]', max_results=3,
                                 http_get=HTTP_GET)
            for hit in hits:
                if (hit.doi or "").lower() == doi:
                    result = hit
                    break
            if result is None and len(hits) == 1:
                result = hits[0]
        if result is None and arxiv_id:
            hits = fetch_arxiv_ids([arxiv_id], http_get=HTTP_GET)
            result = hits[0] if hits else None
        if result is None:
            ch["status"] = "skipped"
            ch["detail"] = ("no match at the scholarly source for the "
                            "seed identifiers")
            return ch
        filled = search._fill_missing(seed, result.to_row(), result.source)
        ch["source"] = result.source
        ch["detail"] = (f"filled: {', '.join(filled)}" if filled
                        else "no empty fields to fill")
    except SearchError as e:
        ch["status"] = "error"
        ch["error"] = str(e)
    except Exception as e:
        ch["status"] = "error"
        ch["error"] = f"{type(e).__name__}: {e}"
    return ch


def _discover_references(project_id: str, seed: dict,
                         cfg: dict) -> dict:
    """First-degree citation discovery: resolve the seed's PDF
    references against PubMed (by DOI) / arXiv (by id), creating
    citation_discovery nodes. Edges are created by the existing
    resolve_references pass (constructed step)."""
    ch = _channel("references", "")
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT * FROM paper_references WHERE paper_id=?
               AND resolution_status='unresolved'
               ORDER BY ref_index ASC""", (seed["id"],)).fetchall()
    finally:
        conn.close()
    refs = [dict(r) for r in rows]
    with_ids = [r for r in refs if (r.get("doi") or r.get("arxiv_id"))]
    todo = with_ids[:cfg["max_reference_resolutions"]]
    ch["retrieved"] = len(todo)
    if not refs:
        ch["status"] = "skipped"
        ch["detail"] = "seed has no reference entries"
        return ch
    if not todo:
        ch["status"] = "skipped"
        ch["detail"] = (f"{len(refs)} references, none carry a DOI "
                        f"or arXiv id — no external lookup possible")
        return ch
    created = duplicates = unresolved = 0
    for ref in todo:
        identifier = (ref.get("doi") or "").strip()
        try:
            if identifier:
                hits = search_pubmed(f'"{identifier}"[doi]',
                                     max_results=3, http_get=HTTP_GET)
                result = None
                for hit in hits:
                    if (hit.doi or "").lower() == identifier:
                        result = hit
                        break
                if result is None and len(hits) == 1:
                    result = hits[0]
                if result is None:
                    unresolved += 1
                    continue
            else:
                hits = fetch_arxiv_ids([ref.get("arxiv_id")],
                                       http_get=HTTP_GET)
                if not hits:
                    unresolved += 1
                    continue
                result = hits[0]
        except SearchError as e:
            ch["errors"].append(
                f"{identifier or ref.get('arxiv_id')}: {e}")
            continue
        except Exception as e:
            ch["errors"].append(
                f"{identifier or ref.get('arxiv_id')}: "
                f"{type(e).__name__}: {e}")
            continue
        ref_paper_id, was_created = ensure_paper(
            project_id, result.to_row(), "citation_discovery",
            seed["id"], "", "",
            identifier or ref.get("arxiv_id") or result.external_id)
        created += int(was_created)
        duplicates += int(not was_created)
        if was_created:
            # Local CPU embedding only (no LLM): metadata representation.
            try:
                embeddings.run_paper_embedding(ref_paper_id)
            except Exception as e:
                ch["errors"].append(
                    f"{identifier or ref.get('arxiv_id')}: "
                    f"embedding failed: {e}")
    ch["created"] = created
    ch["duplicates"] = duplicates
    ch["unresolved"] = unresolved
    ch["detail"] = (f"{created} reference(s) discovered, "
                    f"{duplicates} already in project, "
                    f"{unresolved} not found at the source")
    if ch["errors"]:
        ch["status"] = "partial"
    return ch


def _discover_cited_by(project_id: str, seed: dict, cfg: dict) -> dict:
    """Cited-by discovery via PubMed ELink pubmed_citedin (the only
    cited-by-capable source we integrate; arXiv has none)."""
    ch = _channel("cited_by", "pubmed")
    pmid = (seed.get("pmid") or "").strip()
    if not pmid:
        ch["status"] = "skipped"
        ch["detail"] = ("seed has no PMID — PubMed cited-by "
                        "unavailable (arXiv exposes no cited-by API)")
        return ch
    try:
        citing = cited_by_pmids(pmid, http_get=HTTP_GET,
                                max_results=50)
        citing = citing[:cfg["max_cited_by"]]
        ch["retrieved"] = len(citing)
        if not citing:
            ch["detail"] = "PubMed reports no citing articles"
            return ch
        results = fetch_pubmed(citing, http_get=HTTP_GET)
    except SearchError as e:
        ch["status"] = "error"
        ch["error"] = str(e)
        return ch
    except Exception as e:
        ch["status"] = "error"
        ch["error"] = f"{type(e).__name__}: {e}"
        return ch
    created = duplicates = 0
    conn = connect()
    try:
        edges = 0
        for result in results:
            citer_id, was_created = ensure_paper(
                project_id, result.to_row(), "cited_by_discovery",
                seed["id"], "", "", result.pmid or result.external_id)
            created += int(was_created)
            duplicates += int(not was_created)
            if was_created:
                # Local CPU embedding only (no LLM): metadata representation.
                try:
                    embeddings.run_paper_embedding(citer_id)
                except Exception as e:
                    ch["errors"].append(
                        f"{result.pmid or result.external_id}: "
                        f"embedding failed: {e}")
            if citer_id == seed["id"]:
                continue
            cur = conn.execute(
                """INSERT OR IGNORE INTO citation_edges
                   (source_paper_id, target_paper_id, relationship,
                    source, status, created_at)
                   VALUES (?, ?, 'cites', 'pubmed_citedin',
                           'resolved', ?)""",
                (citer_id, seed["id"], _now()))
            edges += cur.rowcount
        conn.commit()
    finally:
        conn.close()
    ch["created"] = created
    ch["duplicates"] = duplicates
    ch["edges"] = edges
    ch["detail"] = (f"{len(results)} citing article(s) fetched from "
                    f"PubMed, {edges} cited-by edge(s) stored")
    return ch


def _semantic_search(project_id: str, seed: dict, source: str,
                     query: str, cfg: dict) -> tuple[dict, list[dict]]:
    """Retrieve + dedupe + cap semantic candidates (retrieval order —
    no score sorting anywhere). Returns (channel, candidates)."""
    ch = _channel("semantic_discovery", source)
    ch["query"] = query
    if not query:
        ch["status"] = "skipped"
        ch["detail"] = ("no usable seed metadata (title/abstract) "
                        "to build a query")
        return ch, []
    limit = cfg["max_candidates_pubmed" if source == "pubmed"
                else "max_candidates_arxiv"]
    try:
        search_row = search.run_search(project_id, source, query,
                                       max_results=limit)
    except SearchError as e:
        ch["status"] = "error"
        ch["error"] = str(e)
        return ch, []
    except Exception as e:
        ch["status"] = "error"
        ch["error"] = f"{type(e).__name__}: {e}"
        return ch, []
    ch["search_id"] = search_row.get("id", "")
    results = search_row.get("results", [])
    ch["retrieved"] = len(results)
    candidates: list[dict] = []
    for row in results:
        if _same_identity(row, seed) or (
                _norm_title(row.get("title", ""))
                and _norm_title(row.get("title", ""))
                == _norm_title(seed.get("title", ""))):
            ch["excluded_self"] += 1
            continue
        existing_id = _find_existing(project_id, row)
        if existing_id:
            ch["duplicates"] += 1
        candidates.append({"row": row, "existing_id": existing_id,
                           "search_id": ch["search_id"],
                           "query": query, "source": source})
    ch["detail"] = (f"{len(results)} retrieved, {len(candidates)} "
                    f"candidate(s) after dedupe (cap {limit})")
    return ch, candidates


def evaluate_candidates(seed_id: str, seed_vec, backend,
                        candidates: list[dict], channels_by_source: dict,
                        cfg: dict) -> list[dict]:
    """Embed every candidate locally and compute cosine(seed, cand).
    Marks each candidate pass/fail against the documented floor."""
    floor = cfg["similarity_min"]
    passers: list[dict] = []
    for cand in candidates:
        ch = channels_by_source.get(cand["source"])
        text = _candidate_repr(cand["row"])
        if not text.strip():
            cand["reason"] = "no title/abstract to embed"
            if ch is not None:
                ch["skipped"] += 1
                ch["errors"].append(
                    f"{cand['row'].get('external_id', '')}: "
                    "no title/abstract to embed")
            continue
        try:
            vec = backend.encode([text])[0].astype("float32")
        except Exception as e:
            cand["reason"] = f"embedding failed: {e}"
            if ch is not None:
                ch["skipped"] += 1
                ch["errors"].append(
                    f"{cand['row'].get('external_id', '')}: "
                    f"embedding failed: {e}")
            continue
        cand["similarity"] = landscape.cosine(seed_vec, vec)
        if cand["similarity"] >= floor:
            cand["passed"] = True
            passers.append(cand)
        else:
            cand["passed"] = False
            if ch is not None:
                ch["below_threshold"] += 1
    return passers


def construct_semantic_nodes(project_id: str, seed_id: str,
                             passers: list[dict],
                             channels_by_source: dict) -> None:
    """Create floor-passing semantic nodes + provenance + stored
    embeddings + stored similarity pairs (the semantic edges)."""
    try:
        backend = embeddings.get_backend()
        model_name = backend.model_id
        model_version = backend.version
    except Exception as e:
        for ch in channels_by_source.values():
            ch["status"] = "error"
            ch["error"] = f"embedding backend unavailable: {e}"
        return
    for cand in passers:
        ch = channels_by_source.get(cand["source"])
        row = cand["row"]
        paper_id, was_created = ensure_paper(
            project_id, row, "semantic_discovery",
            seed_id, cand["query"], cand["search_id"],
            row.get("external_id") or row.get("pmid")
            or row.get("doi") or "")
        if ch is not None:
            ch["created"] += int(was_created)
        try:
            embeddings.run_paper_embedding(paper_id)
        except Exception as e:
            if ch is not None:
                ch["skipped"] += 1
                ch["errors"].append(
                    f"{row.get('external_id', '')}: "
                    f"embedding failed: {e}")
            continue
        pair = landscape.compute_pair(seed_id, paper_id, model_name,
                                      model_version)
        if pair is None:
            if ch is not None:
                ch["errors"].append(
                    f"{row.get('external_id', '')}: similarity "
                    "unavailable (embedding missing)")
            continue
        landscape.store_pair(pair)
        if ch is not None:
            ch["edged"] += 1


def record_reference_routes(seed_id: str) -> int:
    """After the final resolve pass, each resolved reference target
    gains its citation_discovery provenance route (once) — so a paper
    found by reference and again by semantic search carries BOTH."""
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT doi, arxiv_id, resolved_paper_id
               FROM paper_references
               WHERE paper_id=? AND resolution_status='resolved'
               AND resolved_paper_id != ''""", (seed_id,)).fetchall()
    finally:
        conn.close()
    added = 0
    for row in rows:
        target = row["resolved_paper_id"]
        if not target or target == seed_id:
            continue
        external = (row["doi"] or row["arxiv_id"] or "")
        if record_discovery_once(target, "citation_discovery", "",
                                 seed_id, "", external):
            added += 1
    return added


# ---------------- main pipeline ----------------

def run_discovery(project_id: str, seed_id: str) -> dict:
    """Full automatic first-degree build around one seed paper."""
    cfg = load_landscape_config()
    if store.get_project(project_id) is None:
        raise KeyError(f"unknown project: {project_id}")
    seed = store.get_paper(seed_id)
    if seed is None or seed["project_id"] != project_id:
        raise KeyError(f"unknown seed paper: {seed_id}")
    start_run(project_id, seed_id)
    log_auto(f"project_id={project_id}")
    log_auto(f"seed_paper_id={seed_id}")
    channels: list[dict] = []
    policy = {"similarity_min": cfg["similarity_min"],
              "max_reference_resolutions": cfg["max_reference_resolutions"],
              "max_cited_by": cfg["max_cited_by"],
              "max_candidates_pubmed": cfg["max_candidates_pubmed"],
              "max_candidates_arxiv": cfg["max_candidates_arxiv"]}

    def report() -> dict:
        return {"channels": channels, "policy": policy}

    def flush(step: str):
        update_run(project_id, step=step, report=report())
        log_auto(step)

    try:
        # 1. seed identity/abstract (fill-empty only, network retrieval)
        flush("resolving seed metadata")
        channels.append(_resolve_seed_metadata(seed))
        seed = store.get_paper(seed_id) or seed

        # 2. citation discovery from the seed's PDF references
        flush("resolving references")
        ch_refs = _discover_references(project_id, seed, cfg)
        channels.append(ch_refs)
        log_auto(f"references found={ch_refs['retrieved']} "
                 f"imported={ch_refs['created']} "
                 f"unresolved={ch_refs['unresolved']}")

        # 3. cited-by discovery (PubMed ELink only; arXiv: honest skip)
        flush("discovering cited-by papers")
        ch_cited = _discover_cited_by(project_id, seed, cfg)
        channels.append(ch_cited)
        log_auto(f"cited-by candidates={ch_cited['retrieved']} "
                 f"imported={ch_cited['created']} edges={ch_cited['edges']}")

        # 4. semantic retrieval, both sources (persisted searches; each
        # source gets its own deterministic metadata query)
        semantic: list[dict] = []
        channels_by_source: dict[str, dict] = {}
        all_candidates: list[dict] = []
        for source in ("pubmed", "arxiv"):
            flush("searching PubMed" if source == "pubmed"
                  else "searching arXiv")
            query = seed_query(seed, source)
            ch, candidates = _semantic_search(project_id, seed, source,
                                              query, cfg)
            channels.append(ch)
            semantic.append(ch)
            channels_by_source[source] = ch
            all_candidates.extend(candidates)
            log_auto(f"{'PubMed' if source == 'pubmed' else 'arXiv'} "
                     f"candidates={ch['retrieved']} "
                     f"after dedupe={len(candidates)}")

        # 5. local embedding + cosine against the configured floor
        flush("embedding candidates")
        try:
            backend = embeddings.get_backend()
            seed_emb = embeddings.get_embedding(
                seed_id, backend.model_id, backend.version)
            if seed_emb is None:
                embeddings.run_paper_embedding(seed_id)
                seed_emb = embeddings.get_embedding(
                    seed_id, backend.model_id, backend.version)
            if seed_emb is None:
                raise RuntimeError("seed embedding unavailable")
            passers = evaluate_candidates(
                seed_id, seed_emb["vector"], backend, all_candidates,
                channels_by_source, cfg)
        except Exception as e:
            for ch in semantic:
                if ch["status"] != "skipped":
                    ch["status"] = "error"
                    ch["error"] = ch["error"] or f"candidate embedding: {e}"
                ch["skipped"] += sum(
                    1 for c in all_candidates
                    if c["source"] == ch["source"])
            passers = []

        # 6. nodes, edges, dual-route provenance
        flush("constructing relationships")
        log_auto(f"semantic candidates={len(all_candidates)} "
                 f"passers={len(passers)}")
        construct_semantic_nodes(project_id, seed_id, passers,
                                 channels_by_source)
        try:
            final = references.resolve_references(seed_id)
            added_routes = record_reference_routes(seed_id)
            for ch in channels:
                if ch["channel"] == "references":
                    ch["resolved"] = final.get("resolved", 0)
                    ch["edges"] = final.get("edges", 0)
                    if added_routes:
                        ch["detail"] += (
                            f"; {added_routes} provenance route(s) "
                            f"added for resolved references")
        except Exception as e:
            channels.append(_channel("relationships", "", "error",
                                     error=f"{type(e).__name__}: {e}"))

        imported = sum(ch.get("created", 0) for ch in channels)
        citation_edges = sum(ch.get("edges", 0) for ch in channels)
        semantic_edges = sum(ch.get("edged", 0) for ch in channels)
        log_auto(f"papers imported={imported}")
        log_auto(f"citation edges created={citation_edges}")
        log_auto(f"semantic edges created={semantic_edges}")

        update_run(project_id, status="complete", step="landscape ready",
                   report=report())
        log_auto("completed")
    except Exception as e:
        update_run(project_id, status="error", report=report(),
                   error=f"{type(e).__name__}: {e}")
        raise
    return get_status(project_id)
