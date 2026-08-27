#!/usr/bin/env bash
# HoloAirDesk AI launcher: starts the LLM server, the ASR server and the web app.
#
#   ./run.sh                # LFM (default, fastest)
#   HOLO_MODEL=qwen ./run.sh
#   ./run.sh --lan          # serve HTTPS on 0.0.0.0:8443 (webcam needs a secure
#                           # context, so plain http only works on localhost)
#   ./run.sh --vision-only  # hand/head tracking + windows only: no llama-server,
#                           # no whisper-server (llama.cpp / whisper.cpp / models
#                           # not required). Flags can be combined.
set -euo pipefail
cd "$(dirname "$0")"

LAN=0
VISION_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --lan)         LAN=1 ;;
    --vision-only) VISION_ONLY=1 ;;
    -h|--help)     sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "[holoairdesk] unknown option: $arg (use --lan, --vision-only)"; exit 1 ;;
  esac
done

PY="./.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "[holoairdesk] no .venv found — create it with:"
  echo "  python3.12 -m venv .venv && ./.venv/bin/pip install -r requirements.txt"
  exit 1
fi

APP_PORT="${HOLO_PORT:-8000}"
LLAMA_PORT=8080
WHISPER_PORT=8091

case "${HOLO_MODEL:-lfm}" in
  qwen) LLM_MODEL="models/Qwen3.5-4B-Q8_0.gguf" ;;
  *)    LLM_MODEL="models/LFM2.5-2.6B-Q8_0.gguf" ;;
esac
WHISPER_MODEL="models/ggml-large-v3-turbo-q5_0.bin"

mkdir -p logs

SIDECAR_PIDS=()
if [[ "$VISION_ONLY" == "1" ]]; then
  echo "[holoairdesk] vision-only mode: skipping llama-server and whisper-server"
  export HOLO_VISION_ONLY=1
else
  for bin in llama-server whisper-server; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "[holoairdesk] '$bin' not found in PATH."
      echo "  install llama.cpp / whisper.cpp, or run without the assistant:  ./run.sh --vision-only"
      exit 1
    fi
  done

  echo "[holoairdesk] starting llama-server ($LLM_MODEL) on :$LLAMA_PORT"
  llama-server -m "$LLM_MODEL" --host 127.0.0.1 --port "$LLAMA_PORT" \
    -c 16384 -ngl 99 --jinja > logs/llama.log 2>&1 &
  SIDECAR_PIDS+=($!)

  echo "[holoairdesk] starting whisper-server ($WHISPER_MODEL) on :$WHISPER_PORT"
  whisper-server -m "$WHISPER_MODEL" --host 127.0.0.1 --port "$WHISPER_PORT" \
    -t 8 > logs/whisper.log 2>&1 &
  SIDECAR_PIDS+=($!)
fi

cleanup() {
  echo "[holoairdesk] shutting down"
  if [[ ${#SIDECAR_PIDS[@]} -gt 0 ]]; then
    kill "${SIDECAR_PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ "$LAN" == "1" ]]; then
  # Browsers only allow webcam access from secure contexts: generate a
  # self-signed cert so the app can be reached from other devices on the LAN.
  mkdir -p certs
  if [[ ! -f certs/holo.crt ]]; then
    openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
      -keyout certs/holo.key -out certs/holo.crt -subj "/CN=holoairdesk.local" 2>/dev/null
  fi
  echo "[holoairdesk] app on https://$(ipconfig getifaddr en0 2>/dev/null || echo 0.0.0.0):8443 (accept the self-signed cert)"
  "$PY" -m uvicorn server.main:app --host 0.0.0.0 --port 8443 \
    --ssl-keyfile certs/holo.key --ssl-certfile certs/holo.crt
else
  echo "[holoairdesk] app on http://localhost:$APP_PORT"
  "$PY" -m uvicorn server.main:app --host 127.0.0.1 --port "$APP_PORT"
fi
