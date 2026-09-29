import re

# ============================================================
# Major scientific-paper sections
# ============================================================

SECTION_ALIASES = {
    "abstract": {
        "abstract",
        "summary",
    },

    "introduction": {
        "introduction",
        "background",
        "background and introduction",
    },

    "results": {
        "results",
        "results and discussion",
        "findings",
    },

    "discussion": {
        "discussion",
        "general discussion",
        "discussion and conclusions",
        "conclusions",
        "conclusion",
    },

    "methods": {
        "methods",
        "method",
        "materials and methods",
        "materials & methods",
        "experimental procedures",
        "experimental procedures and methods",
        "methodology",
    },

    "references": {
        "references",
        "bibliography",
    },

    "supplementary": {
        "supplementary information",
        "supplementary materials",
        "supplementary methods",
    },
}


# ============================================================
# Known scientific subsections
# ============================================================

SUBSECTION_ALIASES = {
    "participants",
    "subjects",
    "sample",
    "study population",

    "stimuli",
    "materials",
    "apparatus",

    "data",
    "dataset",
    "data collection",
    "data acquisition",

    "experimental procedure",
    "experimental procedures",
    "procedure",

    "task",
    "behavioral task",
    "behavioral tasks",
    "behavior",

    "behavioral training",
    "behavioral training session",

    "meg sessions",
    "eeg sessions",
    "fmri sessions",

    "recording",

    "data analysis",
    "statistical analysis",
    "analysis",

    "preprocessing",
    "pre-processing",

    "trial exclusion",
    "exclusion criteria",

    "model",
    "model fitting",
    "computational model",

    "definition of sensory evidence",

    "analysis of choice and estimation reports",

    "reporting summary",
    "data availability",
    "code availability",
    "change history",
}


# ============================================================
# Block types that can never be section/subsection headings.
#
# Equations, figure/table captions, and references have already
# been positively identified as something else at extraction
# time (src/pdf/extract.py::classify_block_type). Re-running
# heading heuristics on them was the single biggest source of
# spurious subsections (e.g. an equation fragment or a figure
# axis label being promoted to a "heading"), so they're excluded
# from heading detection entirely.
# ============================================================

_NON_HEADING_TYPES = {"equation", "figure_caption", "table", "reference"}


# ============================================================
# Heading normalization
# ============================================================

def normalize_heading(text: str) -> str:
    text = text.strip()

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)

    # Remove common numbering:
    # 1.
    # 1)
    # 1.2
    # 1.2.3
    # I.
    # III.
    text = re.sub(
        r"^(?:"
        r"\d+(?:\.\d+)*[\.\)]?\s+"
        r"|"
        r"[IVXLCDM]+[\.\)]\s+"
        r")",
        "",
        text,
        flags=re.IGNORECASE,
    )

    # Remove trailing punctuation
    text = re.sub(r"[\.:;]+$", "", text)

    return text.lower().strip()


# ============================================================
# Heading-shape checks
# ============================================================

def looks_like_heading(line: str) -> bool:
    """
    Conservative check for whether a line looks like a real
    scientific subsection heading.

    This is deliberately strict because PDF extraction often
    produces equation fragments, figure/axis labels, and other
    short data annotations that look like short text lines.
    """

    if not line:
        return False

    text = line.strip()

    # Too long to plausibly be a heading
    if len(text) > 100:
        return False

    # Too short
    if len(text) < 3:
        return False

    # Headings should not end like normal prose/questions
    if text.endswith((".", "?", "!")):
        return False

    # Reject obvious mathematical/equation fragments
    math_chars = set("=~<>±×÷∑√∞^_{}[]")
    if any(char in text for char in math_chars):
        return False

    # Reject parenthetical asides. Real subsection headings in
    # scientific papers essentially never contain parentheses;
    # in practice, short parenthetical fragments here are almost
    # always figure/axis labels or data annotations that leaked
    # out of a plot (e.g. "Inconsistent (I)", "(consistent)",
    # "(SOA: 0.15 s)") rather than real headings.
    if "(" in text or ")" in text:
        return False

    # Reject lines where any whitespace-separated token is a
    # bare number (e.g. "Sample 1"). Real headings don't end in
    # an unlabeled digit; numbered *section* headings are handled
    # separately via the explicit numbering regex below.
    if any(token.isdigit() for token in text.split()):
        return False

    # Reject lines containing obvious equation-style patterns
    if re.search(
        r"\b(?:soa|hz|ms|sec|seconds?|s)\s*[:=~]",
        text,
        flags=re.IGNORECASE,
    ):
        return False

    # Reject lines that are overwhelmingly symbols/numbers
    alphanumeric = sum(c.isalnum() for c in text)
    if alphanumeric < 3:
        return False

    # Reject lines with too many digits.
    digit_count = sum(c.isdigit() for c in text)
    if digit_count > max(2, len(text) // 4):
        return False

    # Reject common equation / measurement fragments
    if re.search(
        r"^\s*[\d\W_]*"
        r"(?:s|ms|hz|khz|mv|cm|mm|°|%)"
        r"[\d\W_]*$",
        text,
        flags=re.IGNORECASE,
    ):
        return False

    # A real heading normally contains words.
    words = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿ]+", text)

    if not words:
        return False

    if len(words) > 12:
        return False

    return True


