"""Deterministic arXiv search via the public API (Atom feed).

No ranking, no relevance scores, no LLM. Result order is the API's
submission-date order, preserved as rank. stdlib only.
"""
from __future__ import annotations

import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from .common import SearchError, SearchResult

API = "http://export.arxiv.org/api/query"
NS = {"atom": "http://www.w3.org/2005/Atom",
      "arxiv": "http://arxiv.org/schemas/atom"}


def _http_get(url: str, timeout_s: int) -> bytes:
    def _real_get() -> bytes:
        try:
            with urllib.request.urlopen(url, timeout=timeout_s) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise SearchError(f"arXiv HTTP {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            raise SearchError(f"arXiv network failure: {e.reason}")
        except TimeoutError:
            raise SearchError("arXiv request timed out")
        except Exception as e:
            raise SearchError(f"arXiv request failed: {e}")

    from . import replay
    return replay.http_get(url, _real_get)


def _text(element: ET.Element | None) -> str:
    if element is None or element.text is None:
        return ""
    return " ".join(element.text.split())


def _base_id(abs_url: str) -> str:
    match = re.search(r"arxiv\.org/abs/([^\s/]+)", abs_url)
    return (match.group(1) if match else abs_url).strip()


def search_arxiv(query: str, max_results: int = 20,
                 http_get=None) -> list[SearchResult]:
    """Run an arXiv query. Raises SearchError on failure."""
    if not query or not query.strip():
        raise SearchError("empty query")
    if max_results < 1:
        raise SearchError("max_results must be >= 1")
    from .pubmed import load_search_config
    cfg = load_search_config()
    get = http_get or (lambda url: _http_get(url, cfg["timeout_s"]))

    params = {"search_query": f"all:{query.strip()}",
              "start": 0, "max_results": max_results,
              "sortBy": "submittedDate", "sortOrder": "descending"}
    try:
        root = ET.fromstring(get(API + "?" + urllib.parse.urlencode(params)))
    except SearchError:
        raise
    except ET.ParseError as e:
        raise SearchError(f"malformed arXiv response: {e}")
    if root.tag != f"{{{NS['atom']}}}feed":
        raise SearchError("malformed arXiv response")

    results, seen = [], set()
    for entry in root.findall("atom:entry", NS):
        result = _entry_result(entry)
        if result is None:
            continue
        base = result.arxiv_id
        if base in seen:
            continue
        seen.add(base)
        results.append(result)
    return results


def _entry_result(entry: ET.Element) -> SearchResult | None:
    """One Atom <entry> -> SearchResult. None for entries without an
    arXiv id. Parsing shared by search_arxiv and fetch_arxiv_ids."""
    abs_url = _text(entry.find("atom:id", NS))
    full_id = _base_id(abs_url)
    base = re.sub(r"v\d+$", "", full_id)
    if not base:
        return None
    authors = [_text(a.find("atom:name", NS))
               for a in entry.findall("atom:author", NS)]
    authors = [a for a in authors if a]
    published = _text(entry.find("atom:published", NS))
    year = int(published[:4]) if published[:4].isdigit() else None
    doi = _text(entry.find("arxiv:doi", NS)).lower() or ""
    journal = _text(entry.find("arxiv:journal_ref", NS))
    return SearchResult(
        external_id=f"arxiv:{full_id}", source="arxiv",
        arxiv_id=base, doi=doi,
        title=_text(entry.find("atom:title", NS)),
        authors=authors, journal=journal, year=year,
        abstract=_text(entry.find("atom:summary", NS)),
        pdf_url=f"https://arxiv.org/pdf/{base}.pdf" if base else "")


def fetch_arxiv_ids(arxiv_ids: list[str], http_get=None
                    ) -> list[SearchResult]:
    """Fetch details for arXiv ids via the public API's id_list.

    Used by discovery (reference resolution for arXiv identifiers).
    Input order preserved; ids with no matching entry are omitted
    (never guessed). Raises SearchError on failure.
    """
    ids = [str(x).strip() for x in (arxiv_ids or []) if str(x).strip()]
    if not ids:
        return []
    from .pubmed import load_search_config
    cfg = load_search_config()
    get = http_get or (lambda url: _http_get(url, cfg["timeout_s"]))

    params = {"id_list": ",".join(ids), "start": 0,
              "max_results": max(len(ids), 1)}
    try:
        root = ET.fromstring(get(API + "?" + urllib.parse.urlencode(params)))
    except SearchError:
        raise
    except ET.ParseError as e:
        raise SearchError(f"malformed arXiv response: {e}")
    if root.tag != f"{{{NS['atom']}}}feed":
        raise SearchError("malformed arXiv response")
    results = []
    for entry in root.findall("atom:entry", NS):
        result = _entry_result(entry)
        if result is not None:
            results.append(result)
    return results
