# HoloAirDesk AI

> **A just-for-fun experimental project** — a Jarvis-style holographic desktop that runs in your browser and entirely on your device. Implemented with our mutual friend **Claude Fable 5**.

Your hands, **tracked** through the webcam, become glowing pointers: **pinch** to click, hold the pinch to **drag** windows around, pinch with both hands to **resize** them, and **clap** to clear the space. A local **voice assistant** (HOLO) opens, reads, writes, and deletes files in your library.

<p align="center" width="100%">
<video src="./short_demo.mp4" width="80%" controls></video>
</p>

> **Platform status:** this release has been tested only on **macOS** (Apple Silicon), specifically a **MacBook Pro** with M3 Pro and **36 GB RAM**. A **Windows** version lives on a separate branch and is still being tested; it may be integrated later.

## Stack

| Piece | Tech |
|---|---|
| Hand tracking | MediaPipe HandLandmarker (vendored, GPU delegate) + One-Euro smoothing |
| Head pointer (optional) | MediaPipe FaceLandmarker — head steers the cursor, hands pinch |
| UI | Vanilla ES modules, no build step |
| Backend | FastAPI + uvicorn |
| LLM agent | OpenAI Agents SDK over `llama-server` (llama.cpp) — LFM2.5-2.6B default, Qwen3.5-4B optional |
| Speech-to-text | `whisper-server` (whisper.cpp, Metal) — `large-v3-turbo` q5, EN + IT |

## Minimum requirements

- **macOS on Apple Silicon** with Metal support and a webcam
- **Python 3.10+** (the Agents SDK requires it)
- `llama.cpp` and `whisper.cpp` (both available through Homebrew) — *not needed with `--vision-only`, see below*
- `ffmpeg` — *not needed with `--vision-only`*
- Enough memory for the selected local models; the only tested configuration is the M3 Pro / 36 GB setup noted above
- Model weights in `models/` (not tracked by Git) — *not needed with `--vision-only`*:
  - `LFM2.5-2.6B-Q8_0.gguf` — default agent model
  - `Qwen3.5-4B-Q8_0.gguf` — optional agent model
  - `ggml-large-v3-turbo-q5_0.bin` — speech-to-text model

Create the Python environment and install the dependencies:

```bash
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

## Tested models

HoloAirDesk has been tested with the following local models:

- **LFM2.5-2.6B Q8_0** — the default HOLO agent
- **Qwen3.5-4B Q8_0** — optional, selected with `HOLO_MODEL=qwen`
- **Whisper large-v3-turbo q5_0** — speech-to-text, with English and Italian support

Other model formats, sizes, platforms, and hardware configurations may work, but are outside the currently tested setup.

## Run

```bash
./run.sh                  # http://localhost:8000
HOLO_MODEL=qwen ./run.sh  # use Qwen3.5-4B as the agent
HOLO_ASR_LANG=it ./run.sh # pin speech language (default: auto EN/IT, ~+0.8 s)
./run.sh --lan            # HTTPS on 0.0.0.0:8443 for other LAN devices
./run.sh --vision-only    # gestures + windows only, no LLM / speech (see below)
```

`run.sh` starts `llama-server` (`:8080`), `whisper-server` (`:8091`), and the web app, then shuts everything down together on Ctrl-C. Flags can be combined (`./run.sh --lan --vision-only`).

### Vision-only mode (no llama.cpp / whisper.cpp)

If you just want to try the hand tracking, gestures, head pointer and window management — or you don't have `llama.cpp`, `whisper.cpp`, `ffmpeg` or the model weights installed, just run:

```bash
./run.sh --vision-only
```

In this mode `run.sh` starts only the web app: no `llama-server`, no `whisper-server`, no model files required (only the Python `.venv` and a webcam). The boot screen shows **REASONING CORE** and **AUDIO TRANSCODER** as `DISABLED`, the mic button is hidden and the voice assistant is off; everything else (tracking, pinch/drag/resize, clap, gather, head pointer, library windows, audio/image viewers) works as usual.

Under the hood the flag exports `HOLO_VISION_ONLY=1`, which the server reports in `/api/health`; you can set that variable yourself if you launch `uvicorn server.main:app` manually.

> The webcam only works in a **secure context**: `http://localhost` is fine, but to open the app from another machine you must use `--lan` (self-signed HTTPS — accept the browser warning once).

## Gestures

| Gesture | Action |
|---|---|
| Point (index + thumb) | Move the cursor — both hands work |
| Quick pinch | Click (buttons, dock, file cards, window ✕) |
| Hold pinch on a title bar | Grab and drag the window (images/audio: anywhere) |
| Pinch inside a text file | Slide vertically to scroll, horizontally to select text |
| Both hands pinch a window | Resize by pulling apart / together |
| Clap | Close every open window |
| Back of open hand held up 1.5s | Gather all windows into your hand — fist closes them, turning/dropping the hand releases them |

### Head pointer mode

The HEAD button in the dock switches to a hybrid mode: **your head steers a single cursor, your hands only pinch** to click and drag (two-hand resize is hands-mode only; the clap still works).

Enabling it starts a guided calibration: sit in your natural pose, keep your eyes on the center ring, and when the button unlocks press **SET CENTER** — it captures your pose from the ~2.5 seconds before the press, and that pose becomes "cursor at center".
Toggle HEAD off and on to recalibrate anytime. The pointer is anchored to rigid skull landmarks, so blinking and facial expressions don't move it, and it works at any distance from the camera. Sensitivity and smoothing knobs live at the top of `static/js/headpointer.js`.

## Voice assistant

Click the mic (bottom right), speak (English or Italian), click again to stop.
The transcription is sent to HOLO, which can call tools:
`open_file`, `read_file`, `write_file`, `replace_selected_text`, `close_file`, `play_audio`, `pause_audio`, `delete_file` — so "play the ambient theme", "stop the music" or "close the todo list" just work (it always knows which files are open and which audio is playing).

**Text selected** by pinch-dragging inside a text window rides along with the next voice message ("fix this sentence" just works). If HOLO modifies a file that is open on screen, the window refreshes live. HOLO always knows which files are currently open, and remembers the last 10 chat messages (tool
traffic and thinking tracks are not kept in the context).

## Library

Drop your own files into `library/`. Text files open in a scrollable panel, images in a viewer, audio in a player with a live spectrum. Only text files can be read/written by the agent.

## Layout

```
server/    FastAPI app: files API, /api/transcribe, /api/chat (SSE agent loop)
static/    frontend (js modules, css, vendored MediaPipe)
library/   the user files shown in the app
models/    gguf / whisper weights (gitignored)
run.sh     one-command launcher
NOTES.md   future ideas
```

## Credits

HoloAirDesk is built with and inspired by these excellent open-source projects:

- [llama.cpp](https://github.com/ggml-org/llama.cpp) for local LLM inference
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp) for local speech-to-text
- [MediaPipe](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) for hand and face tracking
