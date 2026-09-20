from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.folders import router as folder_router
from app.api.upload import backfill_missing_topics, reclassify_automatic_resources, router as upload_router
from app.database import Base, SessionLocal, engine
from app.models.user import User  # noqa: F401 - registers the users table with Base
from app.models.resource import Resource  # noqa: F401 - registers resources table
from app.services.folder_service import backfill_resource_folders


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        backfill_missing_topics(db)
        reclassify_automatic_resources(db)
        backfill_resource_folders(db)
    yield

app = FastAPI(
    title="Intelligent File Management System API",
    lifespan=lifespan,
)

app.include_router(auth_router)
app.include_router(upload_router)
app.include_router(folder_router)


@app.get("/health")
def health():
    return {"status": "ok"}


FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
