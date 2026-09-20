from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import get_current_user
from app.api.upload import owned_resource, serialize_resource
from app.database import get_db
from app.models.folder import (
    Folder,
    FolderContentsResponse,
    FolderCreateRequest,
    FolderRenameRequest,
    FolderResponse,
    ResourceFolderAssignment,
    ResourceMoveRequest,
)
from app.models.resource import Resource
from app.models.user import User


router = APIRouter(prefix="/folders", tags=["Folders"])


def owned_folder(folder_id: int, user: User, db: Session) -> Folder:
    folder = db.scalar(
        select(Folder).where(Folder.id == folder_id, Folder.owner_id == user.id)
    )
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found.")
    return folder


def serialize_folder(folder: Folder, db: Session) -> FolderResponse:
    result = FolderResponse.model_validate(folder)
    result.child_count = db.scalar(
        select(func.count()).select_from(Folder).where(Folder.parent_id == folder.id)
    )
    result.resource_count = db.scalar(
        select(func.count())
        .select_from(ResourceFolderAssignment)
        .where(ResourceFolderAssignment.folder_id == folder.id)
    )
    return result


def folder_breadcrumbs(folder: Folder, user: User, db: Session) -> list[FolderResponse]:
    breadcrumbs = []
    current = folder
    while current is not None:
        breadcrumbs.append(serialize_folder(current, db))
        current = db.get(Folder, current.parent_id) if current.parent_id else None
        if current is not None and current.owner_id != user.id:
            raise HTTPException(status_code=404, detail="Folder not found.")
    return list(reversed(breadcrumbs))


@router.get("/contents", response_model=FolderContentsResponse)
def browse_folder(
    parent_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    parent = owned_folder(parent_id, current_user, db) if parent_id else None
    child_folders = db.scalars(
        select(Folder)
        .where(Folder.owner_id == current_user.id, Folder.parent_id == parent_id)
        .order_by(Folder.name)
    ).all()
    resources = []
    if parent_id:
        resources = db.scalars(
            select(Resource)
            .join(ResourceFolderAssignment, ResourceFolderAssignment.resource_id == Resource.id)
            .where(
                Resource.owner_id == current_user.id,
                ResourceFolderAssignment.folder_id == parent_id,
            )
            .order_by(Resource.created_at.desc())
        ).all()
    return FolderContentsResponse(
        folder=serialize_folder(parent, db) if parent else None,
        breadcrumbs=folder_breadcrumbs(parent, current_user, db) if parent else [],
        folders=[serialize_folder(folder, db) for folder in child_folders],
        resources=[serialize_resource(resource).model_dump() for resource in resources],
    )


@router.post("", response_model=FolderResponse, status_code=201)
def create_folder(
    payload: FolderCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.parent_id:
        owned_folder(payload.parent_id, current_user, db)
    name = " ".join(payload.name.split())
    duplicate = db.scalar(
        select(Folder).where(
            Folder.owner_id == current_user.id,
            Folder.parent_id == payload.parent_id,
            Folder.name == name,
        )
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A folder with this name already exists here.")
    folder = Folder(
        owner_id=current_user.id,
        parent_id=payload.parent_id,
        name=name,
        folder_type="custom",
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return serialize_folder(folder, db)


@router.patch("/{folder_id}", response_model=FolderResponse)
def rename_folder(
    folder_id: int,
    payload: FolderRenameRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    folder = owned_folder(folder_id, current_user, db)
    new_name = " ".join(payload.name.split())
    duplicate = db.scalar(
        select(Folder).where(
            Folder.owner_id == current_user.id,
            Folder.parent_id == folder.parent_id,
            Folder.name == new_name,
            Folder.id != folder.id,
        )
    )
    if duplicate:
        raise HTTPException(status_code=409, detail="A folder with this name already exists here.")
    folder.name = new_name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A folder with this name already exists here.")
    db.refresh(folder)
    return serialize_folder(folder, db)


@router.patch("/resources/{resource_id}/move", response_model=dict)
def move_resource(
    resource_id: int,
    payload: ResourceMoveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    resource = owned_resource(resource_id, current_user, db)
    folder = owned_folder(payload.folder_id, current_user, db)
    assignment = db.scalar(
        select(ResourceFolderAssignment).where(
            ResourceFolderAssignment.resource_id == resource.id
        )
    )
    if assignment is None:
        assignment = ResourceFolderAssignment(resource_id=resource.id)
        db.add(assignment)
    assignment.folder_id = folder.id
    assignment.source = "manual"
    db.commit()
    return {"resource_id": resource.id, "folder_id": folder.id}
