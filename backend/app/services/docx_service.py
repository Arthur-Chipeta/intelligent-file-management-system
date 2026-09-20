from docx import Document


def extract_pages(docx_path):
    """Return DOCX text as a single logical page for topic references."""
    document = Document(docx_path)
    return [{"page": 1, "text": "\n".join(p.text for p in document.paragraphs)}]


def text_extraction(docx_path):
    return extract_pages(docx_path)[0]["text"]
