from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Resource(Base):
    """A persisted file or webpage owned by one account."""

    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(30), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    stored_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    external_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    extracted_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    topics: Mapped[list["ResourceTopic"]] = relationship(
        back_populates="resource",
        cascade="all, delete-orphan",
        order_by="ResourceTopic.confidence.desc()",
    )
    category_prediction: Mapped["ResourceCategoryPrediction | None"] = relationship(
        back_populates="resource", cascade="all, delete-orphan", uselist=False
    )
    folder_assignment: Mapped["ResourceFolderAssignment | None"] = relationship(
        cascade="all, delete-orphan", uselist=False
    )


class ResourceCategoryPrediction(Base):
    """Classification evidence and user-correction state for one resource."""

    __tablename__ = "resource_category_predictions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), unique=True, index=True, nullable=False
    )
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    review_required: Mapped[bool] = mapped_column(default=False, nullable=False)
    rankings: Mapped[list[dict]] = mapped_column(JSON, default=list, nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="automatic", nullable=False)
    predicted_category: Mapped[str] = mapped_column(String(100), nullable=False)
    resource: Mapped[Resource] = relationship(back_populates="category_prediction")


class ResourceTopic(Base):
    """An automatic or user-added label attached to a resource."""

    __tablename__ = "resource_topics"
    __table_args__ = (UniqueConstraint("resource_id", "name", name="uq_resource_topic_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    resource_id: Mapped[int] = mapped_column(
        ForeignKey("resources.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    pages: Mapped[list[int]] = mapped_column(JSON, default=list, nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="automatic", nullable=False)
    resource: Mapped[Resource] = relationship(back_populates="topics")


class TopicResponse(BaseModel):
    id: int
    name: str
    confidence: float
    pages: list[int]
    source: str

    model_config = ConfigDict(from_attributes=True)


class ManualTopicRequest(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    pages: list[int] = Field(default_factory=list)


class CategoryCorrectionRequest(BaseModel):
    category: str = Field(min_length=2, max_length=100)


class ResourceResponse(BaseModel):
    id: int
    name: str
    resource_type: str
    category: str
    external_url: str | None
    size_bytes: int | None
    created_at: datetime
    text_preview: str = ""
    topics: list[TopicResponse] = Field(default_factory=list)
    category_confidence: float = 0.0
    category_review_required: bool = True
    category_source: str = "unknown"
    category_rankings: list[dict] = Field(default_factory=list)
    folder_id: int | None = None

    model_config = ConfigDict(from_attributes=True)
