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
const AMP_X = 1.35;        // camera-to-screen movement amplification
const AMP_Y = 1.65;        // slightly steeper on Y with a raised pivot: the screen
const PIVOT_Y = 0.46;      // bottom is reached before the hand leaves the frame
const CLAP_NEAR = 1.25;    // palms closer than this (in hand-sizes) = contact
const CLAP_FAR = 1.9;      // ...coming from at least this far apart
const CLAP_LOSS_NEAR = 1.7;// tracking often drops a hand right at contact:
const CLAP_LOSS_MS = 160;  // treat approach + hand-loss as a clap too
const CLAP_WINDOW_MS = 600;
const CLAP_MIN_AGE_MS = 300;  // both hands must be tracked this long: phantom
                              // detections flicker in briefly and must not clap
const CLAP_SIZE_RATIO = 1.6;  // real hands have similar sizes on camera
const GATHER_HOLD_MS = 1500;  // open hand held vertical this long = gather
const GATHER_GRACE_MS = 700;  // mid-curl fingers are neither open nor fist
const CLAP_COOLDOWN_MS = 1400;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// finger tips vs their PIP joints, measured from the wrist:
// extended finger = tip clearly beyond the joint, curled = tip behind it
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]];

function isOpenVertical(lm) {
  const extended = FINGERS.every(([tip, pip]) => dist(lm[tip], lm[0]) > dist(lm[pip], lm[0]) * 1.2);
  if (!extended) return false;
  // fingers pointing up: wrist -> middle-MCP vector within ~35 deg of vertical
  const vx = lm[9].x - lm[0].x, vy = lm[9].y - lm[0].y;
  return -vy > 1.4 * Math.abs(vx);
}

function isFist(lm) {
  let curled = 0;
  for (const [tip, pip] of FINGERS) {
    if (dist(lm[tip], lm[0]) < dist(lm[pip], lm[0]) * 1.05) curled++;
  }
  return curled >= 3;
}

// Is the BACK of the hand (not the palm or the edge) facing the camera?
// Chosen as the gather trigger because normal pointing/pinching happens
// palm-out, so the back of the hand cannot be shown by accident.
// The cross product of wrist->index-MCP and wrist->pinky-MCP flips sign
// between palm and back, and shrinks to ~0 when the hand is edge-on; the
// expected sign depends on which hand it is (MediaPipe label, raw video).
function isBackOfHand(lm, label) {
  const v1x = lm[5].x - lm[0].x, v1y = lm[5].y - lm[0].y;
  const v2x = lm[17].x - lm[0].x, v2y = lm[17].y - lm[0].y;
  const size = Math.max(dist(lm[0], lm[9]), 1e-4);
  const cross = (v1x * v2y - v1y * v2x) / (size * size);
  return label === "Left" ? cross < -0.22 : cross > 0.22;
}

class HandState {
  constructor(slot) {
    this.slot = slot;
    this.present = false;
    this.lastSeen = 0;
    this.firstSeen = 0;
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
    // head-pointer mode: the head drives the (single) cursor, one hand pinches
    this.headMode = false;
    this.headPoint = { present: false, x: 0, y: 0 };
    // gather gesture: open hand held vertical -> windows condense to the hand,
    // fist -> close them all, relaxing the hand -> they fly back
    this.gather = { state: "idle", slot: -1, t0: 0, lastOkT: 0 };
  }

  setHeadMode(on) {
    this.headMode = on;
    // release anything held so no drag survives the mode switch
    for (const hand of this.hands) {
      if (hand.pinching) {
        hand.pinching = false;
        hand.pinchFrames = 0;
        hand.el.classList.remove("pinch");
        this.h.onUp?.(hand.slot, hand.x, hand.y, false);
      }
      hand.el.style.display = "none";
      hand.present = false;
    }
  }

  // in head mode a single hand supplies the pinch: prefer the one already
  // pinching (mid-drag), otherwise the first visible one
  drivingSlot() {
    const pinching = this.hands.find((h) => h.present && h.pinching);
    if (pinching) return pinching.slot;
    const present = this.hands.find((h) => h.present);
    return present ? present.slot : 0;
  }

