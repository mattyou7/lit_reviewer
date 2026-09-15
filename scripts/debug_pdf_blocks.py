import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.pdf.extract import extract_pdf


PDF = "/Users/mathewcherian/Downloads/s41467-025-61010-x.pdf"


def main():

    pages = extract_pdf(PDF)

    for page in pages[:2]:

        print("\n")
        print("=" * 80)
        print(f"PAGE {page['page']}")
        print("=" * 80)

        for i, block in enumerate(
            page["blocks"],
            start=1,
        ):

            print("\n")
            print(
                f"BLOCK {i}"
            )

            print(
                f"BBOX: {block['bbox']}"
            )

            print(
                "TEXT:"
            )

            print(
                block["text"]
            )


if __name__ == "__main__":
    main()