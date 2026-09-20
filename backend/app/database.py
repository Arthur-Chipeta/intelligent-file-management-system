"""PostgreSQL database configuration for the application."""

import os
from pathlib import Path
from urllib.parse import quote_plus

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    database_user = quote_plus(os.environ["POSTGRES_USER"])
    database_password = quote_plus(os.environ["POSTGRES_PASSWORD"])
    database_host = os.environ.get("POSTGRES_HOST", "localhost")
    database_port = os.environ.get("POSTGRES_PORT", "5432")
    database_name = os.environ["POSTGRES_DB"]
    DATABASE_URL = (
        f"postgresql+psycopg2://{database_user}:{database_password}"
        f"@{database_host}:{database_port}/{database_name}"
    )

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=2,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    """Base class inherited by every SQLAlchemy table model."""


def get_db():
    """Provide a database session to an API request and close it afterwards."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
