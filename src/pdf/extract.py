from pathlib import Path
import re

import fitz  # PyMuPDF


# ============================================================
# Configuration
# ============================================================

# Text close to the top/bottom of a page is often a journal
# header/footer rather than article content.
HEADER_FOOTER_MARGIN = 45


# ============================================================
# Helpers
# ============================================================

def clean_text(text: str) -> str:
    """
    Basic cleanup of extracted PDF text.
    """

    text = text.replace("\u00ad", "")  # soft hyphen

    # Fix hyphenation caused by line wrapping:
    #
    # infor-
    # mation
    #
    # becomes:
    #
    # information
    text = re.sub(
        r"(\w)-\s*\n\s*(\w)",
        r"\1\2",
        text,
    )

    # Normalize whitespace while preserving line breaks.
    text = re.sub(
        r"[ \t]+",
        " ",
        text,
    )

    return text.strip()


def is_header_footer(
    block,
    page_height: float,
) -> bool:
    """
    Identify obvious running headers/footers.

    We use position rather than content because journal
    headers/footers vary between papers.
    """

    x0, y0, x1, y1 = block["bbox"]

    if y0 <= HEADER_FOOTER_MARGIN:
        return True

    if y1 >= page_height - HEADER_FOOTER_MARGIN:
        return True

    return False


# ============================================================
# Block type classification
#
# Runs once, at extraction time, on each individual PDF block.
# Gives every downstream stage (sectioner, chunker, validator)
# a shared answer to "what kind of thing is this text?" instead
# of each stage re-guessing from scratch.
#
# Conservative: a block is only tagged as something other than
# "paragraph" when it clearly matches a known shape. Ambiguous
# blocks fall through to "paragraph" and may still be recognized
# as a heading later, in the sectioner, where section/subsection
# context is available.
# ============================================================

_MATH_SYMBOL_CHARS = set("=+\u2212±×÷≈≠≤≥∑∏√∞<>~^_")


def _looks_like_equation(text: str) -> bool:
    """
    Detect isolated mathematical fragments such as:

        X = p(x,ri,t)
        i + β1
        I(X;Ri,t) =
    """

    if len(text) > 150:
        return False

    symbol_count = sum(
        1
        for char in text
        if char in _MATH_SYMBOL_CHARS
    )

    if symbol_count == 0:
        return False

    # "Real" words: alphabetic runs of 2+ characters. Single
    # letters (x, i, t) are usually variable names, not words.
    words = re.findall(
        r"[A-Za-zÀ-ÖØ-öø-ÿ\u0370-\u03FF]{2,}",
        text,
    )

    if len(words) <= 4:
        return True

    if len(text) > 0 and (symbol_count / len(text)) > 0.12 and len(words) <= 8:
        return True

    return False


def _looks_like_reference(text: str) -> bool:
    """
    Detect bibliography-style entries, e.g.:

        [12] Smith, J. et al. ...
        3. Jones, A., Lee, B. ...
    """

    if re.match(r"^\[\d+\]", text):
        return True

    if re.match(
        r"^\d{1,3}\.\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ\-']+(,|\s+et al\.?)",
        text,
    ):
        return True

    return False


def classify_block_type(text: str) -> str:
    """
    Classify a single extracted block as one of:

        paragraph | equation | figure_caption | table |
        reference | unknown

    NOTE: "heading" is intentionally never returned here. Whether
    something is a section/subsection heading depends on
    document-level context that only the sectioner has.
    """

    t = text.strip()

    if not t:
        return "unknown"

    if re.match(r"^(figure|fig\.?)\s*\d+\b", t, re.IGNORECASE):
        return "figure_caption"

    if re.match(r"^table\s*\d+\b", t, re.IGNORECASE):
        return "table"

    if _looks_like_equation(t):
        return "equation"

    if _looks_like_reference(t):
        return "reference"

    return "paragraph"


# ============================================================
# Column ordering
# ============================================================