# ============================================================
# Major section detection
# ============================================================

def detect_major_section_heading(line: str):

    normalized = normalize_heading(line)

    if not normalized:
        return None

    for section, aliases in SECTION_ALIASES.items():

        if normalized in aliases:
            return section

    return None


# ============================================================
# Subsection detection
# ============================================================

def detect_subsection_heading(line: str):

    if not looks_like_heading(line):
        return None

    normalized = normalize_heading(line)

    if not normalized:
        return None

    # --------------------------------------------------------
    # Exact known subsection
    # --------------------------------------------------------

    if normalized in SUBSECTION_ALIASES:
        return normalized

    # --------------------------------------------------------
    # Numbered subsection
    #
    # Examples:
    # 2.1 Participants
    # 2.2 Stimuli
    # 3.1 Data analysis
    #
    # IMPORTANT:
    # We only accept numbered headings when the extracted
    # ORIGINAL line has an actual subsection number.
    # --------------------------------------------------------

    match = re.match(
        r"^\s*\d+(?:\.\d+)+[\.\)]?\s+(.+?)\s*$",
        line,
    )

    if match:

        title = match.group(1).strip()

        if not looks_like_heading(title):
            return None

        title_normalized = normalize_heading(title)

        words = title_normalized.split()

        if (
            title_normalized
            and len(title_normalized) <= 100
            and 1 <= len(words) <= 12
        ):
            return title_normalized

    return None


# ============================================================
# Main section splitter
# ============================================================