  processFrame(result, t) {
    const seen = [false, false];
    const lms = result.landmarks || [];
    const handedness = result.handedness || result.handednesses || [];

    let entries = [];
    for (let i = 0; i < lms.length && i < 2; i++) {
      const cat = handedness[i]?.[0] || {};
      entries.push({
        lm: lms[i],
        label: cat.categoryName || (i === 0 ? "Left" : "Right"),
        score: cat.score ?? 0,
      });
    }

    // an edge-on hand with all fingers visible is sometimes detected twice
    // (a phantom hand among the fingers): if two detections overlap almost
    // completely, keep only the more confident one
    if (entries.length === 2) {
      const pc = entries.map((e) => ({
        x: (e.lm[0].x + e.lm[5].x + e.lm[17].x) / 3,
        y: (e.lm[0].y + e.lm[5].y + e.lm[17].y) / 3,
        s: Math.max(dist(e.lm[0], e.lm[9]), 1e-4),
      }));
      const gap = Math.hypot(pc[0].x - pc[1].x, pc[0].y - pc[1].y) / ((pc[0].s + pc[1].s) / 2);
      const ratio = Math.max(pc[0].s, pc[1].s) / Math.min(pc[0].s, pc[1].s);
      // real hands never overlap this much while both stay trackable, and a
      // phantom detected among the fingers usually has a very different size
      if (gap < 1.0 || (gap < 1.8 && ratio > 1.6)) {
        entries = [entries[entries[0].score >= entries[1].score ? 0 : 1]];
      }
    }

    for (const e of entries) {
      let slot = e.label === "Left" ? 0 : 1;
      if (seen[slot]) slot = 1 - slot; // both detected as same side: split them
      if (seen[slot]) continue;
      seen[slot] = true;
      this.updateHand(this.hands[slot], e.lm, e.label, t);
    }

    for (const hand of this.hands) {
      if (!seen[hand.slot] && hand.present && t - hand.lastSeen > LOST_GRACE_MS) {
        this.dropHand(hand, t);
      }
    }

    // head mode: the cursor follows the head even with no hands in frame
    // (hover works; a hand is only needed to pinch)
    if (this.headMode && this.headPoint.present && !this.hands.some((h) => h.present)) {
      const h0 = this.hands[0];
      h0.x = this.headPoint.x;
      h0.y = this.headPoint.y;
      h0.el.style.display = "block";
      h0.el.style.transform = `translate(${h0.x}px, ${h0.y}px)`;
      this.h.onMove?.(0, h0.x, h0.y, false);
    }

    this.updateGather(t);
    this.detectClap(t);
    this.h.onHands?.(this.hands.filter((h) => h.present).length);
  }

  updateGather(t) {
    const g = this.gather;

    if (g.state === "idle") {
      const cand = this.hands.find((h) => h.present && h.openVertical && !h.pinching);
      if (cand && this.h.canGather?.()) {
        g.state = "charging";
        g.slot = cand.slot;
        g.t0 = t;
      }
      return;
    }

    const hand = this.hands[g.slot];
    const pos = hand.rawScreen || { x: 0, y: 0 };

    if (g.state === "charging") {
      if (!hand.present || !hand.openVertical || !this.h.canGather?.()) {
        g.state = "idle";
        g.slot = -1;
        this.h.onGatherCharge?.(0, 0, 0, false);
        return;
      }
      const p = (t - g.t0) / GATHER_HOLD_MS;
      if (p >= 1) {
        g.state = "gathered";
        g.lastOkT = t;
        this.h.onGatherCharge?.(1, pos.x, pos.y, false);
        this.h.onGatherStart?.(pos.x, pos.y);
      } else {
        this.h.onGatherCharge?.(p, pos.x, pos.y, true);
      }
      return;
    }

    // gathered: fist closes everything, a relaxed/lost hand drops them back
    if (hand.present && hand.fist) {
      g.state = "idle";
      g.slot = -1;
      this.h.onGatherClose?.(pos.x, pos.y);
      return;
    }
    if (hand.present && hand.openVertical) {
      g.lastOkT = t;
      this.h.onGatherMove?.(pos.x, pos.y);
      return;
    }
    if (t - g.lastOkT > GATHER_GRACE_MS) {
      g.state = "idle";
      g.slot = -1;
      this.h.onGatherCancel?.();
    } else if (hand.present) {
      this.h.onGatherMove?.(pos.x, pos.y);
    }
  }

