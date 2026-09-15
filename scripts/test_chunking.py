import json
import sys
from pathlib import Path

# ------------------------------------------------------------
# Project root
# ------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[1]

# Make src/ importable
sys.path.insert(0, str(ROOT))


# ------------------------------------------------------------
# Imports
# ------------------------------------------------------------

from src.pdf.extract import extract_pdf
from src.chunking.sectioner import (
    split_into_sections,
    summarize_sections,
)
from src.chunking.chunker import chunk_all_sections


# ------------------------------------------------------------
# Input / output
# ------------------------------------------------------------

PDF = "/Users/mathewcherian/Downloads/s41467-025-61010-x.pdf"

OUTPUT = ROOT / "results" / "paper_001"


# ------------------------------------------------------------
# Main
# ------------------------------------------------------------

def main():

    print("Extracting PDF...")

    pages = extract_pdf(PDF)

    print(f"Pages extracted: {len(pages)}")


    # --------------------------------------------------------
    # Section detection
    # --------------------------------------------------------

    sections = split_into_sections(pages)

    print("\nDetected sections:\n")

    summary = summarize_sections(sections)

    for section, info in summary.items():

        print(
            f"  {section:<20} "
            f"{info['characters']:>8,} characters "
            f"pages={info['pages']}"
        )

        if info["subsections"]:

            print("      subsections:")

            for subsection in info["subsections"]:
                print(f"        - {subsection}")


    # --------------------------------------------------------
    # Create chunks
    # --------------------------------------------------------

    chunks = chunk_all_sections(
        paper_id="paper_001",
        sections=sections,
    )


    # --------------------------------------------------------
    # Save chunks
    # --------------------------------------------------------

    OUTPUT.mkdir(
        parents=True,
        exist_ok=True,
    )

    for chunk in chunks:

        section_dir = OUTPUT / chunk.section

        section_dir.mkdir(
            parents=True,
            exist_ok=True,
        )

        path = section_dir / f"{chunk.chunk_id}.txt"

        path.write_text(
            chunk.text,
            encoding="utf-8",
        )


    # --------------------------------------------------------
    # Manifest
    # --------------------------------------------------------

    metadata = {
        "paper_id": "paper_001",
        "pdf": PDF,
        "pages": len(pages),

        "sections": {
            name: len(lines)
            for name, lines in sections.items()
        },

        "chunks": len(chunks),
    }


    manifest_path = OUTPUT / "chunk_manifest.json"

    manifest_path.write_text(
        json.dumps(
            metadata,
            indent=2,
        ),
        encoding="utf-8",
    )


    # --------------------------------------------------------
    # Final summary
    # --------------------------------------------------------

    print(f"\nCreated {len(chunks)} chunks.")
    print(f"Output: {OUTPUT}")


if __name__ == "__main__":
    main()