"""Private document storage for local development and Supabase deployments."""

import os
from functools import lru_cache
from pathlib import Path

from supabase import Client, create_client


PROJECT_ROOT = Path(__file__).resolve().parents[3]
LOCAL_UPLOAD_ROOT = Path(
    os.environ.get("UPLOAD_ROOT", PROJECT_ROOT / "uploads")
).resolve()
STORAGE_BACKEND = os.environ.get("STORAGE_BACKEND", "local").strip().lower()


def _safe_local_path(object_path: str) -> Path:
    candidate = (LOCAL_UPLOAD_ROOT / object_path).resolve()
    if candidate != LOCAL_UPLOAD_ROOT and LOCAL_UPLOAD_ROOT not in candidate.parents:
        raise ValueError("Invalid storage object path.")
    return candidate


@lru_cache(maxsize=1)
def _supabase_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when "
            "STORAGE_BACKEND=supabase."
        )
    return create_client(url, service_key)


def _supabase_bucket():
    bucket_name = os.environ.get("SUPABASE_STORAGE_BUCKET", "documents")
    return _supabase_client().storage.from_(bucket_name)


def upload_object(object_path: str, content: bytes, content_type: str) -> None:
    """Store a new private object without overwriting an existing one."""
    if STORAGE_BACKEND == "local":
        destination = _safe_local_path(object_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        return
    if STORAGE_BACKEND == "supabase":
        _supabase_bucket().upload(
            path=object_path,
            file=content,
            file_options={
                "content-type": content_type or "application/octet-stream",
                "upsert": "false",
            },
        )
        return
    raise RuntimeError(f"Unsupported STORAGE_BACKEND: {STORAGE_BACKEND}")


def download_object(object_path: str) -> bytes:
    """Return a private object's bytes."""
    if STORAGE_BACKEND == "local":
        source = _safe_local_path(object_path)
        if not source.is_file():
            raise FileNotFoundError(object_path)
        return source.read_bytes()
    if STORAGE_BACKEND == "supabase":
        return _supabase_bucket().download(object_path)
    raise RuntimeError(f"Unsupported STORAGE_BACKEND: {STORAGE_BACKEND}")


def delete_object(object_path: str) -> None:
    """Delete a private object if it exists."""
    if STORAGE_BACKEND == "local":
        _safe_local_path(object_path).unlink(missing_ok=True)
        return
    if STORAGE_BACKEND == "supabase":
        _supabase_bucket().remove([object_path])
        return
    raise RuntimeError(f"Unsupported STORAGE_BACKEND: {STORAGE_BACKEND}")
