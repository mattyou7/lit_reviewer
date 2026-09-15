import re
from typing import List, Dict


SECTION_ALIASES = {
    "abstract": [
        "abstract",
    ],
    "introduction": [
        "introduction",
        "background",
    ],
    "methods": [
        "methods",
        "method",
        "materials and methods",
        "experimental procedures",
        "experimental procedures and methods",
    ],
    "results": [
        "results",
        "results and discussion",
    ],
    "discussion": [
        "discussion",
        "general discussion",
    ],
    "references": [
        "references",
        "bibliography",
    ],
}


def normalize_heading(text: str) -> str:
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"^[\dIVXivx]+[\.\)]\s*", "", text)
    return text.lower()


def detect_section_heading(line: str):
    normalized = normalize_heading(line)

    for section, aliases in SECTION_ALIASES.items():
        if normalized in aliases:
            return section

    return None


def split_into_sections(pages: List[Dict]) -> Dict[str, List[Dict]]:
    sections = {}
    current_section = "front_matter"
    sections[current_section] = []

    for page in pages:
        page_number = page["page"]
        text = page["text"]

        for line in text.splitlines():
            line = line.strip()

            if not line:
                continue

            detected = detect_section_heading(line)

            if detected:
                current_section = detected
                sections.setdefault(current_section, [])
                continue

            sections.setdefault(current_section, []).append({
                "page": page_number,
                "text": line,
            })

    return sections


def section_text(section_lines: List[Dict]) -> str:
    return "\n".join(item["text"] for item in section_lines)