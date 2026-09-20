import os
import tempfile

os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")
os.environ.setdefault("POSTGRES_DB", "test")
os.environ["JWT_SECRET_KEY"] = "test-secret-that-is-long-enough-for-tests"
os.environ["STORAGE_BACKEND"] = "local"
os.environ["UPLOAD_ROOT"] = tempfile.mkdtemp(prefix="ifms-test-uploads-")

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.auth import router
from app.api.upload import router as upload_router
from app.api.folders import router as folder_router
from app.database import Base, get_db
from app.models.user import User  # noqa: F401
from app.services.topic_service import extract_topics
from app.services.classification_service import available_categories, classify_document


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSession = sessionmaker(bind=engine)
Base.metadata.create_all(engine)

app = FastAPI()
app.include_router(router)
app.include_router(upload_router)
app.include_router(folder_router)


def override_get_db():
    with TestSession() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def setup_function():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def register(email="arthur@example.com", password="StrongPass1"):
    return client.post(
        "/auth/register",
        json={"name": "Arthur Chipeta", "email": email, "password": password},
    )


def token_for(email="arthur@example.com", password="StrongPass1"):
    return client.post(
        "/auth/login", json={"email": email, "password": password}
    ).json()["access_token"]


def test_registers_user_without_exposing_password_hash():
    response = register(email="ARTHUR@example.com")
    assert response.status_code == 201
    assert response.json() == {
        "id": 1,
        "name": "Arthur Chipeta",
        "email": "arthur@example.com",
    }


def test_rejects_duplicate_email():
    assert register().status_code == 201
    response = register()
    assert response.status_code == 409


def test_rejects_weak_password():
    response = register(password="weakpass")
    assert response.status_code == 422


