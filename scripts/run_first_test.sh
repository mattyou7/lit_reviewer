#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source .venv/bin/activate
PDF="${1:-/Users/mathewcherian/Downloads/s41467-025-61010-x.pdf}"
python scripts/extract_pdf.py "$PDF" -o data/processed/seed_paper.txt
printf '\nPaper text is ready at data/processed/seed_paper.txt\n'
printf 'Next: section-aware chunking and bounded-context teacher extraction.\n'
