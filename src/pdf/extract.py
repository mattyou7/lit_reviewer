from pathlib import Path
from pypdf import PdfReader


def extract_pdf(path: str):
    reader = PdfReader(path)
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        pages.append({"page": i, "text": page.extract_text() or ""})
    return pages


def write_text(pages, out: str):
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for p in pages:
            f.write(f"\n\n=== PAGE {p['page']} ===\n\n")
            f.write(p["text"])
