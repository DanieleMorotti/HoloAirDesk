// Holographic window manager: text / image / audio viewers + file library.
import { sfx } from "/js/sfx.js";

const ICONS = { text: "▤", image: "◫", audio: "♫", other: "◈" };

let space, zTop = 100, spawnStep = 0;
const wins = new Map(); // id -> {el, name, kind, extra}

function nextSpawn(w, h) {
  const cx = innerWidth * 0.38, cy = innerHeight * 0.42;
  const dx = (spawnStep % 5 - 2) * 90, dy = (Math.floor(spawnStep / 5) % 3 - 1) * 70;
  spawnStep++;
  return {
    x: Math.max(12, Math.min(cx + dx - w / 2, innerWidth - w - 20)),
    y: Math.max(52, Math.min(cy + dy - h / 2, innerHeight - h - 20)),
  };
}

function makeWindow({ id, title, kind, width, height }) {
  const el = document.createElement("div");
  el.className = "holo-window";
  el.dataset.winId = id;
  el.dataset.scale = "1";
  const pos = nextSpawn(width, height || 300);
  el.style.cssText = `left:${pos.x}px; top:${pos.y}px; width:${width}px;`;
  el.innerHTML = `
    <div class="hw-corner tl"></div><div class="hw-corner tr"></div>
    <div class="hw-corner bl"></div><div class="hw-corner br"></div>
    <div class="hw-titlebar">
      <span class="hw-icon">${ICONS[kind] || ICONS.other}</span>
      <span class="hw-title">${title}</span>
      <span class="hw-kind">${kind.toUpperCase()}</span>
      <button class="hw-close" data-gesture="button" title="Close">✕</button>
    </div>
    <div class="hw-body"></div>`;
  el.querySelector(".hw-close").addEventListener("click", () => closeWindow(id));
  el.addEventListener("mousedown", () => bringToFront(el)); // mouse fallback
  space.appendChild(el);
  bringToFront(el);
  return el;
}

export function bringToFront(el) {
  el.style.zIndex = ++zTop;
  document.querySelectorAll(".holo-window.active").forEach((w) => w.classList.remove("active"));
  el.classList.add("active");
}

export function setScale(el, s) {
  const clamped = Math.max(0.45, Math.min(s, 2.6));
  el.dataset.scale = clamped;
  el.style.transform = `scale(${clamped})`;
}

export function getScale(el) { return parseFloat(el.dataset.scale || "1"); }

export function closeWindow(id) {
  const win = wins.get(id);
  if (!win) return;
  wins.delete(id);
  win.extra?.dispose?.();
  win.el.classList.add("closing");
  sfx.close();
  setTimeout(() => win.el.remove(), 190);
}

export function closeAll() {
  [...wins.keys()].forEach(closeWindow);
}

export function getOpenFiles() {
  return [...wins.values()].filter((w) => w.kind !== "library").map((w) => w.name);
}

export function anyOpen() { return wins.size > 0; }

/* ---------- text windows ---------- */

function updateThumb(win) {
  const { textEl, thumb } = win.extra;
  const max = textEl.scrollHeight - textEl.clientHeight;
  const rail = thumb.parentElement.clientHeight;
  if (max <= 0) { thumb.style.display = "none"; return; }
  thumb.style.display = "block";
  const th = Math.max(34, rail * (textEl.clientHeight / textEl.scrollHeight));
  thumb.style.height = `${th}px`;
  thumb.style.top = `${(rail - th) * (textEl.scrollTop / max)}px`;
}

export function scrollTextWindow(el, deltaPx) {
  const win = wins.get(el.dataset.winId);
  if (!win?.extra?.textEl) return;
  win.extra.textEl.scrollTop += deltaPx;
  updateThumb(win);
}

async function openText(name) {
  const id = `file:${name}`;
  const el = makeWindow({ id, title: name, kind: "text", width: 470 });
  const body = el.querySelector(".hw-body");
  body.style.height = "330px";
  body.innerHTML = `<div class="hw-text">loading…</div>
    <div class="hw-scrollrail"><div class="hw-thumb"></div></div>`;
  const textEl = body.querySelector(".hw-text");
  textEl.style.overflowY = "hidden";
  const thumb = body.querySelector(".hw-thumb");
  const win = { el, name, kind: "text", extra: { textEl, thumb } };
  wins.set(id, win);

  body.addEventListener("wheel", (e) => {
    textEl.scrollTop += e.deltaY;
    updateThumb(win);
    e.preventDefault();
  }, { passive: false });

  await reloadText(win);
  return el;
}

