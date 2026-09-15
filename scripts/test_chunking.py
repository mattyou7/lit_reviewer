import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.pdf.extract import extract_pdf
from src.chunking.sectioner import split_into_sections
from src.chunking.chunker import chunk_all_sections


PDF = "/Users/mathewcherian/Downloads/s41467-025-61010-x.pdf"

OUTPUT = ROOT / "results" / "paper_001"


def main():
    print("Extracting PDF...")

    pages = extract_pdf(PDF)

    print(f"Pages extracted: {len(pages)}")

    sections = split_into_sections(pages)

    print("\nDetected sections:")

    for name, lines in sections.items():
        characters = sum(len(x["text"]) for x in lines)
        print(f"  {name:20} {characters:,} characters")

    chunks = chunk_all_sections(
        paper_id="paper_001",
        sections=sections,
    )

    OUTPUT.mkdir(parents=True, exist_ok=True)

    for chunk in chunks:
        section_dir = OUTPUT / chunk.section
        section_dir.mkdir(parents=True, exist_ok=True)

        path = section_dir / f"{chunk.chunk_id}.txt"

        path.write_text(
            chunk.text,
            encoding="utf-8",
        )

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

    (OUTPUT / "chunk_manifest.json").write_text(
        json.dumps(metadata, indent=2),
        encoding="utf-8",
    )

    print(f"\nCreated {len(chunks)} chunks.")
    print(f"Output: {OUTPUT}")


if __name__ == "__main__":
    main()