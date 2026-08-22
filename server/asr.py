"""Speech-to-text: browser audio blob -> ffmpeg 16k mono wav -> whisper-server."""
import asyncio
import tempfile
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, Form, File

from .config import WHISPER_URL

# "auto" detects EN/IT per utterance (~+0.8s); pin "en" or "it" for lowest latency
import os
DEFAULT_LANG = os.environ.get("HOLO_ASR_LANG", "auto")
FFMPEG_BIN = os.environ.get("HOLO_FFMPEG", "ffmpeg")
# A CPU-only Whisper model can need more than a minute, especially when
# language auto-detection performs an extra encoder pass.
ASR_TIMEOUT_SECONDS = float(os.environ.get("HOLO_ASR_TIMEOUT", "180"))

router = APIRouter()


async def _to_wav16k(src: Path, dst: Path) -> None:
    try:
        proc = await asyncio.create_subprocess_exec(
            FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src), "-ar", "16000", "-ac", "1", "-f", "wav", str(dst),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"ffmpeg was not found ({FFMPEG_BIN!r}). Install FFmpeg and add it to PATH, "
            "or set HOLO_FFMPEG to the full path of ffmpeg.exe."
        ) from exc
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {err.decode(errors='replace')[:300]}")


@router.post("/api/transcribe")
async def api_transcribe(audio: UploadFile = File(...), language: str = Form("")):
    language = language or DEFAULT_LANG
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

        async with httpx.AsyncClient(timeout=httpx.Timeout(ASR_TIMEOUT_SECONDS, connect=5.0)) as client:
            try:
                resp = await client.post(
                    f"{WHISPER_URL}/inference",
                    files={"file": ("audio.wav", wav.read_bytes(), "audio/wav")},
                    data={
                        "response_format": "json",
                        "temperature": "0.0",
                        "language": language,
                        # greedy decoding: turbo models are tuned for it, ~2x faster
                        "beam_size": "1",
                    },
                )
            except httpx.TimeoutException as e:
                raise HTTPException(
                    504,
                    f"whisper-server timed out after {ASR_TIMEOUT_SECONDS:.0f}s. "
                    "Set HOLO_ASR_LANG to en or it, use a smaller Whisper model, "
                    "or increase HOLO_ASR_TIMEOUT."
                ) from e
            except httpx.HTTPError as e:
                raise HTTPException(502, f"whisper-server unreachable: {e}") from e

    if resp.status_code != 200:
        raise HTTPException(502, f"whisper-server error: {resp.text[:300]}")
    # whisper may wrap segments with newlines: collapse to single spaces
    text = " ".join((resp.json().get("text") or "").split())
    return {"text": text}
