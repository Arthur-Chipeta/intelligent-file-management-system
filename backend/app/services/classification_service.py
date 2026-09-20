import math
import os
import re
from collections import Counter


ALLOWED_EXTENSIONS = {
    ".pdf": "PDF",
    ".docx": "DOCX",
    ".pptx": "PPTX",
    ".jpg": "IMAGE",
    ".jpeg": "IMAGE",
    ".png": "IMAGE",
    ".mp4": "VIDEO",
}


# Broad undergraduate Computer Science taxonomy. Profiles deliberately use
# course-specific phrases rather than ambiguous words such as "process".
CATEGORY_PROFILES = {
    "Programming Fundamentals": ["programming fundamentals", "variables", "control structures", "functions", "problem solving", "introductory programming"],
    "Object-Oriented Programming": ["object oriented programming", "classes and objects", "inheritance", "polymorphism", "encapsulation", "abstraction"],
    "Data Structures and Algorithms": ["data structures", "algorithms", "linked lists", "stacks", "queues", "trees", "graphs", "sorting", "searching", "time complexity", "big o"],
    "Discrete Mathematics": ["discrete mathematics", "propositional logic", "set theory", "combinatorics", "graph theory", "mathematical induction", "recurrence relations"],
    "Theory of Computation": ["theory of computation", "automata", "formal languages", "turing machine", "computability", "regular expressions", "context free grammar"],
    "Compiler Design": ["compiler design", "lexical analysis", "syntax analysis", "parsing", "semantic analysis", "code generation", "symbol table"],
    "Computer Architecture": ["computer architecture", "instruction set", "cpu architecture", "pipelining", "cache memory", "assembly language", "microprocessor"],
    "Operating Systems": ["operating systems", "operating system", "kernel", "cpu scheduling", "process scheduling", "virtual memory", "paging", "deadlock", "semaphore", "file system"],
    "Computer Networks": ["computer networks", "computer networking", "osi model", "tcp/ip", "routing protocols", "subnetting", "network topology", "packet switching"],
    "Database Systems": ["database systems", "database management", "dbms", "relational database", "sql", "normalization", "transaction management", "entity relationship model"],
    "Software Engineering": ["software engineering", "software development lifecycle", "requirements engineering", "software design", "software testing", "software quality", "agile development", "uml"],
    "Web Programming": ["web programming", "web development", "html", "css", "javascript", "frontend development", "backend development", "rest api", "http"],
    "Mobile Application Development": ["mobile application development", "mobile computing", "android development", "ios development", "flutter", "react native", "mobile user interface"],
    "Human-Computer Interaction": ["human computer interaction", "user experience", "user interface design", "usability", "interaction design", "accessibility", "user research"],
    "Computer Graphics": ["computer graphics", "graphics and visual computing", "rendering", "rasterization", "geometric transformations", "shading", "computer animation", "opengl"],
    "Artificial Intelligence": ["artificial intelligence", "intelligent agents", "knowledge representation", "expert systems", "heuristic search", "planning", "reasoning"],
    "Machine Learning": ["machine learning", "supervised learning", "unsupervised learning", "regression", "model training", "feature engineering", "neural networks"],
    "Data Mining": ["data mining", "knowledge discovery", "kdd", "association rules", "frequent itemsets", "clustering", "data preprocessing", "pattern discovery", "classification techniques"],
    "Data Science": ["data science", "data analytics", "exploratory data analysis", "data visualization", "statistical analysis", "pandas", "data wrangling"],
    "Information Retrieval": ["information retrieval", "search engines", "document indexing", "ranking models", "inverted index", "relevance feedback", "query processing"],
    "Natural Language Processing": ["natural language processing", "nlp", "text processing", "language model", "tokenization", "sentiment analysis", "named entity recognition"],
    "Computer Vision": ["computer vision", "image processing", "image recognition", "object detection", "image segmentation", "feature detection", "convolutional neural network"],
    "Cybersecurity": ["cybersecurity", "computer security", "information security", "cryptography", "network security", "malware", "access control", "security threats"],
    "Distributed Systems": ["distributed systems", "distributed computing", "consensus", "replication", "fault tolerance", "distributed transactions", "message passing"],
    "Cloud Computing": ["cloud computing", "virtualization", "cloud services", "infrastructure as a service", "platform as a service", "software as a service", "containers"],
    "Parallel Computing": ["parallel computing", "parallel programming", "multiprocessing", "gpu computing", "shared memory", "openmp", "cuda"],
    "Internet of Things": ["internet of things", "iot", "embedded sensors", "smart devices", "sensor networks", "mqtt", "edge computing"],
    "DevOps": ["devops", "continuous integration", "continuous delivery", "ci/cd", "infrastructure as code", "docker", "kubernetes", "deployment pipeline"],
    "Blockchain": ["blockchain", "distributed ledger", "smart contracts", "consensus mechanism", "cryptocurrency", "ethereum"],
    "Research Methods in Computing": ["research methods", "research methodology", "literature review", "research design", "data collection", "academic writing", "research ethics"],
}

