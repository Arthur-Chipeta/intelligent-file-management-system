import io
import mimetypes
import os
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.database import get_db
from app.models.resource import (
    CategoryCorrectionRequest,
    ManualTopicRequest,
    Resource,
    ResourceCategoryPrediction,
    ResourceResponse,
    ResourceTopic,
    TopicResponse,
)
from app.models.url_resource import URLRequest
from app.models.user import User
from app.services.classification_service import available_categories, classify_document, detect_resource_type
from app.services.docx_service import extract_pages as extract_docx_pages
from app.services.pdf_service import extract_pages as extract_pdf_pages
from app.services.pptx_service import extract_pages as extract_pptx_pages
from app.services.storage_service import delete_object, download_object, upload_object
from app.services.topic_service import extract_topics
from app.services.webpage_service import extract_webpage_content
from app.services.folder_service import organize_resource


router = APIRouter(tags=["Resources"])
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))


def serialize_resource(resource: Resource) -> ResourceResponse:
    result = ResourceResponse.model_validate(resource)
    result.text_preview = resource.extracted_text[:300]
    if resource.category_prediction:
        prediction = resource.category_prediction
        result.category_confidence = prediction.confidence
        result.category_review_required = prediction.review_required
        result.category_source = prediction.source
        result.category_rankings = prediction.rankings
    if resource.folder_assignment:
        result.folder_id = resource.folder_assignment.folder_id
    return result


def owned_resource(resource_id: int, user: User, db: Session) -> Resource:
    resource = db.scalar(
        select(Resource).where(Resource.id == resource_id, Resource.owner_id == user.id)
    )
    if resource is None:
        raise HTTPException(status_code=404, detail="Resource not found.")
    return resource


def attach_automatic_topics(resource: Resource, pages: list[dict]) -> None:
    for topic in extract_topics(pages):
        resource.topics.append(ResourceTopic(source="automatic", **topic))


def apply_category_prediction(resource: Resource, result: dict) -> None:
    resource.category = result["category"]
    prediction = resource.category_prediction
    if prediction is None:
        prediction = ResourceCategoryPrediction()
        resource.category_prediction = prediction
    prediction.predicted_category = result["category"]
    prediction.confidence = result["confidence"]
    prediction.review_required = result["review_required"]
    prediction.rankings = result["rankings"]
    prediction.source = result["source"]


def resource_pages(resource: Resource) -> list[dict]:
    pages = []
    if resource.stored_filename:
        try:
            file_data = io.BytesIO(download_object(resource.stored_filename))
            if resource.resource_type == "PDF":
                pages = extract_pdf_pages(file_data)
            elif resource.resource_type == "DOCX":
                pages = extract_docx_pages(file_data)
            elif resource.resource_type == "PPTX":
                pages = extract_pptx_pages(file_data)
        except Exception:
            # Previously extracted text still permits classification if the
            # object store is temporarily unavailable during application boot.
            pages = []
    if not pages and resource.extracted_text:
        pages = [{"page": 1, "text": resource.extracted_text}]
    return pages


def backfill_missing_topics(db: Session) -> int:
    """Generate labels for resources uploaded before topic extraction existed."""
    resources = db.scalars(select(Resource).where(~Resource.topics.any())).all()
    updated = 0
    for resource in resources:
        pages = resource_pages(resource)
        attach_automatic_topics(resource, pages)
        if resource.topics:
            updated += 1
    db.commit()
    return updated


def reclassify_automatic_resources(db: Session) -> int:
    """Classify new/automatic records using the current taxonomy and scoring model."""
    resources = db.scalars(select(Resource)).all()
    updated = 0
    for resource in resources:
        if resource.category_prediction and resource.category_prediction.source == "manual":
            continue
        apply_category_prediction(
            resource, classify_document(resource.name, resource_pages(resource))
        )
        updated += 1
    db.commit()
    return updated


@router.get("/categories", response_model=list[str])
def list_categories(current_user: User = Depends(get_current_user)):
    return available_categories()