def split_into_sections(pages):
    """
    Split extracted pages into major sections / subsections.

    Preferred path: pages carry typed `blocks` (from
    src/pdf/extract.py). Each block is a paragraph-level unit
    that PyMuPDF already grouped correctly, so we classify it
    once and keep it intact — we do NOT re-split it into
    individual lines. Only blocks of type "paragraph" are ever
    considered as heading candidates; equations, figure/table
    captions, and references are structurally excluded (see
    `_NON_HEADING_TYPES`).

    Heading test: PyMuPDF frequently merges a heading with the
    following paragraph into ONE block (e.g. "Results\\nDuring
    MEG..."). Testing only the whole block would therefore miss
    every major section. We test the block's FIRST line as the
    heading candidate; any remaining lines become ordinary
    content of the (possibly new) section. This is deliberately
    conservative: only the first line is ever a candidate, and
    major sections still require an exact alias match.

    Legacy fallback: if a page has no `blocks` (e.g. pages built
    from raw text elsewhere), we fall back to the old line-based
    splitting so older callers/tests don't break.
    """

    sections = {}

    current_section = "front_matter"
    current_subsection = None

    sections[current_section] = []

    fallback_block_counter = 0

    for page in pages:

        page_number = page["page"]
        blocks = page.get("blocks")

        # ------------------------------------------------------
        # Preferred path: typed, block-level input.
        # ------------------------------------------------------

        if blocks:

            for block in blocks:

                if not isinstance(block, dict):
                    continue

                text = str(block.get("text", "")).strip()

                if not text:
                    continue

                block_type = block.get("type", "paragraph")
                block_id = block.get("block_id")

                if block_id is None:
                    fallback_block_counter += 1
                    block_id = f"p{page_number}_b{fallback_block_counter}"

                # ------------------------------------------
                # Only paragraph-shaped blocks can ever be a
                # section/subsection heading. Equations,
                # figure/table captions and references are
                # never candidates. The candidate is the
                # block's FIRST line: headings are routinely
                # merged with body text into one block.
                # ------------------------------------------

                first_line = text.splitlines()[0].strip() \
                    if text.splitlines() else ""
                rest_lines = text.splitlines()[1:]

                rest = "\n".join(
                    line for line in rest_lines
                    if line.strip()
                ).strip()

                if (
                    block_type not in _NON_HEADING_TYPES
                    and first_line
                ):

                    major_section = detect_major_section_heading(
                        first_line
                    )

                    if major_section is not None:

                        current_section = major_section
                        current_subsection = None

                        sections.setdefault(current_section, [])

                        if rest:

                            sections[current_section].append({
                                "page": page_number,
                                "text": rest,
                                "subsection": None,
                                "is_heading": False,
                                "type": block_type,
                                "block_id": f"{block_id}#r",
                                "unit": "block",
                            })

                        continue

                    subsection = detect_subsection_heading(
                        first_line
                    )

                    if subsection is not None:

                        current_subsection = subsection

                        sections.setdefault(
                            current_section, []
                        ).append({
                            "page": page_number,
                            "text": first_line,
                            "subsection": current_subsection,
                            "is_heading": True,
                            "type": "heading",
                            "block_id": block_id,
                            "unit": "block",
                        })

                        if rest:

                            sections[current_section].append({
                                "page": page_number,
                                "text": rest,
                                "subsection": current_subsection,
                                "is_heading": False,
                                "type": block_type,
                                "block_id": f"{block_id}#r",
                                "unit": "block",
                            })

                        continue

                # ------------------------------------------
                # Ordinary content block (paragraph, equation,
                # figure_caption, table, reference, unknown).
                # ------------------------------------------

                sections.setdefault(
                    current_section, []
                ).append({
                    "page": page_number,
                    "text": text,
                    "subsection": current_subsection,
                    "is_heading": False,
                    "type": block_type,
                    "block_id": block_id,
                    "unit": "block",
                })

            continue

        # ------------------------------------------------------
        # Legacy fallback: no `blocks`, only flat `text`.
        # ------------------------------------------------------

        text = page.get("text", "")

        if not text:
            continue

        if isinstance(text, list):
            lines = text
        else:
            lines = text.splitlines()

        for raw_line in lines:

            if isinstance(raw_line, dict):
                line = str(raw_line.get("text", "")).strip()
            else:
                line = str(raw_line).strip()

            if not line:

                if sections[current_section]:

                    sections[current_section].append({
                        "page": page_number,
                        "text": "",
                        "subsection": current_subsection,
                        "is_heading": False,
                        "type": "unknown",
                        "block_id": None,
                        "unit": "line",
                    })

                continue

            major_section = detect_major_section_heading(line)

            if major_section is not None:

                current_section = major_section
                current_subsection = None

                sections.setdefault(current_section, [])

                continue

            subsection = detect_subsection_heading(line)

            if subsection is not None:

                current_subsection = subsection

                fallback_block_counter += 1

                sections.setdefault(
                    current_section, []
                ).append({
                    "page": page_number,
                    "text": line,
                    "subsection": current_subsection,
                    "is_heading": True,
                    "type": "heading",
                    "block_id": f"p{page_number}_b{fallback_block_counter}",
                    "unit": "line",
                })

                continue

            fallback_block_counter += 1

            sections.setdefault(
                current_section, []
            ).append({
                "page": page_number,
                "text": line,
                "subsection": current_subsection,
                "is_heading": False,
                "type": "paragraph",
                "block_id": f"p{page_number}_b{fallback_block_counter}",
                "unit": "line",
            })

    return sections


# ============================================================
# Backwards-compatible section_text()
# ============================================================

def section_text(lines):

    """
    Compatibility helper for the existing chunker.py.

    The old chunker passes a list of section lines here.

    We simply convert that list into plain text.

    IMPORTANT:
    We do NOT run section detection again.
    The sections have already been detected.
    """

    if isinstance(lines, str):
        return lines

    if not lines:
        return ""

    output = []

    for item in lines:

        if isinstance(item, dict):

            text = item.get(
                "text",
                "",
            )

        else:

            text = str(item)

        if text:
            output.append(text)

    return "\n".join(output)


# ============================================================
# Section text helper
# ============================================================

def get_section_text(section_items):

    return "\n".join(
        item["text"]
        for item in section_items
        if item.get("text")
    )


# ============================================================
# Diagnostics
# ============================================================

def summarize_sections(sections):

    summary = {}

    for section, items in sections.items():

        text_items = [
            item
            for item in items
            if item.get("text")
        ]

        text_length = sum(
            len(item["text"])
            for item in text_items
        )

        subsections = []

        for item in items:

            subsection = item.get(
                "subsection"
            )

            if (
                subsection
                and subsection not in subsections
            ):
                subsections.append(
                    subsection
                )

        pages = sorted(
            set(
                item["page"]
                for item in items
                if "page" in item
            )
        )

        summary[section] = {
            "characters": text_length,
            "pages": pages,
            "subsections": subsections,
        }

    return summary