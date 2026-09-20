import pdfplumber as PP


def extract_pages(pdf_path):
    """Return PDF text while preserving one-based page references."""
    with PP.open(pdf_path) as pdf:
        return [
            {"page": number, "text": page.extract_text() or ""}
            for number, page in enumerate(pdf.pages, start=1)
        ]


def text_extraction(pdf_path):
    return "\n".join(page["text"] for page in extract_pages(pdf_path))
