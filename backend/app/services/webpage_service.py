import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse


def _meta_title(soup: BeautifulSoup) -> str:
    selectors = (
        ('meta[property="og:title"]', "content"),
        ('meta[name="twitter:title"]', "content"),
    )
    for selector, attribute in selectors:
        tag = soup.select_one(selector)
        value = tag.get(attribute) if tag else None
        if value and value.strip():
            return " ".join(value.split())
    if soup.title:
        return " ".join(soup.title.get_text(" ", strip=True).split())
    return ""


def _is_youtube_url(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return hostname == "youtu.be" or hostname == "youtube.com" or hostname.endswith(".youtube.com")


def _youtube_title(url: str, headers: dict) -> str:
    try:
        response = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            headers=headers,
            timeout=10,
        )
        response.raise_for_status()
        title = response.json().get("title", "")
        return " ".join(title.split())
    except (requests.RequestException, ValueError, AttributeError):
        return ""


def extract_webpage_content(url: str):
    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    is_youtube = _is_youtube_url(url)
    youtube_title = _youtube_title(url, headers) if is_youtube else ""

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        html = response.text
    except requests.RequestException:
        if not youtube_title:
            raise
        html = ""

    soup = BeautifulSoup(html, "html.parser")

    title = youtube_title or _meta_title(soup)
    if is_youtube and title.lower().endswith(" - youtube"):
        title = title[:-10].strip()
    if not title or title.lower() in {"youtube", "- youtube"}:
        domain = (urlparse(url).hostname or "webpage").removeprefix("www.")
        title = "YouTube video" if is_youtube else f"Resource from {domain}"

    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()

    text = soup.get_text(separator=" ", strip=True) or title

    return {
        "url": url,
        "domain": urlparse(url).netloc,
        "title": title,
        "text": text
    }
