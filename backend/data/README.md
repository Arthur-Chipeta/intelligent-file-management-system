# UNZA classifier data

This directory contains a curriculum-aware seed dataset for the resource classifier.

## Files

- `unza_cs_taxonomy.json` is the authoritative project taxonomy. It contains course codes, evidenced course names, broad classifier categories, keywords, aliases, verification status, and source identifiers.
- `unza_cs_classifier_seed.csv` contains six deterministic examples per course. These examples help develop and smoke-test the classifier.
- `build_unza_classifier_seed.py` regenerates the CSV from the taxonomy.

## Intended use

The application loads the JSON taxonomy at startup and merges its aliases, course names, and keywords into the existing category profiles. Exact course codes receive the classifier's strongest evidence weight.

The CSV is deliberately balanced by course and contains filename, title-page, assignment, lecture-heading, revision-note, and code-free examples. Every row is marked `synthetic_from_taxonomy` and `eligible_for_scientific_evaluation=false`.

Do not use the synthetic rows to report scientific accuracy. Sprint 2 should evaluate on independently collected, human-labelled documents or webpages that were not used to define these profiles. Add real observations to a separate immutable evaluation set with annotator agreement and provenance.

## Verification policy

- `confirmed_current`: course title has official support and the course code appears in recent examination evidence.
- `confirmed_historical`: exact code and title are supported by an official UNZA record, but recent offering evidence was not found in the sources reviewed.
- `corroborated_current`: recent course-code evidence and a separate secondary title source agree.
- `secondary_source_only`: the reviewed evidence is secondary and requires an official curriculum document.
- `needs_official_confirmation`: retained as a useful candidate label, but no sufficiently reliable source was located.

The taxonomy preserves uncertainty about programme structure. Current UNZA webpages list four separate undergraduate programmes, while older material describes Software Engineering and Computer Systems Engineering as Computer Science options. The data does not infer Networking and Information Security membership solely from course names.
