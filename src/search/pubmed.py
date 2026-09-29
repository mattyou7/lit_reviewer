"""Deterministic PubMed search via NCBI E-utilities. Retrieval only.

No ranking, no relevance scores, no LLM. Result order is the API's
retrieval order, preserved as rank. stdlib only (urllib + ElementTree).
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from .common import SearchError, SearchResult

ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
ELINK = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi"
CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "pipeline.yaml"


def load_search_config() -> dict:
    defaults = {"ncbi_email": "", "ncbi_tool": "lit-review-assistant",
                "timeout_s": 20, "max_results_default": 20,
                "request_pause_s": 0.34}
    try:
        import yaml  # type: ignore
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = yaml.safe_load(f) or {}
        saved = cfg.get("search", {}) or {}
        out = dict(defaults)
        for key in defaults:
            if key in saved:
                out[key] = type(defaults[key])(saved[key])
        return out
    except Exception:
        return defaults


def _http_get(url: str, timeout_s: int) -> bytes:
    def _real_get() -> bytes:
        try:
            with urllib.request.urlopen(url, timeout=timeout_s) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise SearchError(f"NCBI HTTP {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            raise SearchError(f"NCBI network failure: {e.reason}")
        except TimeoutError:
            raise SearchError("NCBI request timed out")
        except Exception as e:
            raise SearchError(f"NCBI request failed: {e}")

    from . import replay
    return replay.http_get(url, _real_get)


def _text(element: ET.Element | None) -> str:
    if element is None or element.text is None:
        return ""
    return " ".join(element.text.split())


def search_pubmed(query: str, max_results: int = 20,
                  year_min: int | None = None,
                  year_max: int | None = None,
                  http_get=None) -> list[SearchResult]:
    """Run a PubMed query. Raises SearchError on failure, never partial
    silent data."""
    if not query or not query.strip():
        raise SearchError("empty query")
    if max_results < 1:
        raise SearchError("max_results must be >= 1")
    cfg = load_search_config()
    get = http_get or (lambda url: _http_get(url, cfg["timeout_s"]))

    params = {"db": "pubmed", "term": query.strip(),
              "retmax": max_results, "retmode": "json",
              "tool": cfg["ncbi_tool"]}
    if cfg["ncbi_email"]:
        params["email"] = cfg["ncbi_email"]
    if year_min is not None or year_max is not None:
        params["datetype"] = "pdat"
        if year_min is not None:
            params["mindate"] = str(year_min)
        if year_max is not None:
            params["maxdate"] = str(year_max)
    try:
        payload = _loads(get(ESEARCH + "?" + urllib.parse.urlencode(params)))
    except SearchError:
        raise
    except Exception as e:
        raise SearchError(f"malformed esearch response: {e}")
    try:
        ids = payload["esearchresult"]["idlist"]
    except (KeyError, TypeError) as e:
        raise SearchError(f"malformed esearch response: {e}")
    if not ids:
        return []
    seen, unique_ids = set(), []
    for pmid in ids:
        if pmid not in seen:
            seen.add(pmid)
            unique_ids.append(pmid)
    return fetch_pubmed(unique_ids, http_get=get)


def fetch_pubmed(pmids: list[str], http_get=None) -> list[SearchResult]:
    """Fetch full details (esummary + efetch abstracts) for PMIDs.

    Used by search_pubmed and by discovery (cited-by / DOI lookup).
    Order of `pmids` is preserved; empty input returns []. Raises
    SearchError on failure, never partial silent data.
    """
    seen, unique_ids = set(), []
    for pmid in pmids or []:
        pmid = str(pmid)
        if pmid and pmid not in seen:
            seen.add(pmid)
            unique_ids.append(pmid)
    if not unique_ids:
        return []
    cfg = load_search_config()
    get = http_get or (lambda url: _http_get(url, cfg["timeout_s"]))

    time.sleep(cfg["request_pause_s"])
    summary_params = {"db": "pubmed", "id": ",".join(unique_ids),
                      "retmode": "json", "tool": cfg["ncbi_tool"]}
    if cfg["ncbi_email"]:
        summary_params["email"] = cfg["ncbi_email"]
    try:
        summaries = _loads(
            get(ESUMMARY + "?" + urllib.parse.urlencode(summary_params)))
        docs = summaries["result"]
    except SearchError:
        raise
    except Exception as e:
        raise SearchError(f"malformed esummary response: {e}")

    time.sleep(cfg["request_pause_s"])
    fetch_params = {"db": "pubmed", "id": ",".join(unique_ids),
                    "retmode": "xml", "tool": cfg["ncbi_tool"]}
    if cfg["ncbi_email"]:
        fetch_params["email"] = cfg["ncbi_email"]
    abstracts: dict[str, str] = {}
    try:
        root = ET.fromstring(
            get(EFETCH + "?" + urllib.parse.urlencode(fetch_params)))
        for article in root.iter("PubmedArticle"):
            pmid_el = article.find("./MedlineCitation/PMID")
            pmid = _text(pmid_el)
            parts = [
                _text(el)
                for el in article.findall("./MedlineCitation/Article/Abstract/AbstractText")
                if _text(el)
            ]
            if pmid and parts:
                abstracts[pmid] = "\n".join(parts)
    except SearchError:
        raise
    except ET.ParseError as e:
        raise SearchError(f"malformed efetch response: {e}")

    results = []
    for pmid in unique_ids:
        try:
            doc = docs.get(pmid, {})
        except AttributeError:
            raise SearchError("malformed esummary response")
        if not isinstance(doc, dict):
            continue
        doi = ""
        for aid in doc.get("articleids", []) or []:
            if isinstance(aid, dict) and aid.get("idtype") == "doi":
                doi = (aid.get("value") or "").lower()
        authors = []
        for author in doc.get("authors", []) or []:
            if isinstance(author, dict) and author.get("name"):
                authors.append(author["name"])
        year = None
        for key in ("pubdate", "epubdate"):
            value = (doc.get(key) or "")[:4]
            if value.isdigit():
                year = int(value)
                break
        # Publication types exactly as PubMed types the record
        # (esummary "pubtype"): real metadata, no inference. "Retracted
        # Publication" in this list is the source's retraction flag.
        pub_types = [t for t in (doc.get("pubtype") or [])
                     if isinstance(t, str) and t]
        results.append(SearchResult(
            external_id=f"pmid:{pmid}", source="pubmed", pmid=str(pmid),
            doi=doi, title=doc.get("title", "") or "",
            authors=authors, journal=doc.get("source", "") or "",
            year=year, abstract=abstracts.get(str(pmid), ""),
            pub_types=pub_types))
    return results


def _loads(raw: bytes):
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="replace")
    return json.loads(raw)


def cited_by_pmids(pmid: str, http_get=None,
                   max_results: int = 50) -> list[str]:
    """PMIDs of PubMed articles that cite `pmid`, via NCBI ELink
    linkname=pubmed_citedin (PubMed's cited-by relationship).

    Retrieval order preserved, duplicates removed, never fabricated:
    returns [] when PubMed reports no citing links. arXiv has no
    equivalent API (its Atom API exposes no cited-by). Raises
    SearchError on failure so callers can surface it honestly.
    """
    if not pmid or not str(pmid).strip():
        raise SearchError("empty pmid")
    if max_results < 1:
        raise SearchError("max_results must be >= 1")
    cfg = load_search_config()
    get = http_get or (lambda url: _http_get(url, cfg["timeout_s"]))

    params = {"dbfrom": "pubmed", "db": "pubmed",
              "id": str(pmid).strip(), "linkname": "pubmed_citedin",
              "retmode": "json", "tool": cfg["ncbi_tool"]}
    if cfg["ncbi_email"]:
        params["email"] = cfg["ncbi_email"]
    time.sleep(cfg["request_pause_s"])
    try:
        payload = _loads(get(ELINK + "?" + urllib.parse.urlencode(params)))
    except SearchError:
        raise
    except Exception as e:
        raise SearchError(f"malformed elink response: {e}")
    try:
        links: list[str] = []
        for linkset in payload.get("linksets", []) or []:
            for dbs in linkset.get("linksetdbs", []) or []:
                if dbs.get("linkname") == "pubmed_citedin":
                    links.extend(str(x) for x in dbs.get("links", []) or [])
    except (AttributeError, TypeError) as e:
        raise SearchError(f"malformed elink response: {e}")
    seen, out = set(), []
    for link in links:
        if link and link not in seen and link != str(pmid).strip():
            seen.add(link)
            out.append(link)
    return out[:max_results]
