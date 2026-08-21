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
  startTracking(landmarker, video, (result, t) => {
    if (head.isActive()) engine.headPoint = head.update(video, t);
    engine.processFrame(result, t);
  });

  // head-pointer mode (experimental): head steers the cursor, hands pinch
  head.init().catch((e) => console.warn("head pointer unavailable:", e));
  document.getElementById("dock-head").addEventListener("click", () => {
    if (!head.isReady()) { hud.toast("HEAD POINTER STILL LOADING"); return; }
    const on = head.toggle();
    engine.setHeadMode(on);
    hud.toast(on ? "HEAD POINTER ON — LOOK AT THE CENTER, HOLD STILL" : "HAND POINTERS ON");
  });

  hud.bootMessage("all systems nominal");
  setTimeout(() => {
    hud.finishBoot();
    hud.showHelp(); // gesture guide on first entry
  }, 600);
}

boot();
