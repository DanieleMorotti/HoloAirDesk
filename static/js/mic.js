// Push-to-talk mic: click to record, click again to stop -> /api/transcribe -> chat.
import * as chat from "/js/chat.js";
import { sfx } from "/js/sfx.js";
import { toast } from "/js/hud.js";

let btn, state = "idle"; // idle | recording | busy
let stream = null, recorder = null, chunks = [];

function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

async function startRecording() {
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  }
  chunks = [];
  const mime = pickMime();
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = onRecorded;
  recorder.start();
  state = "recording";
  btn.classList.add("recording");
  sfx.micOn();
}

async function onRecorded() {
  state = "busy";
  btn.classList.remove("recording");
  btn.classList.add("busy");
  sfx.micOff();
  try {
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    if (blob.size < 1200) { toast("NO AUDIO CAPTURED"); return; }
    const form = new FormData();
    const ext = (recorder.mimeType || "").includes("mp4") ? "m4a" : "webm";
    form.append("audio", blob, `speech.${ext}`);
    const resp = await fetch("/api/transcribe", { method: "POST", body: form });
    if (!resp.ok) throw new Error(`ASR ${resp.status}`);
    const { text } = await resp.json();
    const clean = (text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, "").trim(); // strip [music] etc.
    if (!clean) { toast("NOTHING TRANSCRIBED"); return; }
    if (chat.isBusy()) { toast("HOLO IS STILL RESPONDING"); return; }
    await chat.send(clean);
  } catch (e) {
    toast(`TRANSCRIPTION FAILED`);
    sfx.error();
    console.error(e);
  } finally {
    state = "idle";
    btn.classList.remove("busy");
  }
}

export function init() {
  btn = document.getElementById("mic");
  btn.addEventListener("click", async () => {
    sfx.unlock();
    if (state === "recording") {
      recorder?.stop();
    } else if (state === "idle") {
      try {
        await startRecording();
      } catch (e) {
        toast("MICROPHONE ACCESS DENIED");
        sfx.error();
        console.error(e);
      }
    }
  });
}
