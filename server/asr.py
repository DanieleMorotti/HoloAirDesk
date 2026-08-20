"""Speech-to-text: browser audio blob -> ffmpeg 16k mono wav -> whisper-server."""
import asyncio
import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, Form, File

from .config import WHISPER_URL

router = APIRouter()


async def _to_wav16k(src: Path, dst: Path) -> None:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src), "-ar", "16000", "-ac", "1", "-f", "wav", str(dst),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode(errors='replace')[:300]}")


@router.post("/api/transcribe")
async def api_transcribe(audio: UploadFile = File(...), language: str = Form("auto")):
    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "empty audio")

    with tempfile.TemporaryDirectory(prefix="holo_asr_") as tmp:
        src = Path(tmp) / ("input" + (Path(audio.filename or "a.webm").suffix or ".webm"))
        wav = Path(tmp) / "audio.wav"
        src.write_bytes(raw)
        try:
            await _to_wav16k(src, wav)
        except RuntimeError as e:
            raise HTTPException(500, str(e))

        async with httpx.AsyncClient(timeout=60) as client:
            try:
                resp = await client.post(
                    f"{WHISPER_URL}/inference",
                    files={"file": ("audio.wav", wav.read_bytes(), "audio/wav")},
                    data={
                        "response_format": "json",
                        "temperature": "0.0",
                        "language": language or "auto",
                        # short utterances: single segment beam keeps latency low
                        "beam_size": "2",
                    },
                )
            except httpx.HTTPError as e:
                raise HTTPException(502, f"whisper-server unreachable: {e}")

    if resp.status_code != 200:
        raise HTTPException(502, f"whisper-server error: {resp.text[:300]}")
    text = (resp.json().get("text") or "").strip()
    return {"text": text}
