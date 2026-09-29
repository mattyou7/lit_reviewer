"""Compatibility shim.

The canonical PDF extraction implementation lives in
`src.pdf.extract`. This module previously duplicated it (including
`classify_block_type`), which caused the two copies to diverge: the
sectioner expects typed blocks, but the backend pipeline imports the
untyped copy.

Everything here is re-exported from the canonical module so older
imports keep working without forking behavior again.
"""

from src.pdf.extract import (  # noqa: F401
    HEADER_FOOTER_MARGIN,
    _looks_like_equation,
    _looks_like_reference,
    clean_text,
    classify_block_type,
    extract_pdf,
    is_header_footer,
    reconstruct_reading_order,
    write_text,
)
