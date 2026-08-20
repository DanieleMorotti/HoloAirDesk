# HoloSpace AI

A Jarvis-style holographic desktop in the browser. Your hands, tracked through
the webcam, become glowing pointers: pinch to click, hold the pinch to drag
windows around, pinch with both hands to resize them, clap to clear the space.
A local voice assistant (HOLO) opens, reads, writes and deletes the files in
your library — everything runs on-device.

## Stack

| Piece | Tech |
|---|---|
| Hand tracking | MediaPipe HandLandmarker (vendored, GPU delegate) + One-Euro smoothing |
| UI | Vanilla ES modules, no build step |
| Backend | FastAPI + uvicorn |
| LLM agent | OpenAI Agents SDK over `llama-server` (llama.cpp) — LFM2.5-2.6B default, Qwen3.5-4B optional |
| Speech-to-text | `whisper-server` (whisper.cpp, Metal) — `large-v3-turbo` q5, EN + IT |

## Requirements

- macOS with Apple Silicon (Metal), webcam
- `llama.cpp` and `whisper-cpp` (both via Homebrew)
- `ffmpeg`
- Python 3.10+ (the agent SDK needs it):
  `python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt`
- Model weights in `models/` (not tracked by git):
  - `LFM2.5-2.6B-Q8_0.gguf` (default agent) / `Qwen3.5-4B-Q8_0.gguf`
  - `ggml-large-v3-turbo-q5_0.bin` (whisper)

## Run

```bash
./run.sh                 # http://localhost:8000
HOLO_MODEL=qwen ./run.sh # use Qwen3.5-4B as the agent
HOLO_ASR_LANG=it ./run.sh# pin the speech language (default: auto EN/IT, ~+0.8s)
./run.sh --lan           # HTTPS on 0.0.0.0:8443 for other devices on the LAN
```

`run.sh` starts llama-server (:8080), whisper-server (:8091) and the web app,
and shuts everything down together on Ctrl-C.

> The webcam only works in a *secure context*: `http://localhost` is fine, but
> to open the app from another machine you must use `--lan` (self-signed
> HTTPS — accept the browser warning once).

## Gestures

| Gesture | Action |
|---|---|
| Point (index + thumb) | Move the cursor — both hands work |
| Quick pinch | Click (buttons, dock, file cards, window ✕) |
| Hold pinch on a title bar | Grab and drag the window (images/audio: anywhere) |
| Pinch inside a text file | Scroll it — the content follows your hand |
| Both hands pinch a window | Resize by pulling apart / together |
| Clap | Close every open window |

## Voice assistant

Click the mic (bottom right), speak (English or Italian), click again to stop.
The transcription is sent to HOLO, which can call tools:
`open_file`, `read_file`, `write_file`, `delete_file`. If it modifies a file
that is open on screen, the window refreshes live. HOLO always knows which
files are currently open, and remembers the last 10 chat messages (tool
traffic and thinking tracks are not kept in the context).

## Library

Drop your own files into `library/`. Text files open in a scrollable panel,
images in a viewer, audio in a player with a live spectrum. Only text files
can be read/written by the agent.

## Layout

```
server/    FastAPI app: files API, /api/transcribe, /api/chat (SSE agent loop)
static/    frontend (js modules, css, vendored MediaPipe)
library/   the user files shown in the app
models/    gguf / whisper weights (gitignored)
run.sh     one-command launcher
NOTES.md   future ideas
```
