#!/usr/bin/env python3
import argparse
from src.pdf.extract import extract_pdf, write_text

p = argparse.ArgumentParser()
p.add_argument('pdf')
p.add_argument('-o', '--output', default='data/processed/paper.txt')
a = p.parse_args()
pages = extract_pdf(a.pdf)
write_text(pages, a.output)
print(f'Extracted {len(pages)} pages -> {a.output}')
