// HoloSpace AI — boot orchestration.
import { openCamera, createLandmarker, startTracking } from "/js/tracking.js";
import { GestureEngine } from "/js/gestures.js";
import * as interactions from "/js/interactions.js";
import * as windows from "/js/windows.js";
import * as chat from "/js/chat.js";
import * as selection from "/js/selection.js";
import * as head from "/js/headpointer.js";
import * as mic from "/js/mic.js";
import * as hud from "/js/hud.js";
import { sfx } from "/js/sfx.js";

async function pollHealth() {
  try {
    const s = await (await fetch("/api/health")).json();
    hud.setCheck("llm", !!s.llm);
    hud.setCheck("asr", !!s.asr);
    if (!s.llm || !s.asr) setTimeout(pollHealth, 2500); // sidecars may still be loading
  } catch {
    setTimeout(pollHealth, 2500);
  }
}

async function boot() {
  hud.initHud();
  windows.init();
  chat.init();
  selection.init();
  mic.init();
  pollHealth();

  // dock
  document.getElementById("dock-library").addEventListener("click", () => windows.openLibrary());
  document.getElementById("dock-closeall").addEventListener("click", () => {
    if (windows.anyOpen()) { windows.closeAll(); hud.toast("ALL WINDOWS CLOSED"); }
  });
  document.body.addEventListener("pointerdown", () => sfx.unlock(), { once: true });

  const video = document.getElementById("cam");

  hud.bootMessage("requesting webcam access…");
  try {
    await openCamera(video);
    hud.setCheck("cam", true);
  } catch (e) {
    hud.setCheck("cam", false);
    hud.bootMessage("⚠ webcam access denied — reload and allow the camera");
    console.error(e);
    return;
  }

  hud.bootMessage("loading hand tracking model…");
  let landmarker;
  try {
    landmarker = await createLandmarker();
    hud.setCheck("vision", true);
  } catch (e) {
    hud.setCheck("vision", false);
    hud.bootMessage("⚠ vision core failed to load");
    console.error(e);
    return;
  }

  const engine = new GestureEngine({
    onDown: interactions.onDown,
    onMove: interactions.onMove,
    onUp: interactions.onUp,
    onClap: interactions.onClap,
    onHands: hud.tickFrame,
  });
  // magnetic cursor (head mode): near a button the pointer locks onto its
  // center, so micro-jitter cannot shake it off a small target. The raw head
  // position is always compared against ALL targets: when a different button
  // becomes clearly closer than the locked one, the lock hops directly to it
  // (no need to escape into empty space first) — adjacent buttons behave
  // like notches you click between.
  let magnetEl = null;
  function magnet(hp) {
    if (!hp.present) { magnetEl = null; return hp; }
    const ACQUIRE_R = 44;    // raw pointer this close to a button = lock
    const RELEASE_R = 60;    // raw pointer this far from the lock = free
    const SWITCH_MARGIN = 12; // a neighbor must be this much closer to steal the lock
    const center = (el) => {
      const r = el.getBoundingClientRect();
      return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    };
    const pinching = engine.hands.some((h) => h.present && h.pinching);

    // nearest visible button to the RAW (unmagnetized) pointer
    let nearest = null, nd = Infinity;
    for (const el of document.querySelectorAll('[data-gesture="button"]')) {
      if (el.closest(".hidden")) continue; // skip buttons in hidden overlays
      const c = center(el);
      if (!c) continue;
      const d = Math.hypot(hp.x - c.x, hp.y - c.y);
      if (d < nd) { nd = d; nearest = el; }
    }

    if (magnetEl) {
      const c = center(magnetEl);
      const dl = c ? Math.hypot(hp.x - c.x, hp.y - c.y) : Infinity;
      if (dl > RELEASE_R) {
        magnetEl = null;
      } else if (!pinching && nearest && nearest !== magnetEl &&
                 nd <= ACQUIRE_R && nd < dl - SWITCH_MARGIN) {
        magnetEl = nearest; // hop straight to the clearly-closer neighbor
      }
    }
    if (!magnetEl && !pinching && nearest && nd <= ACQUIRE_R) magnetEl = nearest;

    if (magnetEl) {
      const c = center(magnetEl);
      if (c) return { present: true, x: c.x, y: c.y };
    }
    return hp;
  }

  startTracking(landmarker, video, (result, t) => {
    if (head.isOn()) engine.headPoint = magnet(head.update(video, t));
    else if (head.isActive()) head.update(video, t); // calibrating: just collect
    engine.processFrame(result, t);
  });

  // head-pointer mode (experimental): head steers the cursor, hands pinch
  head.init().catch((e) => console.warn("head pointer unavailable:", e));
  document.getElementById("dock-head").addEventListener("click", () => {
    if (head.isActive()) {
      head.disable();
      engine.setHeadMode(false);
      hud.toast("HAND POINTERS ON");
    } else if (!head.isReady()) {
      hud.toast("HEAD POINTER STILL LOADING");
    } else {
      head.beginCalibration(); // hands stay active to press SET CENTER
    }
  });
  document.getElementById("head-calib-btn").addEventListener("click", () => {
    if (head.confirmCalibration()) {
      engine.setHeadMode(true);
      hud.toast("HEAD POINTER ON");
    }
  });

  hud.bootMessage("all systems nominal");
  setTimeout(() => {
    hud.finishBoot();
    hud.showHelp(); // gesture guide on first entry
  }, 600);
}

boot();
