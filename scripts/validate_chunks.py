"""Chunk quality report: PDF -> sections -> chunks -> provenance.

Usage:
    python scripts/validate_chunks.py [PDF_PATH] [PAPER_ID]

Validates semantic coherence prerequisites without any LLM:
section boundaries, paragraph reconstruction, chunk sizes, text-level
overlap, unintended duplication, text coverage, provenance, chunk-ID
determinism, and repeated-run determinism.

Exit code is non-zero when a hard property fails (text loss,
unintended duplication, non-determinism, invalid provenance,
duplicate chunk IDs). Quality flags (tiny/huge chunks, suspicious
headings) are reported but do not fail the run.
"""

import json
import statistics
import sys
from pathlib import Path

# ------------------------------------------------------------
# Project root
# ------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[1]

sys.path.insert(0, str(ROOT))

# ------------------------------------------------------------
# Imports
# ------------------------------------------------------------

from src.pdf.extract import extract_pdf
from src.chunking.sectioner import (
    split_into_sections,
    summarize_sections,
)
from src.chunking.chunker import (
    CHARS_PER_TOKEN,
    OVERLAP_TOKENS,
    TARGET_TOKENS,
    _build_paragraphs,
    _group_by_subsection,
    chunk_all_sections,
)

PDF = sys.argv[1] if len(sys.argv) > 1 else \
    "/Users/mathewcherian/Downloads/s41467-025-61010-x.pdf"

PAPER_ID = sys.argv[2] if len(sys.argv) > 2 else "paper_001"

FAILURES = []


def fail(message: str):
    FAILURES.append(message)
    print(f"  FAIL: {message}")


def norm(text: str) -> str:
    return " ".join(text.split())


def tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def main():
    print(f"PDF: {PDF}")
    print(f"Target: ~{TARGET_TOKENS} tokens, overlap ~{OVERLAP_TOKENS}")

    # --------------------------------------------------------
    # Extraction
    # --------------------------------------------------------

    pages = extract_pdf(PDF)
    n_pages = len(pages)
    print(f"\nPAGES: {n_pages}")

    typed = sum(
        1 for p in pages for b in p["blocks"] if "type" in b
    )
    total_blocks = sum(len(p["blocks"]) for p in pages)
    print(f"BLOCKS: {total_blocks} ({typed} typed)")

    # --------------------------------------------------------
    # Sections
    # --------------------------------------------------------

    sections = split_into_sections(pages)
    print("\nSECTIONS:")
    for name, info in summarize_sections(sections).items():
        pages_str = "-".join(
            map(str, [info["pages"][0], info["pages"][-1]])
        ) if info["pages"] else "none"
        print(f"  {name:<15} chars={info['characters']:>7,}"
              f" pages={pages_str:<7} n={len(sections[name])}")
        for sub in info["subsections"]:
            print(f"      - {sub}")

    if len(sections) <= 1 and sum(
            len(v) for v in sections.values()) > 0:
        fail("entire paper in a single section")

    # --------------------------------------------------------
    # Suspicious headings (flagged, not failed)
    # --------------------------------------------------------

    print("\nHEADINGS:")
    suspicious = []
    for name, items in sections.items():
        for it in items:
            if not it.get("is_heading"):
                continue
            words = it["text"].split()
            print(f"  [{name}] p{it['page']} :: {it['text'][:70]!r}"
                  f" -> {it['subsection']}")
            if len(words) <= 1:
                suspicious.append(
                    f"{name}/{it['subsection']} p{it['page']}:"
                    f" single-word heading {it['text']!r}")
    for s in suspicious:
        print(f"  SUSPICIOUS: {s}")

    # --------------------------------------------------------
    # Chunks (run twice for determinism)
    # --------------------------------------------------------

    chunks_a = chunk_all_sections(sections, paper_id=PAPER_ID)
    chunks_b = chunk_all_sections(sections, paper_id=PAPER_ID)

    print(f"\nCHUNKS: {len(chunks_a)}")

    key = lambda c: (c.chunk_id, c.section, c.subsection,
                     c.text, c.source_start, c.source_end)
    if [key(c) for c in chunks_a] != [key(c) for c in chunks_b]:
        fail("repeated chunking runs differ (non-deterministic)")
    else:
        print("DETERMINISM: PASS (two runs identical)")

    ids = [c.chunk_id for c in chunks_a]
    if len(set(ids)) != len(ids):
        fail("duplicate chunk IDs")
    else:
        print(f"CHUNK IDS: unique ({len(ids)})")

    # --------------------------------------------------------
    # Token statistics
    # --------------------------------------------------------

    sizes = [tokens(c.text) for c in chunks_a]
    print("\nTOKEN STATISTICS (est. len//4):")
    print(f"  min={min(sizes)} median={statistics.median(sizes)}"
          f" mean={sum(sizes)//len(sizes)}"
          f" p90={sorted(sizes)[int(len(sizes)*0.9)-1]}"
          f" max={max(sizes)}")

    for c in chunks_a:
        t = tokens(c.text)
        print(f"  {c.chunk_id:<45} tok~{t:<6}"
              f" pages={c.source_start}->{c.source_end}")

    tiny = [c.chunk_id for c in chunks_a if tokens(c.text) < 50]
    huge = [c.chunk_id for c in chunks_a if tokens(c.text) > TARGET_TOKENS * 2]
    if tiny:
        print(f"  FLAG tiny chunks (<50 tok): {tiny}")
    if huge:
        print(f"  FLAG huge chunks (>2x target): {huge}")

    # --------------------------------------------------------
    # Overlap (text level, within same section+subsection run)
    # --------------------------------------------------------

    print(f"\nOVERLAP (expected ~{OVERLAP_TOKENS} tok):")
    runs: dict = {}
    for c in chunks_a:
        runs.setdefault((c.section, c.subsection or ""), []).append(c)
    for (sec, sub), run in runs.items():
        if len(run) < 2:
            continue
        for prev, nxt in zip(run, run[1:]):
            prev_paras = prev.text.split("\n\n")
            nxt_paras = nxt.text.split("\n\n")
            shared = 0
            for k in range(min(len(prev_paras), len(nxt_paras)), 0, -1):
                if prev_paras[-k:] == nxt_paras[:k]:
                    shared = k
                    break
            shared_tok = sum(tokens(p) for p in nxt_paras[:shared])
            label = f"{sec}/{sub or '-'}"
            print(f"  {prev.chunk_id} -> {nxt.chunk_id} [{label}]"
                  f" shared_paras={shared} shared_tok~{shared_tok}")

    # --------------------------------------------------------
    # Unintended duplication: paragraph in >2 chunks or in
    # non-consecutive chunks.
    # --------------------------------------------------------

    # --------------------------------------------------------
    # Unintended duplication: a paragraph may legitimately
    # appear more than once in chunks (intended overlap copies
    # sit in consecutive chunks; source text itself may repeat,
    # e.g. a recurring equation). Flag only copies that exceed
    # source multiplicity + one overlap copy, or a single
    # overlap copy in non-consecutive chunks.
    # --------------------------------------------------------

    print("\nDUPLICATION SCAN:")
    src_counts: dict = {}
    for name, items in sections.items():
        for p, _, _ in _build_paragraphs(items):
            h = norm(p)
            if len(h) > 40:
                src_counts[h] = src_counts.get(h, 0) + 1
    chunk_locs: dict = {}
    for idx, c in enumerate(chunks_a):
        for p in c.text.split("\n\n"):
            h = norm(p)
            if len(h) > 40:
                chunk_locs.setdefault(h, []).append(idx)
    bad = {}
    for h, locs in chunk_locs.items():
        excess = len(locs) - src_counts.get(h, 0)
        contiguous = (max(locs) - min(locs) + 1 == len(locs))
        if excess > 1 or (excess == 1 and not contiguous):
            bad[h] = locs
    if bad:
        fail(f"{len(bad)} paragraphs duplicated beyond overlap")
        for h, locs in list(bad.items())[:5]:
            print(f"  DUP idx={locs} :: {h[:80]!r}")
    else:
        print("  no unintended duplication")

    # --------------------------------------------------------
    # Text coverage: every sectioner content paragraph must
    # appear (normalized) in its section's chunks.
    # --------------------------------------------------------

    print("\nTEXT COVERAGE:")
    chunk_text_by_section: dict = {}
    for c in chunks_a:
        chunk_text_by_section.setdefault(c.section, []).append(c.text)
    missing_total = 0
    for name, items in sections.items():
        paras = _build_paragraphs(items)
        haystack = norm("\n".join(chunk_text_by_section.get(name, [])))
        missing = [p for p, _, _ in paras if norm(p) not in haystack]
        print(f"  {name}: {len(paras)} paragraphs,"
              f" missing={len(missing)}")
        for p, _, _ in missing[:3]:
            print(f"    MISSING :: {norm(p)[:100]!r}")
        missing_total += len(missing)
    if missing_total:
        fail(f"{missing_total} source paragraphs missing from chunks")
    else:
        print("  full coverage")

    # --------------------------------------------------------
    # Provenance
    # --------------------------------------------------------

    print("\nPROVENANCE:")
    unknown = [c.chunk_id for c in chunks_a if not c.source_start]
    invalid = []
    for c in chunks_a:
        if not c.source_start:
            continue
        try:
            s, e = int(c.source_start), int(c.source_end)
            if not (1 <= s <= e <= n_pages):
                invalid.append(c.chunk_id)
        except (TypeError, ValueError):
            invalid.append(c.chunk_id)
    n_valid = len(chunks_a) - len(unknown) - len(invalid)
    print(f"  valid={n_valid}"
          f" unknown={len(unknown)} invalid={len(invalid)}")
    if invalid:
        fail(f"invalid page provenance: {invalid}")
    if unknown:
        print(f"  SOURCE LOCATION UNKNOWN: {unknown}")

    # --------------------------------------------------------
    # Verdict
    # --------------------------------------------------------

    print("\n" + ("ALL HARD CHECKS PASSED" if not FAILURES
                  else f"{len(FAILURES)} FAILURES"))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
