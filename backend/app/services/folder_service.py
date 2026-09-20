from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.folder import Folder, ResourceFolderAssignment
from app.models.resource import Resource


def material_folder_name(resource: Resource) -> str:
    name = resource.name.lower()
    if resource.resource_type == "PPTX" or "lecture" in name or "slide" in name:
        return "Lecture Slides"
    if resource.resource_type == "WEBPAGE_LINK":
        return "Web Resources"
    if resource.resource_type == "IMAGE":
        return "Images"
    if resource.resource_type == "VIDEO":
        return "Videos"
    return "Course Materials"


def get_or_create_folder(
    db: Session,
    owner_id: int,
    name: str,
    parent_id: int | None,
    folder_type: str,
    system_key: str,
) -> Folder:
    folder = db.scalar(
        select(Folder).where(
            Folder.owner_id == owner_id,
            Folder.parent_id == parent_id,
            Folder.folder_type == folder_type,
            Folder.system_key == system_key,
        )
    )
    if folder is None:
        folder = Folder(
            owner_id=owner_id,
            parent_id=parent_id,
            name=name,
            folder_type=folder_type,
            system_key=system_key,
        )
        db.add(folder)
        db.flush()
    return folder


def organize_resource(db: Session, resource: Resource, force: bool = False) -> Folder:
    assignment = db.scalar(
        select(ResourceFolderAssignment).where(
            ResourceFolderAssignment.resource_id == resource.id
        )
    )
    if assignment and assignment.source == "manual" and not force:
        return db.get(Folder, assignment.folder_id)

    course_folder = get_or_create_folder(
        db, resource.owner_id, resource.category, None, "course", resource.category
    )
    material_folder = get_or_create_folder(
        db,
        resource.owner_id,
        material_folder_name(resource),
        course_folder.id,
        "material",
        material_folder_name(resource),
    )
    if assignment is None:
        assignment = ResourceFolderAssignment(
            resource_id=resource.id,
            folder_id=material_folder.id,
            source="automatic",
        )
        db.add(assignment)
    else:
        assignment.folder_id = material_folder.id
        assignment.source = "automatic"
    return material_folder


def backfill_resource_folders(db: Session) -> int:
    resources = db.scalars(select(Resource)).all()
    updated = 0
    for resource in resources:
        assignment = db.scalar(
            select(ResourceFolderAssignment).where(
                ResourceFolderAssignment.resource_id == resource.id
            )
        )
        if assignment is None:
            organize_resource(db, resource)
            updated += 1
    db.commit()
    return updated
