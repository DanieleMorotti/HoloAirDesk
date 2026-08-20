// Maps gesture pointer events onto the UI: buttons, window drag,
// two-hand resize, scroll thumbs, clap-to-clear.
import * as windows from "/js/windows.js";
import { sfx } from "/js/sfx.js";

const hands = [freshHand(), freshHand()];

function freshHand() {
  return { mode: null, target: null, winEl: null, offX: 0, offY: 0, startY: 0, hover: null };
}

function hitAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return {};
  return {
    button: el.closest('[data-gesture="button"]'),
    thumb: el.closest('[data-gesture="scroll"]'),
    win: el.closest(".holo-window"),
  };
}

function otherHandOn(slot, winEl) {
  const other = hands[1 - slot];
  return (other.mode === "drag" || other.mode === "resize") && other.winEl === winEl ? other : null;
}

function startResize(a, b, winEl) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const s = windows.getScale(winEl);
  for (const h of [a, b]) {
    h.mode = "resize";
    h.winEl = winEl;
  }
  a.resize = b.resize = { startDist: Math.max(d, 40), startScale: s };
  winEl.classList.add("grabbed");
}

export function onDown(slot, x, y) {
  const hand = hands[slot];
  hand.x = x; hand.y = y;
  const hit = hitAt(x, y);

  if (hit.button) {
    hand.mode = "button";
    hand.target = hit.button;
    return;
  }
  if (hit.thumb && hit.win) {
    hand.mode = "scroll";
    hand.winEl = hit.win;
    hand.startY = y;
    windows.bringToFront(hit.win);
    return;
  }
  if (hit.win) {
    windows.bringToFront(hit.win);
    const partner = otherHandOn(slot, hit.win);
    if (partner) {
      partner.winEl.classList.remove("grabbed");
      startResize(hand, partner, hit.win);
      return;
    }
    hand.mode = "drag";
    hand.winEl = hit.win;
    const r = hit.win.getBoundingClientRect();
    // rect is scaled; left/top style coords are unscaled with center origin
    hand.offX = x - (r.left + r.width / 2);
    hand.offY = y - (r.top + r.height / 2);
    hit.win.classList.add("grabbed");
  }
}

export function onMove(slot, x, y, pinching) {
  const hand = hands[slot];
  hand.x = x; hand.y = y;

  if (!pinching) {
    // hover affordance
    const btn = hitAt(x, y).button;
    if (btn !== hand.hover) {
      hand.hover?.classList.remove("g-hover");
      if (btn) { btn.classList.add("g-hover"); sfx.hover(); }
      hand.hover = btn;
    }
    return;
  }

  if (hand.mode === "drag" && hand.winEl) {
    const el = hand.winEl;
    const w = el.offsetWidth, h = el.offsetHeight;
    const cx = x - hand.offX, cy = y - hand.offY;
    el.style.left = `${Math.min(Math.max(cx - w / 2, -w * 0.4), innerWidth - w * 0.6)}px`;
    el.style.top = `${Math.min(Math.max(cy - h / 2, 30), innerHeight - 60)}px`;
  } else if (hand.mode === "resize" && hand.winEl) {
    const other = hands[1 - slot];
    if (other.mode === "resize" && other.winEl === hand.winEl) {
      const d = Math.hypot(hand.x - other.x, hand.y - other.y);
      windows.setScale(hand.winEl, hand.resize.startScale * (d / hand.resize.startDist));
    }
  } else if (hand.mode === "scroll" && hand.winEl) {
    const dy = y - hand.startY;
    hand.startY = y;
    const textEl = hand.winEl.querySelector(".hw-text");
    if (textEl) {
      const rail = hand.winEl.querySelector(".hw-scrollrail").clientHeight;
      windows.scrollTextWindow(hand.winEl, dy * (textEl.scrollHeight / rail));
    }
  }
}

export function onUp(slot, x, y, wasClick) {
  const hand = hands[slot];

  if (hand.mode === "button" && hand.target) {
    const stillOver = hitAt(x, y).button === hand.target;
    if (stillOver || wasClick) {
      sfx.click();
      hand.target.click();
    }
  } else if (hand.mode === "drag" || hand.mode === "resize") {
    hand.winEl?.classList.remove("grabbed");
    // if we were resizing, the other hand falls back to dragging
    const other = hands[1 - slot];
    if (hand.mode === "resize" && other.mode === "resize" && other.winEl === hand.winEl) {
      other.mode = "drag";
      const r = other.winEl.getBoundingClientRect();
      other.offX = other.x - (r.left + r.width / 2);
      other.offY = other.y - (r.top + r.height / 2);
      other.winEl.classList.add("grabbed");
    }
  }

  hand.mode = null;
  hand.target = null;
  hand.winEl = null;
}

export function onClap(cx, cy) {
  if (!windows.anyOpen()) return;
  const wave = document.getElementById("shockwave");
  wave.style.left = `${cx}px`;
  wave.style.top = `${cy}px`;
  wave.classList.remove("boom");
  void wave.offsetWidth;
  wave.classList.add("boom");
  sfx.clap();
  windows.closeAll();
}
