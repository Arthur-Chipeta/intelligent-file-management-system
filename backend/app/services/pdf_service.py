import pdfplumber as PP

def text_extraction(pdf_path):
    text = ""

    with PP.open(pdf_path) as pdf:
        for page in pdf.pages:
            text += page.extract_text() or ""

    return text