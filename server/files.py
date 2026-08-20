"""File library: safe access helpers + REST endpoints used by the UI."""
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from .config import LIBRARY_DIR, READ_FILE_CHAR_LIMIT, file_kind

router = APIRouter(prefix="/api/files")


def safe_path(name: str) -> Path:
    """Resolve a library file name, rejecting any path traversal."""
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise ValueError(f"invalid file name: {name!r}")
    path = (LIBRARY_DIR / name).resolve()
    if path.parent != LIBRARY_DIR.resolve():
        raise ValueError(f"invalid file name: {name!r}")
    return path


def list_files() -> list[dict]:
    out = []
    for p in sorted(LIBRARY_DIR.iterdir()):
        if p.name.startswith(".") or not p.is_file():
            continue
        out.append({
            "name": p.name,
            "kind": file_kind(p.name),
            "size": p.stat().st_size,
            "mtime": p.stat().st_mtime,
        })
    return out


def read_text_file(name: str) -> str:
    path = safe_path(name)
    if not path.exists():
        raise FileNotFoundError(name)
    if file_kind(name) != "text":
        raise ValueError(f"{name} is not a text file ({file_kind(name)})")
    text = path.read_text(encoding="utf-8", errors="replace")
    if len(text) > READ_FILE_CHAR_LIMIT:
        text = text[:READ_FILE_CHAR_LIMIT] + "\n…[truncated]"
    return text


def write_text_file(name: str, content: str) -> None:
    path = safe_path(name)
    if file_kind(name) != "text":
        raise ValueError(f"only text files can be written ({name})")
    path.write_text(content, encoding="utf-8")


def delete_file(name: str) -> None:
    path = safe_path(name)
    if not path.exists():
        raise FileNotFoundError(name)
    path.unlink()


@router.get("")
def api_list_files():
    return {"files": list_files()}


@router.get("/{name}")
def api_get_file(name: str):
    try:
        path = safe_path(name)
    except ValueError:
        raise HTTPException(400, "invalid file name")
    if not path.exists():
        raise HTTPException(404, f"{name} not found")
    return FileResponse(path)
