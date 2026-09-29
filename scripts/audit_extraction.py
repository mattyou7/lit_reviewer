"""Extraction quality audit for one paper + extraction version.

Usage:
    python scripts/audit_extraction.py <paper_id> [prompt_version]
                                       [schema_version]

Diagnostic only: reports per-chunk status/item counts/categories plus
aggregate coverage. Never judges relevance; never modifies data.
"""
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app import store
from backend.app.database import connect


def main():
    if len(sys.argv) < 2:
        print("usage: audit_extraction.py <paper_id> [prompt_version]"
              " [schema_version]")
        return 2
    pid = sys.argv[1]
    paper = store.get_paper(pid)
    if paper is None:
        print(f"unknown paper: {pid}")
        return 1
    conn = connect()
    try:
        versions = [dict(r) for r in conn.execute(
            "SELECT DISTINCT prompt_version, schema_version"
            " FROM chunk_extractions WHERE paper_id=?", (pid,)).fetchall()]
    finally:
        conn.close()
    pver = sys.argv[2] if len(sys.argv) > 2 else max(
        v["prompt_version"] for v in versions)
    sver = sys.argv[3] if len(sys.argv) > 3 else "1.0"

    chunks = store.list_chunks(pid)
    try:
        model = __import__("src.teacher.backend",
                           fromlist=["load_teacher_config"]
                           ).load_teacher_config()["model"]
    except Exception:
        model = "Qwen/Qwen3-1.7B-MLX-8bit"
    conn = connect()
    try:
        recs = {r["chunk_id"]: dict(r) for r in conn.execute(
            "SELECT * FROM chunk_extractions WHERE paper_id=?"
            " AND model_name=? AND prompt_version=? AND schema_version=?",
            (pid, model, pver, sver)).fetchall()}
    finally:
        conn.close()
    ev = store.list_evidence(pid, model_name=model, prompt_version=pver,
                             schema_version=sver)
    by_chunk: dict = {}
    for e in ev:
        by_chunk.setdefault(e["chunk_id"], []).append(e)

    print(f"paper: {pid}  extraction prompt={pver} schema={sver}")
    print(f"{'chunk':<34} {'section':<13} {'status':<8} {'n':<4} categories")
    zero, one, cat_counter = [], [], Counter()
    for c in chunks:
        items = by_chunk.get(c["chunk_id"], [])
        cats = sorted({i["category"] for i in items})
        cat_counter.update(cats)
        st = recs.get(c["chunk_id"], {}).get("status", "no-record")
        fail = recs.get(c["chunk_id"], {}).get("failure_type", "")
        print(f"{c['chunk_id']:<34} {c['section']:<13} {st:<8} "
              f"{len(items):<4} {cats}"
              + (f"  [{fail}]" if fail else ""))
        if not items:
            zero.append(c["chunk_id"])
        elif len(items) == 1:
            one.append(c["chunk_id"])
    counts = [len(by_chunk.get(c["chunk_id"], [])) for c in chunks]
    print(f"\nchunks={len(chunks)} success="
          f"{sum(1 for c in chunks if recs.get(c['chunk_id'], {}).get('status') == 'success')}"
          f" failed={sum(1 for c in chunks if recs.get(c['chunk_id'], {}).get('status') == 'failed')}")
    print(f"evidence={len(ev)} mean={sum(counts)/max(1, len(counts)):.1f} "
          f"median={sorted(counts)[len(counts)//2] if counts else 0}")
    print(f"zero-evidence chunks ({len(zero)}): {zero}")
    print(f"single-item chunks ({len(one)}): {one}")
    print(f"categories populated: {sorted(cat_counter)}")
    from src.teacher.prompt import CATEGORIES
    print(f"categories never populated: "
          f"{[c for c in CATEGORIES if c not in cat_counter]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