async function reloadText(win) {
  try {
    const r = await fetch(`/api/files/${encodeURIComponent(win.name)}?t=${Date.now()}`);
    win.extra.textEl.textContent = r.ok ? await r.text() : `⚠ could not load ${win.name}`;
  } catch {
    win.extra.textEl.textContent = `⚠ could not load ${win.name}`;
  }
  updateThumb(win);
}

/* ---------- image windows ---------- */

function openImage(name) {
  const id = `file:${name}`;
  const el = makeWindow({ id, title: name, kind: "image", width: 500 });
  const body = el.querySelector(".hw-body");
  body.classList.add("hw-image");
  const img = document.createElement("img");
  img.draggable = false;
  img.src = `/api/files/${encodeURIComponent(name)}?t=${Date.now()}`;
  img.onload = () => {
    const ratio = img.naturalHeight / img.naturalWidth;
    body.style.height = `${Math.min(500 * ratio, innerHeight * 0.6)}px`;
  };
  body.style.height = "320px";
  body.appendChild(img);
  wins.set(id, { el, name, kind: "image", extra: { img } });
  return el;
}

/* ---------- audio windows ---------- */

function openAudio(name) {
  const id = `file:${name}`;
  const el = makeWindow({ id, title: name, kind: "audio", width: 420 });
  const body = el.querySelector(".hw-body");
  body.innerHTML = `<div class="hw-audio">
      <button class="audio-btn" data-gesture="button">▶</button>
      <canvas width="240" height="64"></canvas>
      <span class="audio-time">0:00</span>
    </div>`;

  const audio = new Audio(`/api/files/${encodeURIComponent(name)}`);
  audio.crossOrigin = "anonymous";
  const btn = body.querySelector(".audio-btn");
  const canvas = body.querySelector("canvas");
  const timeEl = body.querySelector(".audio-time");
  const ctx2d = canvas.getContext("2d");
  let actx = null, analyser = null, raf = 0;

  function draw() {
    raf = requestAnimationFrame(draw);
    const W = canvas.width, H = canvas.height;
    ctx2d.clearRect(0, 0, W, H);
    const playing = !audio.paused && analyser;
    ctx2d.fillStyle = "rgba(78,225,255,.9)";
    ctx2d.shadowColor = "rgba(78,225,255,.8)";
    ctx2d.shadowBlur = 6;
    if (playing) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const bars = 32, step = Math.floor(data.length / bars / 2);
      for (let i = 0; i < bars; i++) {
        const v = data[i * step] / 255;
        const h = Math.max(2, v * H * 0.95);
        ctx2d.fillRect(i * (W / bars) + 1, (H - h) / 2, W / bars - 3, h);
      }
    } else {
      ctx2d.fillRect(0, H / 2 - 1, W, 2);
    }
    const t = audio.currentTime || 0;
    timeEl.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  }
  draw();

  btn.addEventListener("click", () => {
    if (audio.paused) {
      if (!actx) {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        const src = actx.createMediaElementSource(audio);
        analyser = actx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser).connect(actx.destination);
      }
      actx.resume();
      audio.play();
      btn.textContent = "❚❚";
      btn.classList.add("playing");
    } else {
      audio.pause();
      btn.textContent = "▶";
      btn.classList.remove("playing");
    }
  });
  audio.addEventListener("ended", () => {
    btn.textContent = "▶";
    btn.classList.remove("playing");
    audio.currentTime = 0;
  });

  wins.set(id, {
    el, name, kind: "audio",
    extra: { audio, btn, dispose() { cancelAnimationFrame(raf); audio.pause(); audio.src = ""; actx?.close?.(); } },
  });
  return el;
}

/* ---------- library window ---------- */

export async function openLibrary() {
  const id = "library";
  if (wins.has(id)) {
    bringToFront(wins.get(id).el);
    await refreshLibrary();
    return;
  }
  const el = makeWindow({ id, title: "FILE LIBRARY", kind: "other", width: 470 });
  el.querySelector(".hw-kind").textContent = "SYS";
  const body = el.querySelector(".hw-body");
  body.classList.add("hw-library");
  wins.set(id, { el, name: "library", kind: "library", extra: {} });
  sfx.open();
  await refreshLibrary();
}