@router.get("/resources", response_model=list[ResourceResponse])
def list_resources(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resources = db.scalars(
        select(Resource)
        .where(Resource.owner_id == current_user.id)
        .order_by(Resource.created_at.desc(), Resource.id.desc())
    ).all()
    return [serialize_resource(resource) for resource in resources]


@router.get("/resources/{resource_id}", response_model=ResourceResponse)
def get_resource(
    resource_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return serialize_resource(owned_resource(resource_id, current_user, db))


@router.patch("/resources/{resource_id}/category", response_model=ResourceResponse)
def correct_resource_category(
    resource_id: int,
    payload: CategoryCorrectionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resource = owned_resource(resource_id, current_user, db)
    if payload.category not in available_categories():
        raise HTTPException(status_code=422, detail="Unknown Computer Science category.")
    previous_prediction = resource.category_prediction
    rankings = previous_prediction.rankings if previous_prediction else []
    apply_category_prediction(
        resource,
        {
            "category": payload.category,
            "confidence": 1.0,
            "review_required": False,
            "rankings": rankings,
            "source": "manual",
        },
    )
    organize_resource(db, resource)
    db.commit()
    db.refresh(resource)
    return serialize_resource(resource)


@router.post("/resources/{resource_id}/reclassify", response_model=ResourceResponse)
def reclassify_resource(
    resource_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resource = owned_resource(resource_id, current_user, db)
    apply_category_prediction(resource, classify_document(resource.name, resource_pages(resource)))
    organize_resource(db, resource)
    db.commit()
    db.refresh(resource)
    return serialize_resource(resource)


@router.get("/resources/{resource_id}/file")
def get_resource_file(
    resource_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resource = owned_resource(resource_id, current_user, db)
    if not resource.stored_filename:
        raise HTTPException(status_code=404, detail="This resource has no stored file.")
    try:
        content = download_object(resource.stored_filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Stored file not found.")
    media_type = mimetypes.guess_type(resource.name)[0] or "application/octet-stream"
    encoded_name = quote(resource.name)
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{encoded_name}"},
    )


@router.post("/resources/{resource_id}/topics", response_model=TopicResponse, status_code=201)
def add_resource_topic(
    resource_id: int,
    payload: ManualTopicRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resource = owned_resource(resource_id, current_user, db)
    name = " ".join(payload.name.split())
    topic = ResourceTopic(
        resource=resource,
        name=name,
        confidence=1.0,
        pages=sorted(set(page for page in payload.pages if page > 0)),
        source="manual",
    )
    db.add(topic)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="This label already exists.")
    db.refresh(topic)
    return topic


@router.delete("/resources/{resource_id}/topics/{topic_id}", status_code=204)
def delete_resource_topic(
    resource_id: int,
    topic_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owned_resource(resource_id, current_user, db)
    topic = db.scalar(
        select(ResourceTopic).where(
            ResourceTopic.id == topic_id,
            ResourceTopic.resource_id == resource_id,
        )
    )
    if topic is None:
        raise HTTPException(status_code=404, detail="Label not found.")
    db.delete(topic)
    db.commit()


@router.delete("/resources/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(
    resource_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resource = owned_resource(resource_id, current_user, db)
    stored_filename = resource.stored_filename
    db.delete(resource)
    db.commit()
    if stored_filename:
        delete_object(stored_filename)


@router.post("/resources", response_model=ResourceResponse, status_code=201)
@router.post("/upload", response_model=ResourceResponse, status_code=201, include_in_schema=False)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    original_name = Path(file.filename or "").name
    resource_type = detect_resource_type(original_name)
    if resource_type == "UNKNOWN":
        raise HTTPException(status_code=415, detail="Unsupported file type.")

    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the upload limit.")
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if resource_type == "PDF" and not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="The file is not a valid PDF.")

    stored_filename = (
        f"users/{current_user.id}/{uuid4().hex}{Path(original_name).suffix.lower()}"
    )
    uploaded_to_storage = False
    try:
        pages = []
        file_data = io.BytesIO(content)
        if resource_type == "PDF":
            pages = extract_pdf_pages(file_data)
        elif resource_type == "DOCX":
            pages = extract_docx_pages(file_data)
        elif resource_type == "PPTX":
            pages = extract_pptx_pages(file_data)
        upload_object(
            stored_filename,
            content,
            file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream",
        )
        uploaded_to_storage = True
        extracted_text = "\n".join(page["text"] for page in pages)
        classification = classify_document(original_name, pages)
        resource = Resource(
            owner_id=current_user.id,
            name=original_name,
            resource_type=resource_type,
            category=classification["category"],
            stored_filename=stored_filename,
            extracted_text=extracted_text,
            size_bytes=len(content),
        )
        db.add(resource)
        db.flush()
        apply_category_prediction(resource, classification)
        attach_automatic_topics(resource, pages)
        organize_resource(db, resource)
        db.commit()
        db.refresh(resource)
        return serialize_resource(resource)
    except Exception:
        db.rollback()
        if uploaded_to_storage:
            delete_object(stored_filename)
        raise


@router.post("/resources/webpage", response_model=ResourceResponse, status_code=201)
@router.post("/upload-url", response_model=ResourceResponse, status_code=201, include_in_schema=False)
async def upload_url(
    request: URLRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    webpage_data = extract_webpage_content(str(request.url))
    extracted_text = webpage_data["title"] + " " + webpage_data["text"]
    classification = classify_document(
        webpage_data["title"], [{"page": 1, "text": extracted_text}]
    )
    resource = Resource(
        owner_id=current_user.id,
        name=webpage_data["title"],
        resource_type="WEBPAGE_LINK",
        category=classification["category"],
        external_url=webpage_data["url"],
        extracted_text=extracted_text,
    )
    db.add(resource)
    db.flush()
    apply_category_prediction(resource, classification)
    attach_automatic_topics(resource, [{"page": 1, "text": extracted_text}])
    organize_resource(db, resource)
    db.commit()
    db.refresh(resource)
    return serialize_resource(resource)
