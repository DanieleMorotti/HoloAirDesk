import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIBRARY_DIR = ROOT / "library"
STATIC_DIR = ROOT / "static"
MODELS_DIR = ROOT / "models"

APP_HOST = os.environ.get("HOLO_HOST", "0.0.0.0")
APP_PORT = int(os.environ.get("HOLO_PORT", "8000"))

# Sidecar inference servers (spawned by run.sh)
LLAMA_URL = os.environ.get("HOLO_LLAMA_URL", "http://127.0.0.1:8080")
WHISPER_URL = os.environ.get("HOLO_WHISPER_URL", "http://127.0.0.1:8091")

TEXT_EXT = {".txt", ".md", ".json", ".csv", ".log", ".py", ".js", ".html", ".css", ".yaml", ".yml"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".opus"}

# Agent behaviour
MAX_TOOL_ROUNDS = 6
MAX_HISTORY_MESSAGES = 24
LLM_TEMPERATURE = float(os.environ.get("HOLO_LLM_TEMP", "0.3"))
READ_FILE_CHAR_LIMIT = 12000


def file_kind(name: str) -> str:
    ext = Path(name).suffix.lower()
    if ext in TEXT_EXT:
        return "text"
    if ext in IMAGE_EXT:
        return "image"
    if ext in AUDIO_EXT:
        return "audio"
    return "other"
