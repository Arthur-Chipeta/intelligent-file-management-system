from app.services.pdf_service import text_extraction

pdf_path = "backend/sample.pdf"

text = text_extraction(pdf_path)

print(text)