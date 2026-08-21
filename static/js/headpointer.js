// Head pointer (experimental): head orientation drives the cursor, hands only
// pinch. The pointer is the nose tip measured RELATIVE to the eye line and
// normalized by inter-ocular distance, so it reacts to head rotation but not
// to moving around in front of the camera, at any distance.
//
// A short neutral-pose calibration runs every time the mode is enabled:
// look at the center of the screen and hold still for ~1 second.
import { FilesetResolver, FaceLandmarker } from "/vendor/mediapipe/vision_bundle.mjs";
import { OneEuro } from "/js/tracking.js";

// screen fractions of travel per unit of normalized nose offset — raise a
// gain if you need too much head rotation to reach the edges
const GAIN_X = 3.4;
const GAIN_Y = 4.2;
const CALIB_FRAMES = 25;

const NOSE = 1, EYE_L = 33, EYE_R = 263; // canonical face-mesh indices

let landmarker = null;
let active = false;
let neutral = null;
let calib = [];
let fx = new OneEuro({ minCutoff: 0.6, beta: 0.01 });
let fy = new OneEuro({ minCutoff: 0.6, beta: 0.01 });

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
  fx.reset();
  fy.reset();
  document.body.classList.toggle("headmode", active);
  return active;
}

// called from the tracking loop while active; returns the pointer state
export function update(video, t) {
  let face = null;
  try {
    face = landmarker.detectForVideo(video, t).faceLandmarks?.[0];
  } catch { /* transient GPU hiccup */ }
  if (!face) return { present: false };

  const nose = face[NOSE], el = face[EYE_L], er = face[EYE_R];
  const iod = Math.max(Math.hypot(el.x - er.x, el.y - er.y), 1e-4);
  const midX = (el.x + er.x) / 2, midY = (el.y + er.y) / 2;
  const ox = (nose.x - midX) / iod;
  const oy = (nose.y - midY) / iod;

  if (!neutral) {
    calib.push([ox, oy]);
    if (calib.length < CALIB_FRAMES) return { present: false, calibrating: true };
    neutral = {
      x: calib.reduce((s, c) => s + c[0], 0) / calib.length,
      y: calib.reduce((s, c) => s + c[1], 0) / calib.length,
    };
    calib = [];
  }

  // mirrored view: turning the head toward the user's right moves the cursor right
  const nx = 0.5 + (neutral.x - ox) * GAIN_X;
  const ny = 0.5 + (oy - neutral.y) * GAIN_Y;
  const x = fx.filter(Math.min(Math.max(nx, 0), 1) * innerWidth, t);
  const y = fy.filter(Math.min(Math.max(ny, 0), 1) * innerHeight, t);
  return { present: true, x, y };
}
