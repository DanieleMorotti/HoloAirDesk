// Webcam + MediaPipe HandLandmarker wrapper.
// Exposes startTracking(video, onFrame) where onFrame receives raw landmark
// data per detected hand at camera frame rate.
import { FilesetResolver, HandLandmarker } from "/vendor/mediapipe/vision_bundle.mjs";

export async function openCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user", frameRate: { ideal: 30 } },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((res) => {
    if (video.readyState >= 2) return res();
    video.onloadeddata = () => res();
  });
  await video.play().catch(() => {});
  return stream;
}

export async function createLandmarker() {
  const fileset = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "/vendor/mediapipe/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

// One Euro filter — low-lag adaptive smoothing for cursor coordinates.
class LowPass {
  constructor() { this.y = null; }
  filter(x, alpha) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }
}

export class OneEuro {
  constructor({ minCutoff = 1.0, beta = 0.012, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
    this.lastRaw = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value, tMs) {
    if (this.lastT === null) {
      this.lastT = tMs;
      this.lastRaw = value;
      this.x.filter(value, 1);
      this.dx.filter(0, 1);
      return value;
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-3);
    this.lastT = tMs;
    const dv = (value - this.lastRaw) / dt;
    this.lastRaw = value;
    const edv = this.dx.filter(dv, OneEuro.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edv);
    return this.x.filter(value, OneEuro.alpha(cutoff, dt));
  }
  reset() { this.x = new LowPass(); this.dx = new LowPass(); this.lastT = null; this.lastRaw = null; }
}

// Main loop: run detection once per new video frame, forward results.
export function startTracking(landmarker, video, onFrame) {
  let lastVideoTime = -1;
  let running = true;
  function loop() {
    if (!running) return;
    if (video.currentTime !== lastVideoTime && video.readyState >= 2) {
      lastVideoTime = video.currentTime;
      const t = performance.now();
      let result = null;
      try {
        result = landmarker.detectForVideo(video, t);
      } catch { /* transient GPU hiccup: skip frame */ }
      if (result) onFrame(result, t);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  return () => { running = false; };
}
