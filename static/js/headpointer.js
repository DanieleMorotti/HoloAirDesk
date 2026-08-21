// Head pointer (experimental): head orientation drives the cursor, hands only
// pinch. The pointer is the nose measured RELATIVE to rigid skull landmarks
// (face-oval points near the ears), normalized by face width — so it reacts
// to head rotation but not to blinking, eyebrow movement, moving around in
// front of the camera, or distance changes.
//
// A short neutral-pose calibration runs every time the mode is enabled:
// look at the center of the screen and hold still for ~1 second.
import { FilesetResolver, FaceLandmarker } from "/vendor/mediapipe/vision_bundle.mjs";
import { OneEuro } from "/js/tracking.js";

// --- tuning ---------------------------------------------------------------
const GAIN_X = 3.8;      // screen travel per unit of normalized nose offset
const GAIN_Y = 4.6;
const EXPO = 1.35;       // >1 compresses small deviations: precision near the
                         // target, full speed on larger head turns
const DEAD_PX = 2.5;     // output hysteresis: moves smaller than this freeze
const CALIB_FRAMES = 35; // ~1.2s of neutral pose, median-averaged
// ---------------------------------------------------------------------------

// rigid landmarks (blink/expression-proof): nose tip+bottom, face-oval sides
const NOSE_PTS = [1, 4];
const REF_L = 234, REF_R = 454;

let landmarker = null;
let active = false;
let neutral = null;
let calib = [];
let out = null; // last emitted position, for the deadzone
let fx = new OneEuro({ minCutoff: 0.35, beta: 0.02 });
let fy = new OneEuro({ minCutoff: 0.35, beta: 0.02 });

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
export function isActive() { return active; }

export function toggle() {
  active = isReady() && !active;
  neutral = null;
  calib = [];
  out = null;
  fx.reset();
  fy.reset();
  document.body.classList.toggle("headmode", active);
  return active;
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
  if (!face) return out ? { present: true, ...out } : { present: false };

  const rl = face[REF_L], rr = face[REF_R];
  const width = Math.max(Math.hypot(rl.x - rr.x, rl.y - rr.y), 1e-4);
  const midX = (rl.x + rr.x) / 2, midY = (rl.y + rr.y) / 2;
  const noseX = NOSE_PTS.reduce((s, i) => s + face[i].x, 0) / NOSE_PTS.length;
  const noseY = NOSE_PTS.reduce((s, i) => s + face[i].y, 0) / NOSE_PTS.length;
  const ox = (noseX - midX) / width;
  const oy = (noseY - midY) / width;

  if (!neutral) {
    calib.push([ox, oy]);
    if (calib.length < CALIB_FRAMES) return { present: false, calibrating: true };
    neutral = { x: median(calib.map((c) => c[0])), y: median(calib.map((c) => c[1])) };
    calib = [];
  }

  // mirrored view: turning the head toward the user's right moves the cursor right
  const nx = 0.5 + shape((neutral.x - ox) * GAIN_X);
  const ny = 0.5 + shape((oy - neutral.y) * GAIN_Y);
  const x = fx.filter(Math.min(Math.max(nx, 0), 1) * innerWidth, t);
  const y = fy.filter(Math.min(Math.max(ny, 0), 1) * innerHeight, t);

  // deadzone: a still head means a frozen cursor
  if (out && Math.hypot(x - out.x, y - out.y) < DEAD_PX) {
    return { present: true, ...out };
  }
  out = { x, y };
  return { present: true, x, y };
}
