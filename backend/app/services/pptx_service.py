from pptx import Presentation


def extract_pages(pptx_path):
    """Extract visible text from each PowerPoint slide."""
    presentation = Presentation(pptx_path)
    slides = []
    for number, slide in enumerate(presentation.slides, start=1):
        text_parts = []
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text.strip():
                text_parts.append(shape.text.strip())
        slides.append({"page": number, "text": "\n".join(text_parts)})
    return slides