export async function refreshLibrary() {
  const win = wins.get("library");
  if (!win) return;
  const body = win.el.querySelector(".hw-body");
  try {
    const { files } = await (await fetch("/api/files")).json();
    body.innerHTML = files.length ? "" : `<div class="hw-text">library is empty</div>`;
    for (const f of files) {
      const card = document.createElement("button");
      card.className = "file-card";
      card.dataset.gesture = "button";
      card.innerHTML = `<span class="fc-icon">${ICONS[f.kind] || ICONS.other}</span>
        <span class="fc-name">${f.name}</span><span class="fc-kind">${f.kind.toUpperCase()}</span>`;
      card.addEventListener("click", () => openFile(f.name, f.kind));
      body.appendChild(card);
    }
  } catch {
    body.innerHTML = `<div class="hw-text">⚠ could not load library</div>`;
  }
}

/* ---------- public API ---------- */

export async function openFile(name, kind) {
  const id = `file:${name}`;
  const existing = wins.get(id);
  if (existing) {
    bringToFront(existing.el);
    existing.el.classList.remove("flash");
    void existing.el.offsetWidth;
    existing.el.classList.add("flash");
    return;
  }
  if (!kind) {
    const { files } = await (await fetch("/api/files")).json();
    kind = files.find((f) => f.name === name)?.kind || "other";
  }
  sfx.open();
  if (kind === "text") return openText(name);
  if (kind === "image") return openImage(name);
  if (kind === "audio") return openAudio(name);
  return openText(name); // best effort for unknown kinds
}

export async function refreshFile(name) {
  const win = wins.get(`file:${name}`);
  if (win) {
    if (win.kind === "text") await reloadText(win);
    if (win.kind === "image") win.extra.img.src = `/api/files/${encodeURIComponent(name)}?t=${Date.now()}`;
    win.el.classList.remove("flash");
    void win.el.offsetWidth;
    win.el.classList.add("flash");
  }
  await refreshLibrary();
}

export async function fileDeleted(name) {
  closeWindow(`file:${name}`);
  await refreshLibrary();
}

export function closeFileWindow(name) {
  closeWindow(`file:${name}`);
}

export function getPlayingAudio() {
  return [...wins.values()]
    .filter((w) => w.kind === "audio" && w.extra.audio && !w.extra.audio.paused)
    .map((w) => w.name);
}

// idempotent: sets the desired state instead of toggling
export async function setAudioPlaying(name, playing) {
  const id = `file:${name}`;
  if (!wins.has(id)) {
    if (!playing) return; // nothing to pause
    await openFile(name, "audio");
  }
  const win = wins.get(id);
  if (!win?.extra?.audio) return;
  if (playing !== !win.extra.audio.paused) win.extra.btn.click();
}

/* ---------- gather gesture: windows condense around the open hand ---------- */

function applyGather(el, x, y, i, n) {
  // orbit slot around the hand point; CSS transition does the easing
  const cx = el.offsetLeft + el.offsetWidth / 2;
  const cy = el.offsetTop + el.offsetHeight / 2;
  const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
  const rad = n > 1 ? 55 : 0;
  const tx = x + Math.cos(a) * rad - cx;
  const ty = y + Math.sin(a) * rad - cy;
  el.style.transform = `translate(${tx}px, ${ty}px) scale(0.13)`;
}

export function gatherStart(x, y) {
  const els = [...wins.values()].map((w) => w.el);
  els.forEach((el, i) => {
    el.classList.add("gathered");
    applyGather(el, x, y, i, els.length);
  });
}

export function gatherMove(x, y) {
  const els = [...wins.values()].map((w) => w.el);
  els.forEach((el, i) => applyGather(el, x, y, i, els.length));
}

export function gatherCancel() {
  for (const w of wins.values()) {
    const el = w.el;
    el.style.transform = `scale(${getScale(el)})`;
    setTimeout(() => el.classList.remove("gathered"), 500);
  }
}

export function gatherClose() {
  // skip the normal closing animation: it would snap the tiny windows back
  // to their original spots — fade them out right where the hand crushed them
  for (const [id, w] of [...wins]) {
    wins.delete(id);
    w.extra?.dispose?.();
    w.el.style.opacity = "0";
    setTimeout(() => w.el.remove(), 300);
  }
}

export function init() {
  space = document.getElementById("space");
}