def reconstruct_reading_order(blocks, page_width):
    """
    Reconstruct approximate reading order for a two-column PDF.

    The goal is:

        left column top -> bottom
        right column top -> bottom

    rather than:

        arbitrary PDF object order

    Each returned item remains a block with its original
    coordinates.
    """

    if not blocks:
        return []

    # --------------------------------------------------------
    # Determine whether the page is likely two-column.
    # --------------------------------------------------------

    blocks_sorted_x = sorted(
        blocks,
        key=lambda b: b["bbox"][0],
    )

    # Block centres
    centers = [
        (
            block["bbox"][0]
            + block["bbox"][2]
        ) / 2
        for block in blocks_sorted_x
    ]

    # Look for a large horizontal gap between blocks.
    gaps = []

    for i in range(len(blocks_sorted_x) - 1):

        right_edge = blocks_sorted_x[i]["bbox"][2]
        left_edge = blocks_sorted_x[i + 1]["bbox"][0]

        gap = left_edge - right_edge

        gaps.append(
            (
                gap,
                i,
            )
        )

    # A journal page generally has a meaningful central gap.
    # We don't want to classify ordinary text spacing as a
    # column break.
    column_gap = max(
        gaps,
        key=lambda x: x[0],
    ) if gaps else (0, 0)

    gap_size, gap_index = column_gap

    likely_two_columns = (
        len(blocks) >= 6
        and gap_size > page_width * 0.08
    )

    # --------------------------------------------------------
    # Single-column page
    # --------------------------------------------------------

    if not likely_two_columns:

        return sorted(
            blocks,
            key=lambda b: (
                b["bbox"][1],
                b["bbox"][0],
            ),
        )

    # --------------------------------------------------------
    # Two-column page
    # --------------------------------------------------------

    split_x = (
        blocks_sorted_x[gap_index]["bbox"][2]
        + blocks_sorted_x[gap_index + 1]["bbox"][0]
    ) / 2

    left = []
    right = []

    for block in blocks:

        center_x = (
            block["bbox"][0]
            + block["bbox"][2]
        ) / 2

        if center_x < split_x:
            left.append(block)
        else:
            right.append(block)

    # Sort each column top-to-bottom.
    left.sort(
        key=lambda b: (
            b["bbox"][1],
            b["bbox"][0],
        )
    )

    right.sort(
        key=lambda b: (
            b["bbox"][1],
            b["bbox"][0],
        )
    )

    return left + right


# ============================================================
# PDF extraction
# ============================================================

def extract_pdf(path: str):
    """
    Extract a PDF into ordered page/block structures.

    Returns:

        [
            {
                "page": 1,
                "width": ...,
                "height": ...,
                "blocks": [
                    {
                        "block_id": "p1_b3",
                        "page": 1,
                        "text": "...",
                        "type": "paragraph",
                        "bbox": [...],
                        "block_no": ...
                    }
                ],
                "text": "..."
            },
            ...
        ]

    Each block carries a stable `block_id` and a `type` (see
    `classify_block_type`) so downstream stages don't re-derive
    them. The `text` field is retained for compatibility.
    """

    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(
            f"PDF not found: {path}"
        )

    document = fitz.open(path)

    pages = []

    try:

        for page_number, page in enumerate(
            document,
            start=1,
        ):

            page_width = page.rect.width
            page_height = page.rect.height

            raw_blocks = page.get_text(
                "blocks"
            )

            blocks = []

            for block_number, raw in enumerate(
                raw_blocks
            ):

                # PyMuPDF block format:
                #
                # x0, y0, x1, y1, text,
                # block_no, block_type
                x0, y0, x1, y1, text = raw[:5]

                block_type = (
                    raw[6]
                    if len(raw) > 6
                    else 0
                )

                # Ignore image blocks.
                if block_type != 0:
                    continue

                text = clean_text(text)

                if not text:
                    continue

                block = {
                    "block_id": f"p{page_number}_b{block_number}",
                    "page": page_number,
                    "text": text,
                    "type": classify_block_type(text),
                    "bbox": [
                        float(x0),
                        float(y0),
                        float(x1),
                        float(y1),
                    ],
                    "block_no": block_number,
                }

                # Remove obvious journal headers/footers.
                if is_header_footer(
                    block,
                    page_height,
                ):
                    continue

                blocks.append(block)

            # Reconstruct reading order.
            blocks = reconstruct_reading_order(
                blocks,
                page_width,
            )

            # ------------------------------------------------
            # Compatibility text representation
            # ------------------------------------------------

            text_parts = [
                block["text"]
                for block in blocks
            ]

            page_text = "\n\n".join(
                text_parts
            )

            pages.append({
                "page": page_number,
                "width": float(page_width),
                "height": float(page_height),
                "blocks": blocks,
                "text": page_text,
            })

    finally:
        document.close()

    return pages


# ============================================================
# Write extracted text
# ============================================================

def write_text(pages, out: str):

    output = Path(out)

    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with output.open(
        "w",
        encoding="utf-8",
    ) as f:

        for page in pages:

            f.write(
                f"\n\n=== PAGE "
                f"{page['page']} ===\n\n"
            )

            f.write(
                page["text"]
            )