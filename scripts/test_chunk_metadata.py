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
from src.chunking.chunker import chunk_all_sections


# ------------------------------------------------------------
# Input
# ------------------------------------------------------------

PDF = "/Users/mathewcherian/Downloads/s41467-025-61010-x.pdf"


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
    # Inspect metadata
    # --------------------------------------------------------

    print("\n\nCHUNK METADATA\n")

    for chunk in chunks:

        print("=" * 80)

        print(f"ID:          {chunk.chunk_id}")
        print(f"Section:     {chunk.section}")
        print(f"Subsection:  {chunk.subsection}")
        print(f"Characters:  {len(chunk.text)}")
        print(f"Tokens ~:    {len(chunk.text) // 4}")
        print(
            f"Source:      "
            f"{chunk.source_start} -> {chunk.source_end}"
        )

        preview = chunk.text[:180].replace("\n", " ")

        print(f"Preview:     {preview}")


    print("\n")
    print(f"Total chunks: {len(chunks)}")


if __name__ == "__main__":
    main()