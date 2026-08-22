# HoloAirDesk AI

A Jarvis-style holographic desktop in the browser. Your hands, tracked through
the webcam, become glowing pointers: pinch to click, hold the pinch to drag
windows around, pinch with both hands to resize them, clap to clear the space.
A local voice assistant (HOLO) opens, reads, writes and deletes the files in
your library — everything runs on-device.

## Stack

| Piece | Tech |
|---|---|
| Hand tracking | MediaPipe HandLandmarker (vendored, GPU delegate) + One-Euro smoothing |
| Head pointer (optional) | MediaPipe FaceLandmarker — head steers the cursor, hands pinch |
| UI | Vanilla ES modules, no build step |
| Backend | FastAPI + uvicorn |
| LLM agent | OpenAI Agents SDK over `llama-server` (llama.cpp) — LFM2.5-2.6B default, Qwen3.5-4B optional |
| Speech-to-text | `whisper-server` (whisper.cpp; Metal on macOS, CPU-first on Windows) — EN + IT |

## Requirements

- Webcam and Python 3.10+ (3.12 is recommended; the agent SDK needs Python 3.10+)
- `llama-server` from [llama.cpp](https://github.com/ggml-org/llama.cpp)
- `whisper-server` from [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- `ffmpeg`, available on `PATH`
- Model weights in `models/` (not tracked by git):
  - `LFM2.5-2.6B-Q8_0.gguf` (default agent), `LFM2.5-1.2B-Thinking-Q8_0.gguf` (lower-memory fallback), or `Qwen3.5-4B-Q8_0.gguf`
  - `ggml-large-v3-turbo-q5_0.bin` (whisper)

### macOS

```bash
brew install llama.cpp whisper-cpp ffmpeg
python3.12 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```

Apple Silicon uses the Metal-capable binaries supplied by Homebrew. Put the
models above in `models/` and use `run.sh`.

### Windows 10/11 (CPU-first)

The Windows launcher is [`run.ps1`](run.ps1). It starts the same three local
processes as `run.sh`, but uses Windows paths and process management. It
defaults to `HOLO_GPU_LAYERS=0`, so it is safe to try on an integrated GPU;
the LLM runs on CPU unless you deliberately install a compatible acceleration
build. Expect the `large-v3-turbo` Whisper model to be demanding on this kind
of machine: `base` or `small` is a much better first test.

Open PowerShell (not as Administrator) in the repository and install Python
and FFmpeg. Close and reopen PowerShell after `winget` completes so the new
PATH is visible.

```powershell
winget install --exact --id Python.Python.3.12
winget install --exact --id Gyan.FFmpeg
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

#### 1. Install `llama-server`

The quickest route is to download a Windows x64 **CPU** binary package from
[llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases), extract
it to (for example) `tools\llama`, and point the launcher at it for the current
PowerShell session:

```powershell
$env:HOLO_LLAMA_SERVER = (Resolve-Path .\tools\llama\llama-server.exe).Path
```

Alternatively, add the folder containing `llama-server.exe` to `PATH`. If you
later want to experiment with Intel integrated graphics, build or download a
Vulkan/SYCL-compatible llama.cpp package and only then try offloading layers:

```powershell
$env:HOLO_GPU_LAYERS = '99'   # only if the accelerated build and VRAM work
```

CPU mode (`0`) is the reliable baseline and is the default in `run.ps1`.

#### 2. Build and install `whisper-server`

Install Git, CMake and the Visual Studio Build Tools with the **Desktop
development with C++** workload. Then build the official `whisper-server`
example:

```powershell
winget install --exact --id Git.Git
winget install --exact --id Kitware.CMake
# Install Visual Studio 2022 Build Tools, selecting "Desktop development with C++".

git clone https://github.com/ggml-org/whisper.cpp .\third_party\whisper.cpp
cmake -S .\third_party\whisper.cpp -B .\third_party\whisper.cpp\build -DWHISPER_BUILD_SERVER=ON
cmake --build .\third_party\whisper.cpp\build --config Release --target whisper-server
$env:HOLO_WHISPER_SERVER = (Resolve-Path .\third_party\whisper.cpp\build\bin\Release\whisper-server.exe).Path
```

Keep the DLLs produced next to `whisper-server.exe`; do not copy the `.exe` by
itself. The launcher invokes Whisper only on `127.0.0.1`, and its uploaded
audio is converted by FFmpeg before transcription.

For a lower-memory first run, download a smaller multilingual Whisper model
and point the launcher to it. (`base` supports both English and Italian.)

```powershell
& .\third_party\whisper.cpp\models\download-ggml-model.cmd base
$env:HOLO_WHISPER_MODEL = (Resolve-Path .\third_party\whisper.cpp\models\ggml-base.bin).Path
```

You can instead place `ggml-large-v3-turbo-q5_0.bin` in this repository's
`models\` directory, which is the launcher's default. Model download/build
details are maintained by [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
and its [server example](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server).

#### 3. Add the LFM model and run

Put your GGUF in `models\`. `LFM2.5-1.2B-Thinking-Q8_0.gguf` is detected as a
lower-memory fallback when the default 2.6B model is absent. For any other
filename, set `HOLO_LLM_MODEL` to the model you downloaded:

```powershell
$env:HOLO_LLM_MODEL = (Resolve-Path .\models\your-smaller-lfm.gguf).Path
.\run.ps1                         # http://localhost:8000
```

Other Windows examples:

```powershell
$env:HOLO_MODEL = 'qwen'; .\run.ps1
$env:HOLO_ASR_LANG = 'it'; .\run.ps1
.\run.ps1 -Lan
```

`-Lan` needs `openssl.exe` on `PATH` the first time it creates the local
certificate. A convenient option is `winget install --exact --id
ShiningLight.OpenSSL`; accept the browser's self-signed-certificate warning on
the client device. It also needs the Windows Firewall prompt for port 8443.

#### Windows troubleshooting

Before starting the launcher, `Get-Command ffmpeg` must print the path to
`ffmpeg.exe`. If it does not, start a fresh PowerShell after the FFmpeg install
or set the executable explicitly (then start `run.ps1` from that same window):

```powershell
$env:HOLO_FFMPEG = 'C:\path\to\ffmpeg.exe'
.\run.ps1
```

The launcher now checks this prerequisite before it starts the servers. The
same variable also lets you use a portable FFmpeg installation.

On a CPU-only machine, do not leave the speech language on `auto`: it requires
an additional encoder pass. Pin it before launching (and restart the launcher
after setting it):

```powershell
$env:HOLO_ASR_LANG = 'it' # use 'en' when speaking English
.\run.ps1
```

The local Whisper request timeout is 180 seconds by default. If a very slow
machine still needs longer, set `HOLO_ASR_TIMEOUT` (in seconds). Prefer the
smaller `base` model above instead; it is dramatically more responsive than
the large-v3-turbo q5 model on CPU. `run.ps1` starts Whisper with `-ng`
(CPU-only) unless `HOLO_WHISPER_GPU=1` is explicitly set for a compatible GPU
build.

### Launchers and cross-platform conventions

`run.sh` cannot run directly in ordinary Windows PowerShell: it is a Bash
script and uses Unix paths/signals. A common, clear repository convention is
to keep a launcher per native shell: `run.sh` for macOS/Linux and `run.ps1`
for Windows, with the same environment-variable interface. That is what this
repository now uses. Git Bash or WSL can run `run.sh`, but `run.ps1` is the
native Windows route and avoids relying on those compatibility layers.

## Run

```bash
./run.sh                 # http://localhost:8000
HOLO_MODEL=qwen ./run.sh # use Qwen3.5-4B as the agent
HOLO_ASR_LANG=it ./run.sh# pin the speech language (default: auto EN/IT, ~+0.8s)
./run.sh --lan           # HTTPS on 0.0.0.0:8443 for other devices on the LAN
```

`run.sh` starts llama-server (:8080), whisper-server (:8091) and the web app,
and shuts everything down together on Ctrl-C.

On Windows, run `./run.ps1` from PowerShell instead; see the Windows setup
section above for the one-time dependencies and model paths.

> The webcam only works in a *secure context*: `http://localhost` is fine, but
> to open the app from another machine you must use `--lan` (self-signed
> HTTPS — accept the browser warning once).

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

The HEAD button in the dock switches to a hybrid mode: **your head steers a
single cursor, your hands only pinch** to click and drag (two-hand resize is
hands-mode only; the clap still works). Enabling it starts a guided
calibration: sit in your natural pose, keep your eyes on the center ring, and
when the button unlocks press **SET CENTER** — it captures your pose from the
~2.5 seconds before the press, and that pose becomes "cursor at center".
Toggle HEAD off and on to recalibrate anytime. The pointer is anchored to
rigid skull landmarks, so blinking and facial expressions don't move it, and
it works at any distance from the camera. Sensitivity and smoothing knobs
live at the top of `static/js/headpointer.js`.

## Voice assistant

Click the mic (bottom right), speak (English or Italian), click again to stop.
The transcription is sent to HOLO, which can call tools:
`open_file`, `read_file`, `write_file`, `replace_selected_text`, `close_file`,
`play_audio`, `pause_audio`, `delete_file` — so "play the ambient theme",
"stop the music" or "close the todo list" just work (it always knows which
files are open and which audio is playing).
Text selected by pinch-dragging inside a text window rides along with the
next voice message ("fix this sentence" just works). If HOLO modifies a file
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
run.sh      macOS/Linux launcher
run.ps1     Windows PowerShell launcher
NOTES.md   future ideas
```