COURSE_CODES = {
    "csc4035": "Web Programming",
    "csc 4035": "Web Programming",
    "csc4505": "Computer Graphics",
    "csc 4505": "Computer Graphics",
    "csc4792": "Data Mining",
    "csc 4792": "Data Mining",
}

TOKEN_PATTERN = re.compile(r"[a-z][a-z0-9+#.-]{1,}")


def detect_resource_type(filename):
    return ALLOWED_EXTENSIONS.get(os.path.splitext(filename)[1].lower(), "UNKNOWN")


def available_categories() -> list[str]:
    return sorted(CATEGORY_PROFILES)


def _phrase_count(text: str, phrase: str) -> int:
    return len(re.findall(rf"(?<!\w){re.escape(phrase)}(?!\w)", text))


def _tokens(text: str) -> list[str]:
    return TOKEN_PATTERN.findall(text.lower())


def _cosine_similarity(document: str, profile: str, documents: list[str]) -> float:
    doc_tokens = Counter(_tokens(document))
    profile_tokens = Counter(_tokens(profile))
    if not doc_tokens or not profile_tokens:
        return 0.0
    document_frequency = Counter()
    for text in documents:
        document_frequency.update(set(_tokens(text)))
    total = len(documents)

    def vector(counts):
        return {
            token: (1 + math.log(count)) * (math.log((total + 1) / (document_frequency[token] + 1)) + 1)
            for token, count in counts.items()
        }

    left, right = vector(doc_tokens), vector(profile_tokens)
    shared = set(left) & set(right)
    numerator = sum(left[token] * right[token] for token in shared)
    denominator = math.sqrt(sum(value * value for value in left.values())) * math.sqrt(
        sum(value * value for value in right.values())
    )
    return numerator / denominator if denominator else 0.0


def classify_document(filename: str, pages: list[dict]) -> dict:
    """Classify structured content and return an explainable ranked prediction."""
    filename_text = os.path.splitext(os.path.basename(filename))[0].lower().replace("_", " ")
    headings = []
    for page in pages:
        headings.extend(line.strip() for line in page.get("text", "").splitlines()[:3] if line.strip())
    heading_text = " ".join(headings).lower()
    content_text = " ".join(page.get("text", "") for page in pages).lower()

    code_category = next(
        (category for code, category in COURSE_CODES.items() if code in filename_text or code in content_text[:3000]),
        None,
    )
    profile_documents = [" ".join(terms) for terms in CATEGORY_PROFILES.values()]
    semantic_documents = [content_text[:30000], *profile_documents]
    scored = []
    for category, terms in CATEGORY_PROFILES.items():
        filename_hits = sum(_phrase_count(filename_text, term) for term in terms)
        heading_hits = sum(_phrase_count(heading_text, term) for term in terms)
        content_hits = sum(_phrase_count(content_text, term) for term in terms)
        semantic = _cosine_similarity(content_text[:30000], " ".join(terms), semantic_documents)
        score = min(0.2, filename_hits * 0.12)
        score += min(0.25, heading_hits * 0.08)
        score += min(0.3, content_hits * 0.025)
        score += semantic * 0.25
        if code_category == category:
            score += 0.55
        scored.append((category, min(score, 1.0)))

    scored.sort(key=lambda item: (-item[1], item[0]))
    top_category, top_score = scored[0]
    second_score = scored[1][1]
    margin = top_score - second_score
    if top_score < 0.08:
        return {
            "category": "General",
            "confidence": 0.35,
            "review_required": True,
            "rankings": [{"category": name, "score": round(score, 3)} for name, score in scored[:3]],
            "source": "automatic",
        }
    confidence = min(0.99, 0.5 + top_score * 0.38 + max(0, margin) * 0.3)
    return {
        "category": top_category,
        "confidence": round(confidence, 3),
        "review_required": confidence < 0.68 or margin < 0.06,
        "rankings": [{"category": name, "score": round(score, 3)} for name, score in scored[:3]],
        "source": "automatic",
    }


def classify_resource(text: str) -> str:
    """Backward-compatible category-only classification helper."""
    return classify_document("", [{"page": 1, "text": text}])["category"]
