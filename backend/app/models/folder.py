from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Folder(Base):
    """A user-owned folder in a hierarchical library."""

    __tablename__ = "folders"
    __table_args__ = (
        UniqueConstraint("owner_id", "parent_id", "name", name="uq_folder_location_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    folder_type: Mapped[str] = mapped_column(String(20), default="custom", nullable=False)
    system_key: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ResourceFolderAssignment(Base):
    """The current folder location of one resource."""

    __tablename__ = "resource_folder_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    folder_id: Mapped[int] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source: Mapped[str] = mapped_column(String(20), default="automatic", nullable=False)


class FolderResponse(BaseModel):
    id: int
    parent_id: int | None
    name: str
    folder_type: str
    created_at: datetime
    child_count: int = 0
    resource_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class FolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    parent_id: int | None = None


class FolderRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ResourceMoveRequest(BaseModel):
    folder_id: int


class FolderContentsResponse(BaseModel):
    folder: FolderResponse | None
    breadcrumbs: list[FolderResponse]
    folders: list[FolderResponse]
    resources: list[dict]
