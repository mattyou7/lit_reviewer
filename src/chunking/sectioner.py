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
# Heading normalization
# ============================================================

def normalize_heading(text: str) -> str:

    text = text.strip()

    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)

    # Remove common numbering:
    #
    # 1.
    # 1)
    # 1.2
    # 1.2.3
    # I.
    # III.
    #
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
    text = re.sub(
        r"[\.:;]+$",
        "",
        text,
    )

    return text.lower().strip()


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
    # --------------------------------------------------------
    #
    # Examples:
    #
    # 2.1 Participants
    # 2.2 Stimuli
    # 3.1 Data analysis
    #
    # We only accept numbered headings when the text after
    # the number looks like a plausible heading.
    # --------------------------------------------------------

    match = re.match(
        r"^\s*\d+(?:\.\d+)+[\.\)]?\s+(.+?)\s*$",
        line,
    )

    if match:

        title = normalize_heading(
            match.group(1)
        )

        words = title.split()

        if (
            title
            and len(title) <= 100
            and 1 <= len(words) <= 12
            and not title.endswith(
                (".", "?", "!")
            )
        ):
            return title

    return None


# ============================================================
# Main section splitter
# ============================================================

def split_into_sections(pages):

    sections = {}

    current_section = "front_matter"
    current_subsection = None

    sections[current_section] = []

    for page in pages:

        page_number = page["page"]
        text = page.get("text", "")

        if not text:
            continue

        # ----------------------------------------------------
        # IMPORTANT:
        #
        # The function accepts both:
        #
        #   {"page": 1, "text": "..."}
        #
        # and the old internal list format.
        # ----------------------------------------------------

        if isinstance(text, list):

            lines = text

        else:

            lines = text.splitlines()

        for raw_line in lines:

            # ------------------------------------------------
            # Support old list entries
            # ------------------------------------------------

            if isinstance(raw_line, dict):

                line = raw_line.get(
                    "text",
                    "",
                ).strip()

            else:

                line = str(raw_line).strip()

            # ------------------------------------------------
            # Blank line
            # ------------------------------------------------

            if not line:

                if sections[current_section]:

                    sections[current_section].append({
                        "page": page_number,
                        "text": "",
                        "subsection": current_subsection,
                        "is_heading": False,
                    })

                continue

            # ------------------------------------------------
            # Major section
            # ------------------------------------------------

            major_section = detect_major_section_heading(
                line
            )

            if major_section is not None:

                current_section = major_section
                current_subsection = None

                sections.setdefault(
                    current_section,
                    [],
                )

                continue

            # ------------------------------------------------
            # Subsection
            # ------------------------------------------------

            subsection = detect_subsection_heading(
                line
            )

            if subsection is not None:

                current_subsection = subsection

                sections.setdefault(
                    current_section,
                    [],
                ).append({
                    "page": page_number,
                    "text": line,
                    "subsection": current_subsection,
                    "is_heading": True,
                })

                continue

            # ------------------------------------------------
            # Normal text
            # ------------------------------------------------

            sections.setdefault(
                current_section,
                [],
            ).append({
                "page": page_number,
                "text": line,
                "subsection": current_subsection,
                "is_heading": False,
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