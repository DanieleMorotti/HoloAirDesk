// Text selection inside text windows: pinch-drag horizontally to select,
// the selection rides along the next voice message as context for HOLO.
let current = null;   // {file, text}
let anchor = null;    // {node, offset}
let sourceEl = null;  // .hw-text being selected
let chipEl = null;

function caretAt(x, y, withinEl) {
  let node = null, offset = 0;
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    if (r) { node = r.startContainer; offset = r.startOffset; }
  } else if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    if (p) { node = p.offsetNode; offset = p.offset; }
  }
  if (!node || (withinEl && !withinEl.contains(node))) return null;
  return { node, offset };
}

function fileOf(textEl) {
  const win = textEl.closest(".holo-window");
  const id = win?.dataset.winId || "";
  return id.startsWith("file:") ? id.slice(5) : null;
}

export function begin(textEl, x, y) {
  sourceEl = textEl;
  anchor = caretAt(x, y, textEl);
}

export function extend(x, y) {
  if (!anchor || !sourceEl) return;
  const focus = caretAt(x, y, sourceEl);
  if (!focus) return;
  window.getSelection().setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}

export function finish() {
  const text = window.getSelection().toString().trim();
  const file = sourceEl ? fileOf(sourceEl) : null;
  if (text && file) {
    current = { file, text };
    renderChip();
  } else {
    clear();
  }
  anchor = null;
}

export function clear() {
  current = null;
  anchor = null;
  sourceEl = null;
  window.getSelection().removeAllRanges();
  renderChip();
}

export function get() {
  return current;
}

// consume() returns the selection and clears it (called when a message is sent)
export function consume() {
  const sel = current;
  clear();
  return sel;
}

function renderChip() {
  if (!chipEl) return;
  if (!current) {
    chipEl.classList.add("hidden");
    chipEl.innerHTML = "";
    return;
  }
  const snippet = current.text.length > 90 ? current.text.slice(0, 90) + "…" : current.text;
  chipEl.innerHTML = "";
  const label = document.createElement("span");
  label.className = "sel-label";
  label.textContent = `✂ ${current.file}`;
  const body = document.createElement("span");
  body.className = "sel-snippet";
  body.textContent = snippet;
  const x = document.createElement("button");
  x.className = "sel-x";
  x.dataset.gesture = "button";
  x.title = "Discard selection";
  x.textContent = "✕";
  x.addEventListener("click", clear);
  chipEl.append(label, body, x);
  chipEl.classList.remove("hidden");
}

export function init() {
  chipEl = document.getElementById("chat-selection");
  // mouse users: a native selection inside a text window registers too
  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    const text = sel.toString().trim();
    if (!text) return;
    const node = sel.anchorNode;
    const el = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.(".hw-text");
    if (!el) return;
    const file = fileOf(el);
    if (!file) return;
    current = { file, text };
    renderChip();
  });
}
