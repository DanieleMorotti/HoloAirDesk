import httpx
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import agent, asr, files
from .config import LIBRARY_DIR, LLAMA_URL, STATIC_DIR, VISION_ONLY, WHISPER_URL

app = FastAPI(title="HoloAirDesk")

LIBRARY_DIR.mkdir(exist_ok=True)

app.include_router(files.router)
app.include_router(asr.router)
app.include_router(agent.router)


@app.get("/api/health")
async def health():
    """Boot screen polls this to show which subsystems are online."""
    status = {"app": True, "llm": False, "asr": False, "vision_only": VISION_ONLY}
    if VISION_ONLY:
        return status
    async with httpx.AsyncClient(timeout=2) as client:
        for key, url in (("llm", f"{LLAMA_URL}/health"), ("asr", f"{WHISPER_URL}/")):
            try:
                r = await client.get(url)
                status[key] = r.status_code < 500
            except httpx.HTTPError:
                pass
    return status


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=STATIC_DIR), name="static")
