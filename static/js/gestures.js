// Gesture engine: turns raw hand landmarks into pointer events
// (down / move / up / click), plus the two-hand clap.
//
// Landmark indices: 0 wrist, 4 thumb tip, 8 index tip, 9 middle MCP,
// 5 index MCP, 17 pinky MCP.
import { OneEuro } from "/js/tracking.js";

const PINCH_ON = 0.25;     // pinch closes below this (normalized by hand size) — fingertips nearly touching
const PINCH_OFF = 0.40;    // ...and re-opens above this (hysteresis)
const PINCH_CONFIRM = 2;   // frames of confirmation before pinch-down fires
const CLICK_MS = 320;      // max pinch duration for a "click"
const CLICK_MOVE = 26;     // max cursor travel (px) for a "click"
const LOST_GRACE_MS = 180; // keep a briefly-lost hand alive this long
const AMP_X = 1.45;        // camera-to-screen movement amplification
const AMP_Y = 1.9;         // steeper on Y with a raised pivot: the screen bottom is
const PIVOT_Y = 0.44;      // reached while the hand is still well inside the frame,
                           // where tracking stays accurate
const CLAP_NEAR = 1.15;    // palms closer than this (in hand-sizes) = contact
const CLAP_FAR = 2.3;      // ...coming from at least this far apart
const CLAP_WINDOW_MS = 420;
const CLAP_COOLDOWN_MS = 1400;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

class HandState {
  constructor(slot) {
    this.slot = slot;
    this.present = false;
    this.lastSeen = 0;
    this.fx = new OneEuro({ minCutoff: 1.1, beta: 0.02 });
    this.fy = new OneEuro({ minCutoff: 1.1, beta: 0.02 });
    this.x = 0; this.y = 0;
    this.pinching = false;
    this.pinchFrames = 0;
    this.downT = 0; this.downX = 0; this.downY = 0; this.travel = 0;
    this.palm = { x: 0, y: 0 };
    this.size = 0.1;
    this.el = document.getElementById(`cursor-${slot}`);
  }
}

export class GestureEngine {
  constructor(handlers) {
    this.h = handlers; // {onDown, onMove, onUp, onClap, onHands}
    this.hands = [new HandState(0), new HandState(1)];
    this.palmGap = []; // recent {t, gap} samples for clap detection
    this.lastClap = 0;
  }

  processFrame(result, t) {
    const seen = [false, false];
    const lms = result.landmarks || [];
    const handedness = result.handedness || result.handednesses || [];

    for (let i = 0; i < lms.length && i < 2; i++) {
      const label = handedness[i]?.[0]?.categoryName || (i === 0 ? "Left" : "Right");
      let slot = label === "Left" ? 0 : 1;
      if (seen[slot]) slot = 1 - slot; // both detected as same side: split them
      if (seen[slot]) continue;
      seen[slot] = true;
      this.updateHand(this.hands[slot], lms[i], t);
    }

    for (const hand of this.hands) {
      if (!seen[hand.slot] && hand.present && t - hand.lastSeen > LOST_GRACE_MS) {
        this.dropHand(hand, t);
      }
    }

    this.detectClap(t);
    this.h.onHands?.(this.hands.filter((h) => h.present).length);
  }

  updateHand(hand, lm, t) {
    hand.lastSeen = t;
    hand.size = Math.max(dist(lm[0], lm[9]), 0.02);
    hand.palm = {
      x: (lm[0].x + lm[5].x + lm[17].x) / 3,
      y: (lm[0].y + lm[5].y + lm[17].y) / 3,
    };

    // pointer anchor: thumb/index midpoint (stays put while the pinch closes)
    const rawX = 1 - (lm[4].x + lm[8].x) / 2; // mirrored video
    const rawY = (lm[4].y + lm[8].y) / 2;
    const nx = (rawX - 0.5) * AMP_X + 0.5;
    const ny = (rawY - PIVOT_Y) * AMP_Y + 0.5;
    const px = Math.min(Math.max(nx * innerWidth, 0), innerWidth - 1);
    const py = Math.min(Math.max(ny * innerHeight, 0), innerHeight - 1);

    if (!hand.present) {
      hand.present = true;
      hand.fx.reset();
      hand.fy.reset();
      hand.el.style.display = "block";
    }
    const prevX = hand.x, prevY = hand.y;
    hand.x = hand.fx.filter(px, t);
    hand.y = hand.fy.filter(py, t);
    hand.el.style.transform = `translate(${hand.x}px, ${hand.y}px)`;

    // pinch with hysteresis + confirmation frames
    const pinchAmt = dist(lm[4], lm[8]) / hand.size;
    if (!hand.pinching) {
      if (pinchAmt < PINCH_ON) {
        if (++hand.pinchFrames >= PINCH_CONFIRM) {
          hand.pinching = true;
          hand.downT = t; hand.downX = hand.x; hand.downY = hand.y; hand.travel = 0;
          hand.el.classList.add("pinch");
          this.h.onDown?.(hand.slot, hand.x, hand.y);
        }
      } else hand.pinchFrames = 0;
    } else {
      hand.travel += Math.hypot(hand.x - prevX, hand.y - prevY);
      if (pinchAmt > PINCH_OFF) {
        hand.pinching = false;
        hand.pinchFrames = 0;
        hand.el.classList.remove("pinch");
        const wasClick = t - hand.downT < CLICK_MS && hand.travel < CLICK_MOVE;
        if (wasClick) this.ripple(hand);
        this.h.onUp?.(hand.slot, hand.x, hand.y, wasClick);
      }
    }
    this.h.onMove?.(hand.slot, hand.x, hand.y, hand.pinching);
  }

  dropHand(hand, t) {
    hand.present = false;
    hand.el.style.display = "none";
    if (hand.pinching) {
      hand.pinching = false;
      hand.pinchFrames = 0;
      hand.el.classList.remove("pinch");
      this.h.onUp?.(hand.slot, hand.x, hand.y, false);
    }
    void t;
  }

  detectClap(t) {
    const [a, b] = this.hands;
    if (!a.present || !b.present) { this.palmGap.length = 0; return; }
    const avgSize = (a.size + b.size) / 2;
    const gap = dist(a.palm, b.palm) / avgSize;
    this.palmGap.push({ t, gap });
    while (this.palmGap.length && t - this.palmGap[0].t > CLAP_WINDOW_MS) this.palmGap.shift();

    if (gap < CLAP_NEAR && !a.pinching && !b.pinching && t - this.lastClap > CLAP_COOLDOWN_MS) {
      const wasFar = this.palmGap.some((s) => s.gap > CLAP_FAR);
      if (wasFar) {
        this.lastClap = t;
        this.palmGap.length = 0;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        this.h.onClap?.(cx, cy);
      }
    }
  }

  ripple(hand) {
    const r = document.createElement("div");
    r.className = "click-ripple";
    hand.el.appendChild(r);
    setTimeout(() => r.remove(), 500);
  }
}
