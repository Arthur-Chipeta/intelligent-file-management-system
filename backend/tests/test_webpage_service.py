from app.services import webpage_service


class FakeResponse:
    def __init__(self, *, text="", json_data=None):
        self.text = text
        self._json_data = json_data or {}

    def raise_for_status(self):
        return None

    def json(self):
        return self._json_data


def test_youtube_uses_oembed_title_instead_of_generic_page_title(monkeypatch):
    def fake_get(url, **kwargs):
        if url == "https://www.youtube.com/oembed":
            assert kwargs["params"]["url"] == "https://www.youtube.com/watch?v=it1rTvBcfRg"
            return FakeResponse(json_data={"title": "Learn HTML for Beginners - W3Schools.com"})
        return FakeResponse(text="<html><head><title>- YouTube</title></head><body>Video</body></html>")

    monkeypatch.setattr(webpage_service.requests, "get", fake_get)
    result = webpage_service.extract_webpage_content(
        "https://www.youtube.com/watch?v=it1rTvBcfRg"
    )

    assert result["title"] == "Learn HTML for Beginners - W3Schools.com"


def test_webpage_prefers_open_graph_title(monkeypatch):
    html = """
    <html><head>
      <title>Short browser title</title>
      <meta property="og:title" content="Complete Article Title" />
    </head><body><main>Article content</main></body></html>
    """
    monkeypatch.setattr(
        webpage_service.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(text=html),
    )

    result = webpage_service.extract_webpage_content("https://example.com/article")

    assert result["title"] == "Complete Article Title"
    assert "Article content" in result["text"]