  updateHand(hand, lm, label, t) {
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

    // pose flags + raw screen position for the gather gesture (valid in every
    // mode, even for the non-driving hand of head mode). The gather pose
    // requires the BACK of the hand toward the camera, not just a vertical hand.
    hand.openVertical = isOpenVertical(lm) && isBackOfHand(lm, label);
    hand.fist = isFist(lm);
    hand.rawScreen = { x: px, y: py };

    if (!hand.present) {
      hand.present = true;
      hand.firstSeen = t;
      hand.fx.reset();
      hand.fy.reset();
      hand.el.style.display = "block";
    }
    const prevX = hand.x, prevY = hand.y;

    // head mode: the driving hand's cursor is the head pointer (already
    // smoothed); the other hand stays invisible and inert (clap still works)
    const driving = !this.headMode || hand.slot === this.drivingSlot();
    if (this.headMode) {
      if (!driving || !this.headPoint.present) {
        hand.el.style.display = "none";
        if (!driving) return;
        // face lost: freeze the cursor at its last position
        hand.el.style.display = "block";
      }
      if (this.headPoint.present) {
        hand.x = this.headPoint.x;
        hand.y = this.headPoint.y;
      }
      hand.el.style.transform = `translate(${hand.x}px, ${hand.y}px)`;
    } else {
      hand.x = hand.fx.filter(px, t);
      hand.y = hand.fy.filter(py, t);
      hand.el.style.transform = `translate(${hand.x}px, ${hand.y}px)`;
    }

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
    // clapping hands often merge into one detection right at contact, so the
    // "palms touching" frame may never arrive: a fast approach immediately
    // followed by losing a hand near the other one also counts as a clap
    const other = this.hands[1 - hand.slot];
    if (other.present && !hand.pinching && !other.pinching &&
        t - hand.firstSeen > CLAP_MIN_AGE_MS && t - other.firstSeen > CLAP_MIN_AGE_MS &&
        Math.max(hand.size, other.size) / Math.min(hand.size, other.size) < CLAP_SIZE_RATIO &&
        t - this.lastClap > CLAP_COOLDOWN_MS && this.palmGap.length) {
      const latest = this.palmGap[this.palmGap.length - 1];
      const wasFar = this.palmGap.some((s) => s.gap > CLAP_FAR);
      if (wasFar && latest.gap < CLAP_LOSS_NEAR && t - latest.t < CLAP_LOSS_MS) {
        this.lastClap = t;
        this.palmGap.length = 0;
        this.h.onClap?.((hand.x + other.x) / 2, (hand.y + other.y) / 2);
      }
    }

    hand.present = false;
    hand.el.style.display = "none";
    if (hand.pinching) {
      hand.pinching = false;
      hand.pinchFrames = 0;
      hand.el.classList.remove("pinch");
      this.h.onUp?.(hand.slot, hand.x, hand.y, false);
    }
  }

  detectClap(t) {
    const [a, b] = this.hands;
    if (!a.present || !b.present) { this.palmGap.length = 0; return; }
    const avgSize = (a.size + b.size) / 2;
    const gap = dist(a.palm, b.palm) / avgSize;
    this.palmGap.push({ t, gap });
    while (this.palmGap.length && t - this.palmGap[0].t > CLAP_WINDOW_MS) this.palmGap.shift();

    const bothMature = t - a.firstSeen > CLAP_MIN_AGE_MS && t - b.firstSeen > CLAP_MIN_AGE_MS;
    const similarSize = Math.max(a.size, b.size) / Math.min(a.size, b.size) < CLAP_SIZE_RATIO;
    if (gap < CLAP_NEAR && !a.pinching && !b.pinching && bothMature && similarSize &&
        t - this.lastClap > CLAP_COOLDOWN_MS) {
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
