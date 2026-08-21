// Head pointer (experimental): head orientation drives the cursor, hands only
// pinch. The pointer is the nose measured RELATIVE to rigid skull landmarks
// (face-oval points near the ears), normalized by face width — so it reacts
// to head rotation but not to blinking, expressions, or distance changes.
//
// Calibration is an explicit step: a LOOK HERE ring appears at the screen
// center, samples accumulate for a few seconds, and the user confirms with
// the SET CENTER button (hands stay active during calibration to click it).
import { FilesetResolver, FaceLandmarker } from "/vendor/mediapipe/vision_bundle.mjs";
import { OneEuro } from "/js/tracking.js";

// --- tuning ---------------------------------------------------------------
const GAIN_X = 3.8;      // screen travel per unit of normalized nose offset
const GAIN_Y = 4.6;
const EXPO = 1.35;       // >1 compresses small deviations for precision
const DEAD_PX = 4;       // output hysteresis: moves smaller than this freeze
const MAX_SPEED = 2400;  // px/s: the cursor glides, it never jumps
// the neutral pose is the median of exactly the last WINDOW samples at the
// moment SET CENTER is pressed — i.e. your pose from the ~2.5s before the press
const MIN_SAMPLES = 75;
const MAX_SAMPLES = 75;
// ---------------------------------------------------------------------------

// rigid landmarks (blink/expression-proof): nose tip+bottom, face-oval sides
const NOSE_PTS = [1, 4];
const REF_L = 234, REF_R = 454;

let landmarker = null;
let phase = "off"; // off | calib | ready
let neutral = null;
let samples = [];
let out = null;    // last emitted position
let lastT = null;
let fx = new OneEuro({ minCutoff: 0.22, beta: 0.015 });
let fy = new OneEuro({ minCutoff: 0.22, beta: 0.015 });

export async function init() {
  const fileset = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "/vendor/mediapipe/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
}

export function isReady() { return !!landmarker; }
export function isActive() { return phase !== "off"; }   // calibrating or on
export function isOn() { return phase === "ready"; }

function overlay(on) {
  document.getElementById("head-calib")?.classList.toggle("hidden", !on);
}

function reset() {
  neutral = null;
  samples = [];
  out = null;
  lastT = null;
  fx.reset();
  fy.reset();
}

export function beginCalibration() {
  if (!isReady()) return false;
  reset();
  phase = "calib";
  overlay(true);
  updateOverlay();
  return true;
}

export function confirmCalibration() {
  if (phase !== "calib" || samples.length < MIN_SAMPLES) return false;
  neutral = {
    x: median(samples.map((s) => s[0])),
    y: median(samples.map((s) => s[1])),
  };
  phase = "ready";
  overlay(false);
  document.body.classList.add("headmode");
  return true;
}

export function disable() {
  phase = "off";
  reset();
  overlay(false);
  document.body.classList.remove("headmode");
}

function updateOverlay() {
  const btn = document.getElementById("head-calib-btn");
  if (!btn) return;
  if (samples.length < MIN_SAMPLES) {
    btn.disabled = true;
    btn.textContent = `HOLD STILL — ${Math.ceil((MIN_SAMPLES - samples.length) / 30)}s`;
  } else {
    btn.disabled = false;
    btn.textContent = "SET CENTER";
  }
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// signed expo curve: |v|^EXPO keeping the sign
const shape = (v) => Math.sign(v) * Math.pow(Math.abs(v), EXPO);

// called from the tracking loop while active; returns the pointer state
export function update(video, t) {
  let face = null;
  try {
    face = landmarker.detectForVideo(video, t).faceLandmarks?.[0];
  } catch { /* transient GPU hiccup */ }
  if (!face) {
    if (phase === "calib") updateOverlay();
    return out ? { present: true, ...out } : { present: false };
  }

  const rl = face[REF_L], rr = face[REF_R];
  const width = Math.max(Math.hypot(rl.x - rr.x, rl.y - rr.y), 1e-4);
  const midX = (rl.x + rr.x) / 2, midY = (rl.y + rr.y) / 2;
  const noseX = NOSE_PTS.reduce((s, i) => s + face[i].x, 0) / NOSE_PTS.length;
  const noseY = NOSE_PTS.reduce((s, i) => s + face[i].y, 0) / NOSE_PTS.length;
  const ox = (noseX - midX) / width;
  const oy = (noseY - midY) / width;

  if (phase === "calib") {
    samples.push([ox, oy]);
    if (samples.length > MAX_SAMPLES) samples.shift();
    updateOverlay();
    return { present: false, calibrating: true };
  }

  // mirrored view: turning the head toward the user's right moves the cursor right
  const nx = 0.5 + shape((neutral.x - ox) * GAIN_X);
  const ny = 0.5 + shape((oy - neutral.y) * GAIN_Y);
  const tx = fx.filter(Math.min(Math.max(nx, 0), 1) * innerWidth, t);
  const ty = fy.filter(Math.min(Math.max(ny, 0), 1) * innerHeight, t);

  const dt = lastT === null ? 0.033 : Math.min(Math.max((t - lastT) / 1000, 0.001), 0.1);
  lastT = t;

  if (!out) { out = { x: tx, y: ty }; return { present: true, ...out }; }

  // deadzone: a still head means a frozen cursor
  const dx = tx - out.x, dy = ty - out.y;
  const d = Math.hypot(dx, dy);
  if (d < DEAD_PX) return { present: true, ...out };

  // slew limiter: glide toward the target at a capped speed, never jump
  const maxStep = MAX_SPEED * dt;
  const k = d > maxStep ? maxStep / d : 1;
  out = { x: out.x + dx * k, y: out.y + dy * k };
  return { present: true, ...out };
}
