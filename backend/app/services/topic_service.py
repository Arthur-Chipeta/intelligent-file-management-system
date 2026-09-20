import re
from collections import defaultdict


TOPIC_ALIASES = {
    "Web Development": ["web development", "web programming", "frontend", "backend"],
    "HTML": ["html", "hypertext markup language"],
    "CSS": ["css", "cascading style sheets"],
    "JavaScript": ["javascript", "ecmascript"],
    "REST APIs": ["rest api", "restful", "http endpoint"],
    "Databases": ["database", "sql", "relational model"],
    "Authentication": ["authentication", "authorization", "jwt", "oauth"],
    "Operating Systems": ["operating system", "kernel"],
    "Process Scheduling": ["process scheduling", "cpu scheduling", "round robin"],
    "Memory Management": ["memory management", "virtual memory", "paging", "segmentation"],
    "Concurrency": ["concurrency", "thread", "semaphore", "deadlock", "mutex"],
    "Computer Networks": ["computer network", "networking"],
    "OSI Model": ["osi model", "osi layer"],
    "TCP/IP": ["tcp/ip", "tcp", "transmission control protocol"],
    "Routing": ["routing", "router", "shortest path"],
    "Subnetting": ["subnetting", "subnet mask", "cidr"],
    "Cybersecurity": ["cybersecurity", "information security", "encryption", "malware"],
    "Data Structures": ["data structure", "linked list", "stack", "queue", "binary tree"],
    "Algorithms": ["algorithm", "time complexity", "big o", "sorting algorithm"],
    "Machine Learning": ["machine learning", "supervised learning", "neural network"],
    "Computer Graphics": ["computer graphics", "rendering", "rasterization", "shading"],
}

GENERIC_HEADINGS = {
    "introduction", "overview", "agenda", "contents", "summary", "conclusion",
    "learning objectives", "references", "questions", "thank you", "lecture",
}


def _contains(text: str, phrase: str) -> int:
    pattern = rf"(?<!\w){re.escape(phrase)}(?!\w)"
    return len(re.findall(pattern, text, flags=re.IGNORECASE))


def extract_topics(pages: list[dict], limit: int = 10) -> list[dict]:
    """Extract explainable labels with confidence and page/slide references."""
    matches = []
    for topic, aliases in TOPIC_ALIASES.items():
        page_hits = []
        occurrences = 0
        for page in pages:
            count = sum(_contains(page["text"], alias) for alias in aliases)
            if count:
                page_hits.append(page["page"])
                occurrences += count
        if occurrences:
            confidence = min(0.99, 0.58 + occurrences * 0.06 + len(page_hits) * 0.03)
            matches.append({"name": topic, "confidence": round(confidence, 2), "pages": page_hits})

    known_names = {match["name"].lower() for match in matches}
    heading_pages = defaultdict(list)
    for page in pages:
        lines = [re.sub(r"\s+", " ", line).strip(" -:.") for line in page["text"].splitlines()]
        for heading in lines[:3]:
            words = heading.split()
            normalized = heading.lower()
            if (
                2 <= len(words) <= 7
                and 5 <= len(heading) <= 70
                and normalized not in GENERIC_HEADINGS
                and not heading.isdigit()
                and not any(char in heading for char in "{}[]=<>|")
            ):
                title = heading.title() if heading.isupper() else heading
                if title.lower() not in known_names and page["page"] not in heading_pages[title]:
                    heading_pages[title].append(page["page"])

    matches.sort(key=lambda item: (-item["confidence"], item["name"]))
    for heading, page_numbers in heading_pages.items():
        if len(matches) >= limit:
            break
        matches.append({
            "name": heading,
            "confidence": round(min(0.78, 0.55 + 0.05 * len(page_numbers)), 2),
            "pages": page_numbers,
        })
    return matches[:limit]
