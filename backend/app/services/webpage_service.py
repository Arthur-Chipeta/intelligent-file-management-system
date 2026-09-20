import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse


def extract_webpage_content(url: str):
    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    title = soup.title.string.strip() if soup.title and soup.title.string else "No title found"

    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()

    text = soup.get_text(separator=" ", strip=True)

    return {
        "url": url,
        "domain": urlparse(url).netloc,
        "title": title,
        "text": text
    }