def test_login_and_current_user_flow():
    register()
    login = client.post(
        "/auth/login",
        json={"email": "ARTHUR@example.com", "password": "StrongPass1"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    assert login.json()["token_type"] == "bearer"

    current_user = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert current_user.status_code == 200
    assert current_user.json()["email"] == "arthur@example.com"


def test_rejects_bad_credentials_and_invalid_tokens():
    register()
    bad_login = client.post(
        "/auth/login",
        json={"email": "arthur@example.com", "password": "WrongPass1"},
    )
    assert bad_login.status_code == 401
    assert client.get("/auth/me").status_code == 401
    assert (
        client.get(
            "/auth/me", headers={"Authorization": "Bearer not-a-real-token"}
        ).status_code
        == 401
    )


def test_upload_routes_require_authentication():
    anonymous = client.post(
        "/upload", files={"file": ("notes.txt", b"notes", "text/plain")}
    )
    assert anonymous.status_code == 401

    register()
    login = client.post(
        "/auth/login",
        json={"email": "arthur@example.com", "password": "StrongPass1"},
    )
    authenticated = client.post(
        "/upload",
        headers={"Authorization": f"Bearer {login.json()['access_token']}"},
        files={"file": ("notes.txt", b"notes", "text/plain")},
    )
    assert authenticated.status_code == 415


def test_resource_is_persisted_listed_served_and_deleted():
    register()
    headers = {"Authorization": f"Bearer {token_for()}"}
    uploaded = client.post(
        "/resources",
        headers=headers,
        files={"file": ("diagram.png", b"fake-png-content", "image/png")},
    )
    assert uploaded.status_code == 201
    resource_id = uploaded.json()["id"]
    assert uploaded.json()["name"] == "diagram.png"

    listing = client.get("/resources", headers=headers)
    assert listing.status_code == 200
    assert [resource["id"] for resource in listing.json()] == [resource_id]

    stored_file = client.get(f"/resources/{resource_id}/file", headers=headers)
    assert stored_file.status_code == 200
    assert stored_file.content == b"fake-png-content"

    deleted = client.delete(f"/resources/{resource_id}", headers=headers)
    assert deleted.status_code == 204
    assert client.get(f"/resources/{resource_id}", headers=headers).status_code == 404


def test_users_cannot_access_each_others_resources():
    register()
    owner_headers = {"Authorization": f"Bearer {token_for()}"}
    uploaded = client.post(
        "/resources",
        headers=owner_headers,
        files={"file": ("private.png", b"private", "image/png")},
    )
    resource_id = uploaded.json()["id"]

    register(email="other@example.com")
    other_headers = {"Authorization": f"Bearer {token_for('other@example.com')}"}
    assert client.get(f"/resources/{resource_id}", headers=other_headers).status_code == 404
    assert client.get(f"/resources/{resource_id}/file", headers=other_headers).status_code == 404
    assert client.delete(f"/resources/{resource_id}", headers=other_headers).status_code == 404


def test_topic_extraction_returns_confidence_and_page_references():
    topics = extract_topics(
        [
            {"page": 1, "text": "Computer Networks\nIntroduction to the OSI Model"},
            {"page": 2, "text": "TCP/IP and routing protocols"},
            {"page": 3, "text": "Subnetting\nCIDR and subnet masks"},
        ]
    )
    by_name = {topic["name"]: topic for topic in topics}
    assert by_name["OSI Model"]["pages"] == [1]
    assert by_name["TCP/IP"]["pages"] == [2]
    assert by_name["Routing"]["pages"] == [2]
    assert by_name["Subnetting"]["pages"] == [3]
    assert all(0 < topic["confidence"] <= 1 for topic in topics)


def test_owner_can_add_and_remove_a_manual_topic():
    register()
    headers = {"Authorization": f"Bearer {token_for()}"}
    uploaded = client.post(
        "/resources",
        headers=headers,
        files={"file": ("diagram.png", b"image-content", "image/png")},
    )
    resource_id = uploaded.json()["id"]

    created = client.post(
        f"/resources/{resource_id}/topics",
        headers=headers,
        json={"name": "Network Security", "pages": [4, 4, 2, -1]},
    )
    assert created.status_code == 201
    assert created.json()["source"] == "manual"
    assert created.json()["confidence"] == 1.0
    assert created.json()["pages"] == [2, 4]

    resource = client.get(f"/resources/{resource_id}", headers=headers).json()
    assert [topic["name"] for topic in resource["topics"]] == ["Network Security"]

    removed = client.delete(
        f"/resources/{resource_id}/topics/{created.json()['id']}", headers=headers
    )
    assert removed.status_code == 204
    assert client.get(f"/resources/{resource_id}", headers=headers).json()["topics"] == []


def test_other_user_cannot_modify_resource_topics():
    register()
    owner_headers = {"Authorization": f"Bearer {token_for()}"}
    resource_id = client.post(
        "/resources",
        headers=owner_headers,
        files={"file": ("private.png", b"image", "image/png")},
    ).json()["id"]
    register(email="other@example.com")
    other_headers = {"Authorization": f"Bearer {token_for('other@example.com')}"}
    response = client.post(
        f"/resources/{resource_id}/topics",
        headers=other_headers,
        json={"name": "Unauthorized Label", "pages": []},
    )
    assert response.status_code == 404


def test_hybrid_classifier_separates_data_mining_from_operating_systems():
    data_mining = classify_document(
        "CSC4792 Data Mining Lecture.pptx",
        [{
            "page": 1,
            "text": "Data Mining Process\nKnowledge discovery, clustering, association rules and data preprocessing",
        }],
    )
    operating_systems = classify_document(
        "Operating Systems Lecture.pdf",
        [{
            "page": 1,
            "text": "Operating Systems\nKernel, CPU scheduling, virtual memory, paging and deadlock",
        }],
    )
    assert data_mining["category"] == "Data Mining"
    assert data_mining["confidence"] >= 0.68
    assert data_mining["review_required"] is False
    assert operating_systems["category"] == "Operating Systems"
    assert len(available_categories()) >= 25


def test_owner_can_correct_category_and_manual_choice_is_persisted():
    register()
    headers = {"Authorization": f"Bearer {token_for()}"}
    resource_id = client.post(
        "/resources",
        headers=headers,
        files={"file": ("lecture.png", b"image", "image/png")},
    ).json()["id"]

    corrected = client.patch(
        f"/resources/{resource_id}/category",
        headers=headers,
        json={"category": "Data Mining"},
    )
    assert corrected.status_code == 200
    assert corrected.json()["category"] == "Data Mining"
    assert corrected.json()["category_confidence"] == 1.0
    assert corrected.json()["category_source"] == "manual"
    assert corrected.json()["category_review_required"] is False

    fetched = client.get(f"/resources/{resource_id}", headers=headers).json()
    assert fetched["category"] == "Data Mining"
    assert fetched["category_source"] == "manual"


def test_unknown_category_and_other_user_corrections_are_rejected():
    register()
    owner_headers = {"Authorization": f"Bearer {token_for()}"}
    resource_id = client.post(
        "/resources",
        headers=owner_headers,
        files={"file": ("private.png", b"image", "image/png")},
    ).json()["id"]
    invalid = client.patch(
        f"/resources/{resource_id}/category",
        headers=owner_headers,
        json={"category": "Made Up Course"},
    )
    assert invalid.status_code == 422

    register(email="other@example.com")
    other_headers = {"Authorization": f"Bearer {token_for('other@example.com')}"}
    forbidden = client.patch(
        f"/resources/{resource_id}/category",
        headers=other_headers,
        json={"category": "Data Mining"},
    )
    assert forbidden.status_code == 404


def test_uploads_are_organized_into_course_and_material_folders():
    register()
    headers = {"Authorization": f"Bearer {token_for()}"}
    uploaded = client.post(
        "/resources",
        headers=headers,
        files={"file": ("Data Mining Lecture Slides.png", b"image", "image/png")},
    ).json()
    client.post(
        f"/resources/{uploaded['id']}/topics",
        headers=headers,
        json={"name": "Clustering", "pages": []},
    )

    root = client.get("/folders/contents", headers=headers).json()
    assert [folder["name"] for folder in root["folders"]] == ["Data Mining"]
    course_id = root["folders"][0]["id"]

    course = client.get(
        "/folders/contents", params={"parent_id": course_id}, headers=headers
    ).json()
    assert [folder["name"] for folder in course["folders"]] == ["Lecture Slides"]
    slides_id = course["folders"][0]["id"]

    slides = client.get(
        "/folders/contents", params={"parent_id": slides_id}, headers=headers
    ).json()
    assert slides["resources"][0]["name"] == "Data Mining Lecture Slides.png"
    assert slides["resources"][0]["topics"][0]["name"] == "Clustering"


def test_folders_can_be_renamed_and_manual_resource_moves_are_preserved():
    register()
    headers = {"Authorization": f"Bearer {token_for()}"}
    uploaded = client.post(
        "/resources",
        headers=headers,
        files={"file": ("Data Mining Lecture.png", b"image", "image/png")},
    ).json()
    course = client.get("/folders/contents", headers=headers).json()["folders"][0]
    renamed = client.patch(
        f"/folders/{course['id']}", headers=headers, json={"name": "CSC 4792"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "CSC 4792"

    custom = client.post(
        "/folders", headers=headers, json={"name": "Exam Revision", "parent_id": course["id"]}
    ).json()
    moved = client.patch(
        f"/folders/resources/{uploaded['id']}/move",
        headers=headers,
        json={"folder_id": custom["id"]},
    )
    assert moved.status_code == 200
    contents = client.get(
        "/folders/contents", params={"parent_id": custom["id"]}, headers=headers
    ).json()
    assert [resource["id"] for resource in contents["resources"]] == [uploaded["id"]]


def test_users_cannot_browse_or_move_files_into_another_users_folders():
    register()
    owner_headers = {"Authorization": f"Bearer {token_for()}"}
    resource_id = client.post(
        "/resources",
        headers=owner_headers,
        files={"file": ("private lecture.png", b"image", "image/png")},
    ).json()["id"]
    folder_id = client.get("/folders/contents", headers=owner_headers).json()["folders"][0]["id"]

    register(email="other@example.com")
    other_headers = {"Authorization": f"Bearer {token_for('other@example.com')}"}
    assert client.get(
        "/folders/contents", params={"parent_id": folder_id}, headers=other_headers
    ).status_code == 404
    assert client.patch(
        f"/folders/resources/{resource_id}/move",
        headers=other_headers,
        json={"folder_id": folder_id},
    ).status_code == 404
