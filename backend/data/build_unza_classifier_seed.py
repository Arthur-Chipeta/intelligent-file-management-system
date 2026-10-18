"""Generate deterministic, training-only seed examples from the UNZA taxonomy."""

from __future__ import annotations

import csv
import json
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parent
TAXONOMY_PATH = DATA_DIR / "unza_cs_taxonomy.json"
OUTPUT_PATH = DATA_DIR / "unza_cs_classifier_seed.csv"


FIELDNAMES = [
    "sample_id",
    "text",
    "label",
    "course_code",
    "course_name",
    "year",
    "legacy_stream_scope",
    "document_style",
    "difficulty",
    "verification_status",
    "provenance",
    "eligible_for_scientific_evaluation",
    "source_ids",
]


def sample_texts(course: dict) -> list[tuple[str, str, str]]:
    code = course["course_code"]
    compact_code = code.replace(" ", "")
    name = course["official_name"]
    terms = course["keywords"]
    first = ", ".join(terms[:4])
    second = ", ".join(terms[4:8])
    return [
        ("filename", "easy", f"{compact_code}_{name.replace(' ', '_')}_lecture_notes.pdf"),
        ("title_page", "easy", f"{code}: {name}\nLecture notes and worked examples"),
        ("assignment", "medium", f"Assignment for {name}. Questions cover {first}."),
        ("lecture_heading", "medium", f"{name}\nThis lecture introduces {first} and includes practical exercises."),
        ("revision_notes", "medium", f"Revision topics: {second}. Key ideas are applied through examples and tutorial questions."),
        ("code_free_content", "hard", f"The material explains {first}. It also examines {second}."),
    ]


def build_rows(taxonomy: dict) -> list[dict]:
    rows = []
    for course_index, course in enumerate(taxonomy["courses"], start=1):
        for sample_index, (style, difficulty, text) in enumerate(sample_texts(course), start=1):
            rows.append(
                {
                    "sample_id": f"UNZA-{course_index:03d}-{sample_index:02d}",
                    "text": text,
                    "label": course["classifier_category"],
                    "course_code": course["course_code"],
                    "course_name": course["official_name"],
                    "year": course["year"],
                    "legacy_stream_scope": "|".join(course["legacy_stream_scope"]),
                    "document_style": style,
                    "difficulty": difficulty,
                    "verification_status": course["verification_status"],
                    "provenance": "synthetic_from_taxonomy",
                    "eligible_for_scientific_evaluation": "false",
                    "source_ids": "|".join(course["source_ids"]),
                }
            )
    return rows


def main() -> None:
    taxonomy = json.loads(TAXONOMY_PATH.read_text(encoding="utf-8"))
    rows = build_rows(taxonomy)
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
